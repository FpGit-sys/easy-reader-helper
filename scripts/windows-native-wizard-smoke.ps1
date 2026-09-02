#Requires -Version 5.1
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Este teste instala e cancela o pacote em um runner Windows descartavel do CI.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class SiloNRWizardTest {
    private delegate bool EnumProc(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
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
    public static int ProcessId(IntPtr hwnd) {
        uint processId; GetWindowThreadProcessId(hwnd, out processId); return (int)processId;
    }
}
'@
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$setup = (Get-ChildItem (Join-Path $repository 'artifacts\windows-server\output\*.exe') | Select-Object -First 1).FullName
$installer = Start-Process $setup -ArgumentList '/SP-','/NORESTART' -PassThru
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
    $root = [Windows.Automation.AutomationElement]::FromHandle($Window)
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
    foreach ($button in $root.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)) {
        $name = $button.Current.Name.Replace('&','').Trim()
        if ($name -in $Names -and $button.Current.IsEnabled -and -not $button.Current.IsOffscreen) {
            # Post the native click: synchronous Invoke can wait on the very
            # modal dialog that this test needs to inspect next.
            $handle = [IntPtr]::new($button.Current.NativeWindowHandle)
            if ($handle -eq [IntPtr]::Zero) { throw "Botao sem handle nativo: $name" }
            if (-not [SiloNRWizardTest]::PostMessage($handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) { throw "Nao foi possivel clicar: $name" }
            return $true
        }
    }
    return $false
}
try {
    $wizard = [IntPtr]::Zero
    $deadline = (Get-Date).AddMinutes(3)
    do {
        foreach ($window in Get-InstallerWindows) {
            $title = [SiloNRWizardTest]::Title($window)
            if ($title -eq 'SiloNR - primeira instalacao') { $wizard = $window; break }
            if ($title -like 'Setup*') { [void](Click-WindowButton $window @('Next >','Install')) }
        }
        if ($wizard -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 500 }
    } while ($wizard -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline)
    if ($wizard -eq [IntPtr]::Zero) { throw 'O instalador nao exibiu o formulario de configuracao.' }
    if ([SiloNRWizardTest]::IsIconic($wizard)) { throw 'O formulario abriu minimizado.' }
    $owner = [SiloNRWizardTest]::GetWindow($wizard, 4)
    if ($owner -eq [IntPtr]::Zero -or -not $family.Contains([SiloNRWizardTest]::ProcessId($owner)) -or [SiloNRWizardTest]::Title($owner) -notlike 'Setup*') { throw 'Formulario sem vinculo com a janela do instalador.' }
    $order = @([SiloNRWizardTest]::Windows())
    if ([Array]::IndexOf($order,$wizard) -ge [Array]::IndexOf($order,$owner)) { throw 'Formulario ficou atras do instalador.' }
    $root = [Windows.Automation.AutomationElement]::FromHandle($wizard)
    $edits = $root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit))
    if ($edits.Count -ne 10) { throw 'Formulario nao exibiu os dez campos esperados.' }
    foreach ($edit in $edits) { if ($edit.Current.IsOffscreen) { throw 'Campo do formulario fora da tela.' } }
    $screen = [Windows.Forms.Screen]::FromHandle($wizard).Bounds
    $bitmap = [Drawing.Bitmap]::new($screen.Width,$screen.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($screen.Location, [Drawing.Point]::Empty, $screen.Size)
        $bitmap.Save((Join-Path $repository 'artifacts\windows-server\wizard.png'), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
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
} finally {
    foreach ($processId in $family) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
    $installer.Dispose()
}
