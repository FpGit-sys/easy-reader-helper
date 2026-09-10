#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
try {
    $address = (Get-Content (Join-Path $PSScriptRoot 'servidor.txt') -Raw).Trim()
    $parsed = $null
    if (-not [Net.IPAddress]::TryParse($address, [ref]$parsed)) { throw 'Endereco do servidor invalido.' }
    # Elevate only machine-wide certificate/hosts configuration. Desktop stays
    # under the original user even when a different administrator supplies UAC credentials.
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -CertificatePath "{1}" -ServerAddress "{2}"' -f (Join-Path $PSScriptRoot 'install-local-ca.ps1'),(Join-Path $PSScriptRoot 'silonr-local-ca.crt'),$address
    $configuration = Start-Process "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -ArgumentList $arguments -Wait -PassThru
    if ($configuration.ExitCode -ne 0) { throw 'Configuracao de certificado/rede nao foi concluida.' }
    $response = Invoke-RestMethod 'https://silonr.local/api/health/ready' -TimeoutSec 15
    if ($response.status -ne 'ready') { throw 'Servidor ainda nao esta pronto.' }
    $setup = Join-Path $PSScriptRoot 'SiloNR-Desktop-Setup.exe'
    $process = Start-Process $setup -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Instalador Desktop retornou $($process.ExitCode)." }
    Add-Type -AssemblyName System.Windows.Forms
    [void][Windows.Forms.MessageBox]::Show('No Desktop, use https://silonr.local, teste a conexao e faca o pareamento com seu administrador.', 'SiloNR configurado')
    exit 0
} catch { Write-Error $_ -ErrorAction Continue; Read-Host 'Pressione Enter para fechar'; exit 1 }
