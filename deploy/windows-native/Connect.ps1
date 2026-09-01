#Requires -Version 5.1
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
try {
    $address = (Get-Content (Join-Path $PSScriptRoot 'servidor.txt') -Raw).Trim()
    & (Join-Path $PSScriptRoot 'install-local-ca.ps1') -CertificatePath (Join-Path $PSScriptRoot 'silonr-local-ca.crt') -ServerAddress $address
    $response = Invoke-RestMethod 'https://silonr.local/api/health/ready' -TimeoutSec 15
    if ($response.status -ne 'ready') { throw 'Servidor ainda nao esta pronto.' }
    $setup = Join-Path $PSScriptRoot 'SiloNR-Desktop-Setup.exe'
    $process = Start-Process $setup -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Instalador Desktop retornou $($process.ExitCode)." }
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show('No Desktop, use https://silonr.local, teste a conexao e faca o pareamento com seu administrador.', 'SiloNR configurado')
    exit 0
} catch { Write-Error $_ -ErrorAction Continue; Read-Host 'Pressione Enter para fechar'; exit 1 }
