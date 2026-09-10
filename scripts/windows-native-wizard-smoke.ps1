#Requires -Version 5.1
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Este teste instala e cancela o pacote em um runner Windows descartavel do CI.' }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class SiloNRWizardTest {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    private delegate bool EnumProc(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr param);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
    public static IntPtr[] Windows() {
        var result = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) { result.Add(hwnd); return true; }, IntPtr.Zero);
        return result.ToArray();
    }
    public static string Title(IntPtr hwnd) {
        var text = new StringBuilder(512); GetWindowText(hwnd, text, text.Capacity); return text.ToString();
    }
    public static IntPtr[] Children(IntPtr parent) {
        var result = new List<IntPtr>();
        EnumChildWindows(parent, delegate(IntPtr hwnd, IntPtr unused) { result.Add(hwnd); return true; }, IntPtr.Zero);
        return result.ToArray();
    }
    public static string ClassName(IntPtr hwnd) {
        var text = new StringBuilder(256); GetClassName(hwnd, text, text.Capacity); return text.ToString();
    }
    public static Rect Bounds(IntPtr hwnd) {
        Rect rect;
        if (!GetWindowRect(hwnd, out rect)) throw new InvalidOperationException("Cannot read window bounds.");
        return rect;
    }
    public static int ProcessId(IntPtr hwnd) {
        uint processId; GetWindowThreadProcessId(hwnd, out processId); return (int)processId;
    }
}
'@
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$setup = (Get-ChildItem (Join-Path $repository 'artifacts\windows-server\output\*.exe') | Select-Object -First 1).FullName
$setupLog = Join-Path $repository 'artifacts\windows-server\wizard-setup.log'
Write-Host "Interactive desktop: $([Environment]::UserInteractive); session: $((Get-Process -Id $PID).SessionId)"
$installer = Start-Process $setup -ArgumentList '/SP-','/NORESTART',('/LOG="{0}"' -f $setupLog) -PassThru
$null = $installer.Handle
$family = New-Object 'Collections.Generic.HashSet[int]'
[void]$family.Add($installer.Id)

function Get-InstallerWindows {
    $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
    do {
        $added = $false
        foreach ($process in $processes) {
            if ($family.Contains([int]$process.ParentProcessId) -and $family.Add([int]$process.ProcessId)) { $added = $true }
        }
    } while ($added)
    return @([SiloNRWizardTest]::Windows() | Where-Object {
        $family.Contains([SiloNRWizardTest]::ProcessId($_)) -and [SiloNRWizardTest]::IsWindowVisible($_)
    })
}
function Click-WindowButton([IntPtr]$Window, [string[]]$Names) {
    # Inno's VCL buttons are not exposed as UI Automation buttons on every runner.
    foreach ($handle in [SiloNRWizardTest]::Children($Window)) {
        if ([SiloNRWizardTest]::ClassName($handle) -notmatch 'Button') { continue }
        $name = [SiloNRWizardTest]::Title($handle).Replace('&','').Trim()
        if ($name -in $Names -and [SiloNRWizardTest]::IsWindowEnabled($handle) -and [SiloNRWizardTest]::IsWindowVisible($handle)) {
            [void][SiloNRWizardTest]::SetForegroundWindow($Window)
            # Asynchronous click lets the test inspect any modal dialog it opens.
            if (-not [SiloNRWizardTest]::PostMessage($handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) { throw "Nao foi possivel clicar: $name" }
            Write-Host "Clicked installer button: $name"
            return $true
        }
    }
    return $false
}
function Save-WizardScreenshot([IntPtr]$Window) {
    $screen = [Windows.Forms.Screen]::FromHandle($Window).Bounds
    $bitmap = [Drawing.Bitmap]::new($screen.Width,$screen.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($screen.Location, [Drawing.Point]::Empty, $screen.Size)
        $bitmap.Save((Join-Path $repository 'artifacts\windows-server\wizard.png'), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
function Get-ControlBounds([IntPtr]$Window) {
    $rect = [SiloNRWizardTest]::Bounds($Window)
    return [Drawing.Rectangle]::new($rect.Left,$rect.Top,($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
}
try {
    $wizard = [IntPtr]::Zero
    $lastWindows = ''
    $deadline = (Get-Date).AddMinutes(3)
    do {
        $windows = @(Get-InstallerWindows)
        $titles = ($windows | ForEach-Object { [SiloNRWizardTest]::Title($_) }) -join ' | '
        if ($titles -ne $lastWindows) { Write-Host "Visible installer windows: $titles"; $lastWindows = $titles }
        foreach ($window in $windows) {
            $title = [SiloNRWizardTest]::Title($window)
            if ($title -eq 'SiloNR - primeira instalacao') { $wizard = $window; break }
            if ($title -like 'Setup*') { [void](Click-WindowButton $window @('Next','Next >','Install')) }
        }
        if ($wizard -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 500 }
    } while ($wizard -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline)
    if ($wizard -eq [IntPtr]::Zero) { throw 'O instalador nao exibiu o formulario de configuracao.' }
    if ([SiloNRWizardTest]::IsIconic($wizard)) { throw 'O formulario abriu minimizado.' }
    $owner = [SiloNRWizardTest]::GetWindow($wizard, 4)
    if ($owner -eq [IntPtr]::Zero -or -not $family.Contains([SiloNRWizardTest]::ProcessId($owner)) -or [SiloNRWizardTest]::Title($owner) -notlike 'Setup*') { throw 'Formulario sem vinculo com a janela do instalador.' }
    $order = @([SiloNRWizardTest]::Windows())
    if ([Array]::IndexOf($order,$wizard) -ge [Array]::IndexOf($order,$owner)) { throw 'Formulario ficou atras do instalador.' }
    $edits = @([SiloNRWizardTest]::Children($wizard) | Where-Object { [SiloNRWizardTest]::ClassName($_) -match '(^|\.)EDIT(\.|$)' })
    if ($edits.Count -ne 10) { throw "Formulario exibiu $($edits.Count) campos; esperados: 10." }
    $formBounds = Get-ControlBounds $wizard
    $screenBounds = [Windows.Forms.Screen]::FromHandle($wizard).WorkingArea
    foreach ($edit in $edits) {
        $bounds = Get-ControlBounds $edit
        if (-not [SiloNRWizardTest]::IsWindowVisible($edit) -or -not [SiloNRWizardTest]::IsWindowEnabled($edit) -or $bounds.Width -le 0 -or $bounds.Height -le 0 -or -not $screenBounds.Contains($bounds) -or -not $formBounds.Contains($bounds)) { throw 'Campo do formulario oculto, desabilitado ou fora da tela.' }
    }
    Save-WizardScreenshot $wizard
    if (-not (Click-WindowButton $wizard @('Configurar servidor'))) { throw 'Botao de configurar servidor ausente.' }
    $validation = [IntPtr]::Zero
    $deadline = (Get-Date).AddSeconds(20)
    do {
        foreach ($window in Get-InstallerWindows) {
            if ([SiloNRWizardTest]::Title($window) -eq 'Verifique os campos') { $validation = $window; break }
        }
        if ($validation -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 300 }
    } while ($validation -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline)
    if ($validation -eq [IntPtr]::Zero -or [SiloNRWizardTest]::GetWindow($validation,4) -ne $wizard) { throw 'Aviso de validacao nao apareceu vinculado ao formulario.' }
    [void](Click-WindowButton $validation @('OK'))
    Start-Sleep -Milliseconds 500
    [void][SiloNRWizardTest]::PostMessage($wizard, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    $deadline = (Get-Date).AddSeconds(45)
    while (-not $installer.HasExited -and (Get-Date) -lt $deadline) {
        foreach ($window in Get-InstallerWindows) { [void](Click-WindowButton $window @('OK','Finish')) }
        Start-Sleep -Milliseconds 500
    }
    if (-not $installer.HasExited) { throw 'Cancelamento do formulario deixou o instalador preso.' }
    $installer.WaitForExit()
    if ($installer.ExitCode -eq 0) { throw 'Cancelamento do formulario foi reportado como instalacao concluida.' }
    if (Test-Path 'C:\ProgramData\SiloNR\config\server.env') { throw 'Cancelar antes de preencher nao deveria configurar o servidor.' }
    Write-Host 'Interactive installer: visible owned wizard, fields, validation and cancellation passed.'
} catch {
    $failure = $_
    try {
        foreach ($window in Get-InstallerWindows) {
            Write-Host "Window at failure: $([SiloNRWizardTest]::Title($window))"
            foreach ($button in [SiloNRWizardTest]::Children($window)) {
                if ([SiloNRWizardTest]::ClassName($button) -match 'Button') {
                    Write-Host "Button: $([SiloNRWizardTest]::Title($button)); enabled=$([SiloNRWizardTest]::IsWindowEnabled($button)); visible=$([SiloNRWizardTest]::IsWindowVisible($button))"
                }
            }
        }
        Save-WizardScreenshot ([IntPtr]::Zero)
    } catch { Write-Warning "UI diagnostics: $($_.Exception.Message)" }
    if (Test-Path $setupLog) { Get-Content $setupLog -Tail 40 }
    throw $failure
} finally {
    foreach ($processId in $family) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
    $installer.Dispose()
}
