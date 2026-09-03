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
$previousArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$process = $null
try {
    # Debugging is enabled only for this CI process, never in installed shortcuts.
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --remote-debugging-address=127.0.0.1"
    Start-Process -FilePath $shortcut
    $deadline = (Get-Date).AddSeconds(45)
    do {
        $process = Get-Process -Name silonr-desktop -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable } | Select-Object -First 1
        if ($process -and $process.MainWindowHandle -ne 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (-not $process -or $process.MainWindowHandle -eq 0) { throw 'O atalho nao abriu uma janela do SiloNR Desktop.' }
    & node (Join-Path $PSScriptRoot 'windows-native-desktop-smoke.mjs') $port $Mode (Join-Path $repository "artifacts\windows-server\desktop-$Mode.png")
    if ($LASTEXITCODE -ne 0) { throw "Interface Desktop falhou: $Mode" }
    if (-not (Test-Path (Join-Path $env:APPDATA 'br.com.silonr.desktop\silonr-offline.db'))) { throw 'Desktop nao inicializou o banco offline por usuario.' }
    Write-Host "Desktop shortcut, native window and user storage passed: $Mode"
} finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousArguments
    if ($process -and -not $process.HasExited) {
        [void]$process.CloseMainWindow()
        if (-not $process.WaitForExit(10000)) { Stop-Process -Id $process.Id -Force }
    }
}
