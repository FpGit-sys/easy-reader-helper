param(
  [Parameter(Mandatory = $true)]
  [string]$CertificatePath,
  [Parameter(Mandatory = $true)]
  [string]$ServerAddress,
  [string]$ServerName = "silonr.local"
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

$parsedAddress = $null
if (-not [Net.IPAddress]::TryParse($ServerAddress, [ref]$parsedAddress)) {
  throw "ServerAddress deve ser um endereço IP válido."
}
if ($ServerName -notmatch "^[a-z0-9-]+\.local$") {
  throw "ServerName deve ser um nome local simples terminado em .local."
}
$hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
$namePattern = [regex]::Escape($ServerName)
$addressPattern = [regex]::Escape($ServerAddress)
$matching = Get-Content -LiteralPath $hostsPath | Where-Object { $_ -match "(^|\s)$namePattern(\s|$)" }
if ($matching -and -not ($matching | Where-Object { $_ -match "^\s*$addressPattern\s+" })) {
  throw "$ServerName já aponta para outro endereço no arquivo hosts."
}
if (-not $matching) {
  Add-Content -LiteralPath $hostsPath -Value "`r`n$ServerAddress`t$ServerName # SiloNR local"
}

Import-Certificate -FilePath $resolved -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Write-Host "SiloNR local configurado em https://$ServerName ($ServerAddress)."
