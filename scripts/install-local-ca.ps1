param(
  [Parameter(Mandatory = $true)]
  [string]$CertificatePath
)

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Execute o PowerShell como Administrador."
}

$resolved = (Resolve-Path -LiteralPath $CertificatePath).Path
$certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2($resolved)
if ($certificate.HasPrivateKey) {
  throw "O arquivo contém chave privada e não pode ser distribuído."
}
if ($certificate.Subject -notmatch "Caddy Local Authority") {
  throw "O certificado não pertence à autoridade local esperada do SiloNR."
}

Import-Certificate -FilePath $resolved -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Write-Host "Certificado local do SiloNR instalado para este computador."
