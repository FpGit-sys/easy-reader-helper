$ErrorActionPreference='Stop'
$repository=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$setup=(Get-ChildItem (Join-Path $repository 'artifacts\windows-server\output\*.exe') | Select-Object -First 1).FullName
$configPath=Join-Path $env:RUNNER_TEMP 'silonr-native-config.json'
$publicKey=& node -e "process.stdout.write(require('node:crypto').generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64'))"
$config=@{
    ServerAddress='127.0.0.1'; AllowLoopback=$true; BackupPath='C:\SiloNR-CI-Backups'
    LicenseServiceUrl='https://ci-placeholder.supabase.co/functions/v1'
    LicenseClientApiKey=([guid]::NewGuid().ToString('N')); LicenseSigningPublicKey=$publicKey
    AdminName='Administrador CI'; AdminEmail='native@silonr.local'; AdminPassword='Native-CI-Password-2026!'
    Organization='Empresa CI'; Facility='Unidade CI'
}
$config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
$arguments=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/SILONRCONFIG="{0}"' -f $configPath))
$result=Start-Process $setup -ArgumentList $arguments -Wait -PassThru
if ($result.ExitCode -ne 0) { throw "Instalador falhou: $($result.ExitCode)" }
$installed='C:\Program Files\SiloNR Server'
$tools=Join-Path $installed 'tools'
. (Join-Path $tools 'Common.ps1')
Wait-Ready 'https://silonr.local/api/health/ready'
foreach ($name in @('SiloNRApp','SiloNRHTTPS')) {
    $service=Get-CimInstance Win32_Service -Filter "Name='$name'"
    if ($service.StartName -notmatch 'LocalService|LOCAL SERVICE') { throw 'Servico da aplicacao com conta inesperada.' }
}
$login=@{email=$config.AdminEmail;password=$config.AdminPassword} | ConvertTo-Json
$session=New-Object Microsoft.PowerShell.Commands.WebRequestSession
Invoke-RestMethod 'https://silonr.local/api/auth/sign-in/email' -Method Post -ContentType 'application/json' -Body $login -WebSession $session | Out-Null
try {
    Invoke-RestMethod 'https://silonr.local/api/auth/sign-up/email' -Method Post -ContentType 'application/json' -Body '{"name":"Intruso","email":"intruso@silonr.local","password":"Not-Allowed-2026!"}' | Out-Null
    throw 'Cadastro publico estava aberto.'
} catch { if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 403) { throw } }
$bytes=[Text.Encoding]::UTF8.GetBytes('%PDF-1.7 native smoke')
$hash=[Security.Cryptography.SHA256]::Create()
try { $digest=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
$key='native-smoke/report.pdf'
New-Item -ItemType Directory (Join-Path $ObjectsRoot 'native-smoke') -Force | Out-Null
[IO.File]::WriteAllBytes((Join-Path $ObjectsRoot $key),$bytes)
$sql="insert into evidences (organization_id,facility_id,type,name,storage_key,mime_type,size_bytes,sha256,captured_by) select f.organization_id,f.id,'documento','native smoke','$key','application/pdf',$($bytes.Length),'$digest',u.id from facilities f cross join ""user"" u limit 1;"
Invoke-Database $sql | Out-Null
$values=Read-Env
$expires=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()+180
$hmac=New-Object Security.Cryptography.HMACSHA256
$hmac.Key=[Text.Encoding]::UTF8.GetBytes($values.FILE_DOWNLOAD_SIGNING_SECRET)
try {
    $payload="silonr-download-v1" + [char]10 + $expires + [char]10 + $key
    $signature=[Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))).TrimEnd('=').Replace('+','-').Replace('/','_')
} finally { $hmac.Dispose() }
$url="https://silonr.local/api/files/private?key=$key&expires=$expires&signature=$signature"
$download=Invoke-WebRequest -UseBasicParsing $url
if ($download.Headers['x-silonr-sha256'] -ne $digest) { throw 'Download privado divergente.' }
try { Invoke-WebRequest -UseBasicParsing ($url+'x') | Out-Null; throw 'Assinatura adulterada aceita.' }
catch { if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 403) { throw } }
& (Join-Path $tools 'Maintenance.ps1') -Action Backup
$backup=(Get-ChildItem C:\SiloNR-CI-Backups -Directory | Sort-Object Name | Select-Object -Last 1).FullName
$before=(Get-FileHash $EnvFile -Algorithm SHA256).Hash
[IO.File]::WriteAllText((Join-Path $ObjectsRoot $key),'corrupted')
& (Join-Path $tools 'Maintenance.ps1') -Action Restore -BackupPath $backup -Confirmation RESTORE_SILONR_WINDOWS
if ((Get-FileHash (Join-Path $ObjectsRoot $key) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) { throw 'Restore nao recuperou evidencia.' }
if ((Get-FileHash $EnvFile -Algorithm SHA256).Hash -ne $before) { throw 'Restore alterou chaves da instalacao.' }
$result=Start-Process $setup -ArgumentList $arguments -Wait -PassThru
if ($result.ExitCode -ne 0) { throw 'Atualizacao/reparo falhou.' }
Wait-Ready 'https://silonr.local/api/health/ready'
if ((Get-FileHash $EnvFile -Algorithm SHA256).Hash -ne $before) { throw 'Atualizacao alterou segredos.' }
if ([int](Invoke-Database "select count(*) from evidences where name='native smoke';") -ne 1) { throw 'Atualizacao perdeu dados.' }
if (-not (Test-Path C:\ProgramData\SiloNR\conectar-outros-pcs\SiloNR-Desktop-Setup.exe)) { throw 'Conector Desktop ausente.' }
& (Join-Path $tools 'Maintenance.ps1') -Action Diagnostics
$uninstall=Start-Process (Join-Path $installed 'unins000.exe') -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw 'Desinstalacao falhou.' }
if (-not (Test-Path $EnvFile) -or -not (Test-Path (Join-Path $ObjectsRoot $key))) { throw 'Desinstalacao apagou dados.' }
Write-Host 'Native install, TLS, login, private download, backup/restore, upgrade and uninstall passed.'
