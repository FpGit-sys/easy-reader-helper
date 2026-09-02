#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Install','BeforeUpgrade','Uninstall')][string]$Action = 'Install',
    [string]$ConfigurationPath,
    [long]$InstallerWindowHandle = 0,
    [switch]$NonInteractive
)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Admin

function Assert-Configuration([System.Collections.IDictionary]$Config) {
    foreach ($field in @('ServerAddress','BackupPath','LicenseServiceUrl','LicenseClientApiKey','LicenseSigningPublicKey','AdminName','AdminEmail','AdminPassword','Organization','Facility')) {
        if ([string]::IsNullOrWhiteSpace($Config[$field]) -or [string]$Config[$field] -match '[\r\n]') { throw "Preencha corretamente: $field." }
    }
    $allowLoopback = $Config.Contains('AllowLoopback') -and [bool]$Config['AllowLoopback']
    if (-not (Test-PrivateIP $Config.ServerAddress $allowLoopback)) { throw 'Informe o IPv4 privado reservado ao servidor.' }
    if ($Config.LicenseServiceUrl -notmatch '^https://[^/\s]+/functions/v1/?$') { throw 'URL das Edge Functions invalida.' }
    if ($Config.LicenseClientApiKey.Length -lt 24) { throw 'LICENSE_CLIENT_API_KEY muito curta.' }
    $key = [Convert]::FromBase64String($Config.LicenseSigningPublicKey)
    if ($key.Length -ne 44 -or ([BitConverter]::ToString($key,0,12)) -ne '30-2A-30-05-06-03-2B-65-70-03-21-00') { throw 'Use a chave PUBLICA Ed25519 em Base64 DER gerada por license:keys.' }
    if ($Config.AdminPassword.Length -lt 12 -or $Config.AdminPassword.Length -gt 128) { throw 'Senha inicial deve ter de 12 a 128 caracteres.' }
    if ($Config.AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'E-mail invalido.' }
    foreach ($name in @('AdminName','Organization','Facility')) { if ($Config[$name].Length -lt 2 -or $Config[$name].Length -gt 120) { throw "Campo $name deve ter entre 2 e 120 caracteres." } }
    Assert-BackupPath $Config.BackupPath
}
function Register-AppService([string]$Id, [string]$DisplayName, [string]$Executable, [string]$Arguments, [string]$Extra = '') {
    $escape = { param($text) [Security.SecurityElement]::Escape([string]$text) }
    $exe = & $escape $Executable
    $argumentsXml = & $escape $Arguments
    $logs = & $escape (Join-Path $NativeRoot 'logs')
    $working = & $escape $InstallRoot
    $xml = @"
<service>
  <id>$Id</id><name>$DisplayName</name><description>SiloNR local, sem Docker/WSL</description>
  <executable>$exe</executable><arguments>$argumentsXml</arguments><workingdirectory>$working</workingdirectory>
  <serviceaccount><domain>NT AUTHORITY</domain><user>LocalService</user></serviceaccount>
  <startmode>Automatic</startmode><onfailure action="restart" delay="10 sec"/><stoptimeout>30 sec</stoptimeout>
  <logpath>$logs</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>4</keepFiles></log>
  $Extra
</service>
"@
    $wrapper = Join-Path $InstallRoot "services\$Id.exe"
    Write-Utf8 (Join-Path $InstallRoot "services\$Id.xml") $xml
    if (-not (Get-Service $Id -ErrorAction SilentlyContinue)) { Invoke-Native $wrapper @('install') }
    $account = (Get-CimInstance Win32_Service -Filter "Name='$Id'").StartName
    if ($account -notmatch 'LocalService|LOCAL SERVICE') { throw "Conta inesperada para $Id; servico nao iniciado." }
}

try {
    if ($Action -eq 'BeforeUpgrade') {
        if (Test-Path (Join-Path $ConfigRoot 'complete.json')) {
            & (Join-Path $PSScriptRoot 'Maintenance.ps1') -Action Backup
        }
        foreach ($name in $Services) { Stop-NativeService $name }
        exit 0
    }
    if ($Action -eq 'Uninstall') {
        foreach ($name in $Services) { Stop-NativeService $name }
        foreach ($name in @('SiloNRApp','SiloNRHTTPS')) {
            if (Get-Service $name -ErrorAction SilentlyContinue) { Invoke-Native (Join-Path $InstallRoot "services\$name.exe") @('uninstall') }
        }
        if (Get-Service 'SiloNRPostgreSQL' -ErrorAction SilentlyContinue) { Invoke-Native (Join-Path $PgBin 'pg_ctl.exe') @('unregister','-N','SiloNRPostgreSQL') }
        Unregister-ScheduledTask -TaskName 'SiloNR Backup Diario' -Confirm:$false -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName 'SiloNR Monitor' -Confirm:$false -ErrorAction SilentlyContinue
        Get-NetFirewallRule -Name 'SiloNRNativeHTTPS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        # Data, certificates, keys and backups are deliberately NOT removed.
        exit 0
    }

    foreach ($file in @($Node, (Join-Path $PgBin 'initdb.exe'), (Join-Path $InstallRoot 'caddy\caddy.exe'), (Join-Path $PSScriptRoot 'migrate.mjs'))) {
        if (-not (Test-Path $file -PathType Leaf)) { throw "Instalador incompleto: $file" }
    }
    $pending = Join-Path $ConfigRoot 'pending-setup.json'
    $config = $null
    $complete = Test-Path (Join-Path $ConfigRoot 'complete.json')
    if (-not $complete) {
        if (Test-Path $pending) { $raw = Get-Content $pending -Raw -Encoding UTF8 | ConvertFrom-Json }
        elseif ($ConfigurationPath) { $raw = Get-Content -LiteralPath $ConfigurationPath -Raw -Encoding UTF8 | ConvertFrom-Json }
        else {
            if ($NonInteractive) { throw 'A primeira instalacao silenciosa exige /SILONRCONFIG com uma configuracao valida.' }
            . (Join-Path $PSScriptRoot 'Wizard.ps1')
            $config = Show-SetupWizard -InstallerWindowHandle $InstallerWindowHandle
        }
        if (-not $config) { $config = @{}; $raw.PSObject.Properties | ForEach-Object { $config[$_.Name] = $_.Value } }
        Assert-Configuration $config
    }
    foreach ($dir in @($NativeRoot,$ConfigRoot,(Join-Path $NativeRoot 'data'),$ObjectsRoot,$PgData,(Join-Path $NativeRoot 'logs'),(Join-Path $NativeRoot 'caddy'))) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Set-PrivateAcl $NativeRoot 'S-1-5-32-545' 'RX' -Directory
    Invoke-Native "$env:WINDIR\System32\icacls.exe" @($NativeRoot,'/grant:r','*S-1-5-19:(RX)','*S-1-5-20:(RX)') | Out-Null
    Set-PrivateAcl (Join-Path $NativeRoot 'data') 'S-1-5-19' 'RX' -Directory
    Invoke-Native "$env:WINDIR\System32\icacls.exe" @((Join-Path $NativeRoot 'data'),'/grant:r','*S-1-5-20:(RX)') | Out-Null
    Set-PrivateAcl $ConfigRoot -Directory
    Invoke-Native "$env:WINDIR\System32\icacls.exe" @($ConfigRoot,'/grant:r','*S-1-5-19:(RX)') | Out-Null
    Set-PrivateAcl $ObjectsRoot 'S-1-5-19' 'M' -Directory
    Set-PrivateAcl $PgData 'S-1-5-20' 'M' -Directory
    Set-PrivateAcl (Join-Path $NativeRoot 'logs') 'S-1-5-19' 'M' -Directory
    Set-PrivateAcl (Join-Path $NativeRoot 'caddy') 'S-1-5-19' 'M' -Directory
    if ($config) { Write-Utf8 $pending ($config | ConvertTo-Json); Set-PrivateAcl $pending }

    $redistributable = Join-Path $InstallRoot 'prerequisites\vc_redist.x64.exe'
    $requiredRuntime = [version]([Diagnostics.FileVersionInfo]::GetVersionInfo($redistributable).ProductVersion)
    $installedRuntime = [version]'0.0'
    foreach ($registry in @('HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64','HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64')) {
        $runtime = Get-ItemProperty -LiteralPath $registry -ErrorAction SilentlyContinue
        if ($runtime -and $runtime.Installed -eq 1) {
            $version = [version]$runtime.Version.TrimStart('v')
            if ($version -gt $installedRuntime) { $installedRuntime = $version }
        }
    }
    if ($installedRuntime -lt $requiredRuntime) {
        $runtimeInstall = Start-Process $redistributable -ArgumentList '/install','/quiet','/norestart' -Wait -PassThru
        if ($runtimeInstall.ExitCode -eq 3010) { throw 'O runtime Microsoft pediu reinicializacao. Reinicie o Windows e execute o instalador novamente; nao e preciso alterar BIOS.' }
        if ($runtimeInstall.ExitCode -ne 0) { throw "Falha ao instalar runtime Microsoft: $($runtimeInstall.ExitCode)." }
    }

    if (-not (Test-Path $EnvFile)) {
        foreach ($port in @(3000,443,54329)) {
            if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Porta $port em uso. A instalacao nao alterou o servico existente." }
        }
        $dbPassword = New-Secret
        $values = @{
            NODE_ENV='production'; DEPLOYMENT_MODE='local'; HOST='127.0.0.1'; PORT='3000'
            APP_URL='https://silonr.local'; BETTER_AUTH_URL='https://silonr.local'; ALLOW_PUBLIC_SIGNUP='false'
            BETTER_AUTH_SECRET=(New-Secret); DATABASE_URL="postgresql://silonr_app:$dbPassword@127.0.0.1:54329/silonr"; DATABASE_SSL_MODE='disable'
            STORAGE_DRIVER='filesystem'; FILE_STORAGE_PATH=$ObjectsRoot; FILE_DOWNLOAD_SIGNING_SECRET=(New-Secret)
            LICENSE_SERVICE_URL=$config.LicenseServiceUrl.TrimEnd('/'); LICENSE_CLIENT_API_KEY=$config.LicenseClientApiKey
            LICENSE_SIGNING_PUBLIC_KEY=$config.LicenseSigningPublicKey; LICENSE_INSTALLATION_ENCRYPTION_KEY=(New-Secret -Base64)
            LICENSE_REFRESH_INTERVAL_HOURS='24'
        }
        $maintenance = @{ PostgresAdminPassword=(New-Secret); BackupPath=$config.BackupPath; ServerAddress=$config.ServerAddress; Format='silonr-native-v1' }
        Write-Utf8 $MaintenanceFile ($maintenance | ConvertTo-Json)
        Set-PrivateAcl $MaintenanceFile
        Save-Env $values
    }
    if (-not (Test-Path $MaintenanceFile)) { throw 'Arquivo de manutencao ausente. Restaure a configuracao; nao regenere as chaves.' }
    $maintenance = Get-Content $MaintenanceFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-BackupPath $maintenance.BackupPath
    New-Item -ItemType Directory -Path $maintenance.BackupPath -Force | Out-Null
    Set-PrivateAcl $maintenance.BackupPath -Directory

    if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
        if (Get-ChildItem $PgData -Force) { throw 'Diretorio PostgreSQL nao vazio sem PG_VERSION; recuperacao manual necessaria.' }
        $passwordFile = Join-Path $ConfigRoot 'init-password.tmp'
        Write-Utf8 $passwordFile $maintenance.PostgresAdminPassword
        Set-PrivateAcl $passwordFile
        # initdb re-executes with the Administrators SID disabled on Windows.
        # Give that same installer USER (not Users/Everyone) temporary access,
        # then revoke it after handing the cluster to NetworkService.
        $installerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $initOut = Join-Path $ConfigRoot 'initdb.out.log'
        $initErr = Join-Path $ConfigRoot 'initdb.err.log'
        foreach ($log in @($initOut,$initErr)) { Write-Utf8 $log ''; Set-PrivateAcl $log }
        try {
            Invoke-Native "$env:WINDIR\System32\icacls.exe" @($PgData,'/grant:r',("*{0}:(OI)(CI)F" -f $installerSid)) | Out-Null
            foreach ($parent in @((Join-Path $NativeRoot 'data'),$ConfigRoot)) {
                Invoke-Native "$env:WINDIR\System32\icacls.exe" @($parent,'/grant:r',("*{0}:RX" -f $installerSid)) | Out-Null
            }
            Invoke-Native "$env:WINDIR\System32\icacls.exe" @($passwordFile,'/grant:r',("*{0}:R" -f $installerSid)) | Out-Null
            $initArguments = @('-D',('"{0}"' -f $PgData),'-U','postgres','--pwfile',('"{0}"' -f $passwordFile),'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C')
            $init = Start-Process (Join-Path $PgBin 'initdb.exe') -ArgumentList $initArguments -RedirectStandardOutput $initOut -RedirectStandardError $initErr -Wait -PassThru
            if ($init.ExitCode -ne 0) { throw "Falha ao inicializar PostgreSQL ($($init.ExitCode)). Consulte config\initdb.err.log." }
        } finally {
            Remove-Item -LiteralPath $passwordFile -Force -ErrorAction SilentlyContinue
            Invoke-Native "$env:WINDIR\System32\icacls.exe" @($PgData,'/grant:r','*S-1-5-20:(OI)(CI)M','*S-1-5-18:(OI)(CI)F','*S-1-5-32-544:(OI)(CI)F','/T') | Out-Null
            Invoke-Native "$env:WINDIR\System32\icacls.exe" @($PgData,'/remove:g',("*{0}" -f $installerSid),'/T') | Out-Null
            foreach ($parent in @((Join-Path $NativeRoot 'data'),$ConfigRoot)) {
                Invoke-Native "$env:WINDIR\System32\icacls.exe" @($parent,'/remove:g',("*{0}" -f $installerSid)) | Out-Null
            }
        }
        Add-Content (Join-Path $PgData 'postgresql.conf') "listen_addresses = '127.0.0.1'"
        Add-Content (Join-Path $PgData 'postgresql.conf') 'port = 54329'
        # initdb creates children as the installer user; grant the service recursively.
        Invoke-Native "$env:WINDIR\System32\icacls.exe" @($PgData,'/grant','*S-1-5-20:(OI)(CI)M','/T') | Out-Null
    }
    if ((Get-Content (Join-Path $PgData 'PG_VERSION') -Raw).Trim() -ne '16') { throw 'Atualizacao de versao principal PostgreSQL requer migracao assistida.' }
    if (-not (Get-Service 'SiloNRPostgreSQL' -ErrorAction SilentlyContinue)) {
        Invoke-Native (Join-Path $PgBin 'pg_ctl.exe') @('register','-N','SiloNRPostgreSQL','-D',$PgData,'-S','auto','-U','NT AUTHORITY\NetworkService')
    }
    Start-NativeService 'SiloNRPostgreSQL'
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        & (Join-Path $PgBin 'pg_isready.exe') -h 127.0.0.1 -p 54329 -q
        if ($LASTEXITCODE -eq 0) { break }; Start-Sleep -Seconds 1
    }
    $values = Read-Env
    $dbPassword = ([uri]$values.DATABASE_URL).UserInfo.Split(':',2)[1]
    if (-not (Invoke-Database "select 1 from pg_roles where rolname='silonr_app';" -Admin)) {
        # Generated password is base64url only. Never put it in the command line.
        if ($dbPassword -notmatch '^[A-Za-z0-9_-]+$') { throw 'Senha interna invalida.' }
        Invoke-Database "create role silonr_app login password '$dbPassword';" -Admin | Out-Null
    }
    if (-not (Invoke-Database "select 1 from pg_database where datname='silonr';" -Admin)) { Invoke-Database 'create database silonr owner silonr_app;' -Admin | Out-Null }
    Invoke-Migrations
    if (-not $complete) {
        $users = Invoke-Database 'select count(*) from "user";'
        $orgs = Invoke-Database 'select count(*) from organizations;'
        if ([int]$users -eq 0 -and [int]$orgs -eq 0) {
            $env:ALLOW_PUBLIC_SIGNUP='true'; $env:SILONR_BOOTSTRAP_CONFIRM='BOOTSTRAP_SILONR_LOCAL'; $env:SILONR_BOOTSTRAP_PASSWORD=$config.AdminPassword
            try { Invoke-Native $Node @((Join-Path $PSScriptRoot 'bootstrap.mjs'),'--email',$config.AdminEmail,'--name',$config.AdminName,'--organization',$config.Organization,'--facility',$config.Facility) }
            finally { $env:ALLOW_PUBLIC_SIGNUP='false'; Remove-Item Env:SILONR_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue }
        } elseif ([int]$orgs -eq 0) { throw 'Bootstrap anterior incompleto. Nenhum dado foi apagado; solicite recuperacao.' }
    }
    $appArguments = '--env-file="{0}" "{1}"' -f $EnvFile,(Join-Path $InstallRoot 'app\.output\server\index.mjs')
    Register-AppService 'SiloNRApp' 'SiloNR Servidor Local' $Node $appArguments '<depend>SiloNRPostgreSQL</depend>'
    $caddyData = [Security.SecurityElement]::Escape((Join-Path $NativeRoot 'caddy'))
    $caddyArguments = 'run --config "{0}" --adapter caddyfile' -f (Join-Path $InstallRoot 'config\Caddyfile')
    Register-AppService 'SiloNRHTTPS' 'SiloNR HTTPS Local' (Join-Path $InstallRoot 'caddy\caddy.exe') $caddyArguments ('<depend>SiloNRApp</depend><env name="XDG_DATA_HOME" value="' + $caddyData + '"/>')
    Start-NativeService 'SiloNRApp'
    Wait-Ready
    Start-NativeService 'SiloNRHTTPS'
    $certificate = Join-Path $NativeRoot 'caddy\caddy\pki\authorities\local\root.crt'
    for ($attempt=0; $attempt -lt 30 -and -not (Test-Path $certificate); $attempt++) { Start-Sleep -Seconds 2 }
    & (Join-Path $PSScriptRoot 'install-local-ca.ps1') -CertificatePath $certificate -ServerAddress $maintenance.ServerAddress
    Get-NetFirewallRule -Name 'SiloNRNativeHTTPS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -Name 'SiloNRNativeHTTPS' -DisplayName 'SiloNR HTTPS - rede local privada' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -LocalAddress $maintenance.ServerAddress -Profile Private -RemoteAddress LocalSubnet | Out-Null
    Wait-Ready 'https://silonr.local/api/health/ready'

    $connection = Join-Path $NativeRoot 'conectar-outros-pcs'
    New-Item -ItemType Directory -Path $connection -Force | Out-Null
    Copy-Item $certificate (Join-Path $connection 'silonr-local-ca.crt') -Force
    Copy-Item (Join-Path $PSScriptRoot 'Connect.ps1') $connection -Force
    Copy-Item (Join-Path $PSScriptRoot 'install-local-ca.ps1') $connection -Force
    Copy-Item (Join-Path $PSScriptRoot 'Conectar-SiloNR.cmd') $connection -Force
    Write-Utf8 (Join-Path $connection 'servidor.txt') $maintenance.ServerAddress
    Copy-Item (Join-Path $InstallRoot 'desktop\SiloNR-Desktop-Setup.exe') $connection -Force
    $taskArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Action Backup' -f (Join-Path $PSScriptRoot 'Maintenance.ps1')
    $taskAction = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $taskArgs
    Register-ScheduledTask -TaskName 'SiloNR Backup Diario' -Action $taskAction -Trigger (New-ScheduledTaskTrigger -Daily -At '21:00') -User 'SYSTEM' -RunLevel Highest -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) -Force | Out-Null
    $monitorArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Action Monitor' -f (Join-Path $PSScriptRoot 'Maintenance.ps1')
    $monitorAction = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $monitorArgs
    $monitorTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName 'SiloNR Monitor' -Action $monitorAction -Trigger $monitorTrigger -User 'SYSTEM' -RunLevel Highest -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) -Force | Out-Null
    Write-Utf8 (Join-Path $ConfigRoot 'complete.json') (@{ Format='silonr-native-v1'; UpdatedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json)
    Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue
    Write-Host 'SiloNR instalado. Abra https://silonr.local e ative sua licenca em Administracao.'
    exit 0
} catch {
    $failedLine = $_.InvocationInfo.ScriptLineNumber
    if ($Action -eq 'Install') { Stop-NativeService 'SiloNRApp'; Stop-NativeService 'SiloNRHTTPS' }
    $message = "Linha ${failedLine}: " + $_.Exception.Message
    if (Test-Path $NativeRoot) { Write-Utf8 (Join-Path $NativeRoot 'setup-error.txt') $message }
    Write-Error $message -ErrorAction Continue
    exit 1
}
