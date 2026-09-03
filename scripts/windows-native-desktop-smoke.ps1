#Requires -Version 5.1
param([ValidateSet('online','unavailable','offline')][string]$Mode = 'online')
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Este teste requer o runner Windows descartavel do CI.' }
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$executable = 'C:\Program Files\SiloNR Server\desktop\silonr-desktop.exe'
$shortcut = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'SiloNR.lnk'
if ($Mode -eq 'offline') { $shortcut = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'SiloNR\SiloNR - modo offline.lnk' }
if (-not (Test-Path $shortcut)) { throw "Atalho ausente: $shortcut" }
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
if ($link.TargetPath -ne $executable) { throw 'Atalho nao aponta para o executavel Desktop instalado.' }
$expectedArguments = if ($Mode -eq 'offline') { '' } else { '--local-server' }
if ($link.Arguments -ne $expectedArguments) { throw 'Argumentos incorretos no atalho.' }
if (Get-Process -Name silonr-desktop -ErrorAction SilentlyContinue) { throw 'Desktop ja aberto antes do teste.' }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$screenshots = Join-Path $repository 'artifacts\windows-server'
$null = New-Item -ItemType Directory -Path $screenshots -Force
$debugPolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'
$policyName = 'silonr-desktop.exe'
$policyWritten = $false
function Save-DesktopScreenshot([string]$Suffix) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $screen = [Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = [Drawing.Bitmap]::new($screen.Width,$screen.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($screen.Location,[Drawing.Point]::Empty,$screen.Size)
        $bitmap.Save((Join-Path $screenshots "desktop-$Mode-$Suffix.png"),[Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
$process = $null
try {
    Start-Process -FilePath $shortcut
    $deadline = (Get-Date).AddSeconds(45)
    do {
        $process = Get-Process -Name silonr-desktop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable } | Select-Object -First 1
        if ($process -and $process.MainWindowHandle -ne 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (-not $process -or $process.MainWindowHandle -eq 0) { throw 'O atalho nao abriu uma janela do SiloNR Desktop.' }
    Write-Host "Installed shortcut opened the native window: $Mode"
    [void]$process.CloseMainWindow()
    if (-not $process.WaitForExit(10000)) { throw 'Desktop nao fechou normalmente apos abrir pelo atalho.' }
    Start-Sleep -Seconds 1
    # Elevated WebView2 hosts ignore environment overrides. Use a temporary, app-specific
    # machine policy only on this disposable CI runner, never in the installed product.
    if ((Test-Path $debugPolicy) -and ((Get-Item $debugPolicy).GetValueNames() -contains $policyName)) {
        throw 'Politica WebView2 do SiloNR ja configurada; o teste nao deve sobrescreve-la.'
    }
    if (-not (Test-Path $debugPolicy)) { $null = New-Item -Path $debugPolicy -Force }
    $null = New-ItemProperty -Path $debugPolicy -Name $policyName -PropertyType String -Value "--remote-debugging-port=$port --remote-debugging-address=127.0.0.1"
    $policyWritten = $true
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $link.TargetPath
    $start.Arguments = $link.Arguments
    $start.WorkingDirectory = Split-Path $link.TargetPath -Parent
    $start.UseShellExecute = $false
    $process = [Diagnostics.Process]::Start($start)
    & node (Join-Path $PSScriptRoot 'windows-native-desktop-smoke.mjs') $port $Mode (Join-Path $repository "artifacts\windows-server\desktop-$Mode.png")
    if ($LASTEXITCODE -ne 0) { throw "Interface Desktop falhou: $Mode" }
    Save-DesktopScreenshot 'window'
    if (-not (Test-Path (Join-Path $env:APPDATA 'br.com.silonr.desktop\silonr-offline.db'))) { throw 'Desktop nao inicializou o banco offline por usuario.' }
    Write-Host "Desktop shortcut, native window and user storage passed: $Mode"
} catch {
    try { Save-DesktopScreenshot 'failure' }
    catch { Write-Warning "Nao foi possivel capturar a janela: $_" }
    throw
} finally {
    try {
        if ($process -and -not $process.HasExited) {
            [void]$process.CloseMainWindow()
            if (-not $process.WaitForExit(10000)) { Stop-Process -Id $process.Id -Force }
        }
    } finally {
        if ($policyWritten) {
            Remove-ItemProperty -Path $debugPolicy -Name $policyName
            if ((Get-Item $debugPolicy).GetValueNames() -contains $policyName) { throw 'Politica temporaria de depuracao nao foi removida.' }
        }
    }
}
