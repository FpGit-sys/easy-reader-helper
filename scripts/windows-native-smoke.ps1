$ErrorActionPreference='Stop'
$repository=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$setup=(Get-ChildItem (Join-Path $repository 'artifacts\windows-server\output\*.exe') | Select-Object -First 1).FullName
$configPath=Join-Path $env:RUNNER_TEMP 'silonr-native-config.json'
$publicKey=& node -e "process.stdout.write(require('node:crypto').generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64'))"
$config=@{
    ServerAddress='127.0.0.1'; AllowLoopback=$true; BackupPath=('C:\SiloNR-CI-Backups-' + [char]0x00e7)
    LicenseServiceUrl='https://ci-placeholder.supabase.co/functions/v1'
    LicenseClientApiKey=([guid]::NewGuid().ToString('N')); LicenseSigningPublicKey=$publicKey
    AdminName='Administrador CI'; AdminEmail='native@silonr.local'; AdminPassword='Native-CI-Password-2026!'
    Organization='Empresa CI'; Facility='Unidade CI'
}
$config | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
$arguments=@('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/SILONRCONFIG="{0}"' -f $configPath))
# Unattended first installs must fail promptly instead of hiding an input dialog.
$missing=Start-Process $setup -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -PassThru
try {
    if (-not $missing.WaitForExit(60000)) { Stop-Process -Id $missing.Id -Force; throw 'Instalacao silenciosa aguardou um formulario oculto.' }
    if ($missing.ExitCode -eq 0) { throw 'Instalacao sem configuracao foi aceita.' }
} finally { $missing.Dispose() }
# Invalid input must produce a nonzero installer exit, not a false success.
$invalidPath=Join-Path $env:RUNNER_TEMP 'silonr-native-invalid.json'
$invalid=$config.Clone(); $invalid.ServerAddress='invalid'
$invalid | ConvertTo-Json | Set-Content $invalidPath -Encoding UTF8
$rejected=Start-Process $setup -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/SILONRCONFIG="{0}"' -f $invalidPath)) -Wait -PassThru
if ($rejected.ExitCode -eq 0) { throw 'Instalador ocultou falha de configuracao.' }
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
# HttpClient preserves the response body on HTTP 400 in Windows PowerShell 5.1,
# where Invoke-RestMethod may leave ErrorDetails null.
Add-Type -AssemblyName System.Net.Http
$http = [Net.Http.HttpClient]::new()
$content = [Net.Http.StringContent]::new('{"name":"Intruso","email":"intruso@silonr.local","password":"Not-Allowed-2026!"}', [Text.Encoding]::UTF8, 'application/json')
try {
    $rejectedSignup = $http.PostAsync('https://silonr.local/api/auth/sign-up/email', $content).GetAwaiter().GetResult()
    try {
        $errorPayload = $rejectedSignup.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        if ([int]$rejectedSignup.StatusCode -ne 400 -or $errorPayload.code -ne 'EMAIL_PASSWORD_SIGN_UP_DISABLED') { throw 'Cadastro publico nao foi bloqueado pelo motivo esperado.' }
    } finally { $rejectedSignup.Dispose() }
} finally { $content.Dispose(); $http.Dispose() }
Write-Host 'Installation, service identities, HTTPS, login and signup restriction passed.'
& (Join-Path $PSScriptRoot 'windows-native-desktop-smoke.ps1') -Mode online
$offlineDatabase = Join-Path $env:APPDATA 'br.com.silonr.desktop\silonr-offline.db'
try {
    Stop-NativeService 'SiloNRHTTPS'
    Stop-NativeService 'SiloNRApp'
    & (Join-Path $PSScriptRoot 'windows-native-desktop-smoke.ps1') -Mode unavailable
    & (Join-Path $PSScriptRoot 'windows-native-desktop-smoke.ps1') -Mode offline
} finally {
    Start-NativeService 'SiloNRApp'
    Start-NativeService 'SiloNRHTTPS'
}
Wait-Ready 'https://silonr.local/api/health/ready'
$offlineBefore = (Get-FileHash $offlineDatabase -Algorithm SHA256).Hash
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
$backup=(Get-ChildItem -LiteralPath $config.BackupPath -Directory | Sort-Object Name | Select-Object -Last 1).FullName
$before=(Get-FileHash $EnvFile -Algorithm SHA256).Hash
[IO.File]::WriteAllText((Join-Path $ObjectsRoot $key),'corrupted')
& (Join-Path $tools 'Maintenance.ps1') -Action Restore -BackupPath $backup -Confirmation RESTORE_SILONR_WINDOWS
if ((Get-FileHash (Join-Path $ObjectsRoot $key) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) { throw 'Restore nao recuperou evidencia.' }
if ((Get-FileHash $EnvFile -Algorithm SHA256).Hash -ne $before) { throw 'Restore alterou chaves da instalacao.' }
$tlsAcl = Get-Acl (Join-Path $NativeRoot 'caddy\caddy\pki\authorities\local\root.key')
foreach ($rule in $tlsAcl.Access) {
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($sid -in @('S-1-1-0','S-1-5-11','S-1-5-32-545')) { throw 'Restore expos chave TLS a usuarios comuns.' }
}
$result=Start-Process $setup -ArgumentList $arguments -Wait -PassThru
if ($result.ExitCode -ne 0) { throw 'Atualizacao/reparo falhou.' }
Wait-Ready 'https://silonr.local/api/health/ready'
if ((Get-FileHash $EnvFile -Algorithm SHA256).Hash -ne $before) { throw 'Atualizacao alterou segredos.' }
if ((Get-FileHash $offlineDatabase -Algorithm SHA256).Hash -ne $offlineBefore) { throw 'Atualizacao alterou dados offline do Desktop.' }
if ([int](Invoke-Database "select count(*) from evidences where name='native smoke';") -ne 1) { throw 'Atualizacao perdeu dados.' }
if (-not (Test-Path C:\ProgramData\SiloNR\conectar-outros-pcs\SiloNR-Desktop-Setup.exe)) { throw 'Conector Desktop ausente.' }
& (Join-Path $tools 'Maintenance.ps1') -Action Diagnostics
& (Join-Path $tools 'Maintenance.ps1') -Action Monitor
$uninstall=Start-Process (Join-Path $installed 'unins000.exe') -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait -PassThru
if ($uninstall.ExitCode -ne 0) { throw 'Desinstalacao falhou.' }
if (-not (Test-Path $EnvFile) -or -not (Test-Path (Join-Path $ObjectsRoot $key))) { throw 'Desinstalacao apagou dados.' }
if ((Get-FileHash $offlineDatabase -Algorithm SHA256).Hash -ne $offlineBefore) { throw 'Desinstalacao alterou dados offline do Desktop.' }
if (Test-Path (Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'SiloNR.lnk')) { throw 'Desinstalacao deixou o atalho do Desktop.' }
Write-Host 'Native install, TLS, login, private download, backup/restore, upgrade and uninstall passed.'
