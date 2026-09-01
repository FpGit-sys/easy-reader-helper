#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([ValidateSet('Backup','Restore','Diagnostics','Monitor')][string]$Action = 'Backup', [string]$BackupPath, [string]$Confirmation, [string]$LegacyEnvironment)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-Admin

function Copy-PrivateTree([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    if (-not (Test-Path $Source -PathType Container)) { throw "Pasta ausente: $Source" }
    if ((Get-Item $Source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Links nao permitidos no backup.' }
    foreach ($entry in Get-ChildItem -LiteralPath $Source -Recurse -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Link recusado: $($entry.Name)" }
    }
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}
function Backup-Native {
    $maintenance = Get-Content $MaintenanceFile -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-BackupPath $maintenance.BackupPath
    $bundle = Join-Path $maintenance.BackupPath ('SiloNR-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $bundle -Force | Out-Null
    Set-PrivateAcl $bundle -Directory
    $running = @('SiloNRHTTPS','SiloNRApp') | Where-Object { (Get-Service $_ -ErrorAction SilentlyContinue).Status -eq 'Running' }
    try {
        foreach ($name in $running) { Stop-NativeService $name }
        $values = Read-Env
        $env:PGPASSWORD = ([uri]$values.DATABASE_URL).UserInfo.Split(':',2)[1]
        Invoke-Native (Join-Path $PgBin 'pg_dump.exe') @('-h','127.0.0.1','-p','54329','-U','silonr_app','-d','silonr','-Fc','-f',(Join-Path $bundle 'database.dump'))
        Invoke-Native (Join-Path $PgBin 'pg_restore.exe') @('--list',(Join-Path $bundle 'database.dump')) | Out-Null
        Copy-PrivateTree $ObjectsRoot (Join-Path $bundle 'objects')
        Copy-PrivateTree (Join-Path $NativeRoot 'caddy') (Join-Path $bundle 'tls')
        $recovery = @{}
        foreach ($key in @('BETTER_AUTH_SECRET','FILE_DOWNLOAD_SIGNING_SECRET','LICENSE_SERVICE_URL','LICENSE_CLIENT_API_KEY','LICENSE_SIGNING_PUBLIC_KEY','LICENSE_INSTALLATION_ENCRYPTION_KEY')) { $recovery[$key] = $values[$key] }
        Write-Utf8 (Join-Path $bundle 'recovery.json') ($recovery | ConvertTo-Json)
        $entries = @(Get-ChildItem $bundle -Recurse -File | ForEach-Object {
            @{ path=$_.FullName.Substring($bundle.Length+1).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
        })
        Write-Utf8 (Join-Path $bundle 'manifest.json') (@{ format='silonr-native-backup-v2'; createdAt=[DateTime]::UtcNow.ToString('o'); files=$entries } | ConvertTo-Json -Depth 5)
        Write-Host "Backup completo: $bundle. Contem dados e chaves: mantenha em disco criptografado."
        return $bundle
    } catch {
        Write-Utf8 (Join-Path $bundle 'INCOMPLETE.txt') 'Backup incompleto. Nao usar para restaurar.'
        throw
    } finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        foreach ($name in @('SiloNRApp','SiloNRHTTPS')) { if ($name -in $running) { Start-NativeService $name } }
    }
}
function Resolve-BackupEntry([string]$Root, [string]$Relative) {
    if (-not $Relative -or [IO.Path]::IsPathRooted($Relative) -or $Relative -match '[:\\]' -or $Relative.Split('/') -contains '..') { throw 'Caminho inseguro no manifesto.' }
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $resolved = [IO.Path]::GetFullPath((Join-Path $Root $Relative.Replace('/','\')))
    if (-not $resolved.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)) { throw 'Caminho fora do backup.' }
    return $resolved
}
function Restore-Native {
    if ($Confirmation -ne 'RESTORE_SILONR_WINDOWS') { throw 'Confirme explicitamente com -Confirmation RESTORE_SILONR_WINDOWS.' }
    if (-not (Test-Path -LiteralPath $BackupPath -PathType Container)) { throw 'Selecione a pasta do backup.' }
    $source = (Resolve-Path -LiteralPath $BackupPath).Path
    if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Links nao permitidos no backup.' }
    if (Test-Path (Join-Path $source 'INCOMPLETE.txt')) { throw 'Backup marcado como incompleto.' }
    foreach ($entry in Get-ChildItem $source -Recurse -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Links nao permitidos no backup.' }
    }
    $native = Test-Path (Join-Path $source 'manifest.json')
    if ($native) {
        $manifest = Get-Content (Join-Path $source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($manifest.format -ne 'silonr-native-backup-v2') { throw 'Formato de backup invalido.' }
        $entries = @($manifest.files)
        $rawRecovery = Get-Content (Join-Path $source 'recovery.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $recovery = @{}; $rawRecovery.PSObject.Properties | ForEach-Object { $recovery[$_.Name]=$_.Value }
    } else {
        if (-not $LegacyEnvironment) { throw 'Backup Docker exige -LegacyEnvironment com o .env original para preservar as licencas cifradas.' }
        if ((Get-Content (Join-Path $source 'manifest.txt') -Raw) -notmatch '(?m)^format=silonr-local-backup-v1\s*$') { throw 'Backup Docker incompativel.' }
        $entries = @(foreach ($line in Get-Content (Join-Path $source 'SHA256SUMS')) {
            if ($line -notmatch '^([a-fA-F0-9]{64})\s+\*?(.+)$') { throw 'Checksum Docker invalido.' }
            [pscustomobject]@{path=$Matches[2]; sha256=$Matches[1].ToLowerInvariant()}
        })
        $recovery = @{}
        foreach ($line in Get-Content -LiteralPath $LegacyEnvironment -Encoding UTF8) {
            if ($line -match '^([A-Z_][A-Z0-9_]*)=(.*)$') { $recovery[$Matches[1]]=$Matches[2] }
        }
    }
    $known = @{}
    foreach ($entry in $entries) {
        $file = Resolve-BackupEntry $source $entry.path
        if ($known.ContainsKey($file)) { throw 'Entrada duplicada no backup.' }
        $known[$file]=$true
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) { throw "Checksum invalido: $($entry.path)" }
    }
    if (-not $known.ContainsKey((Join-Path $source 'database.dump'))) { throw 'Dump nao esta no manifesto.' }
    foreach ($file in Get-ChildItem (Join-Path $source 'objects') -Recurse -File) {
        if (-not $known.ContainsKey($file.FullName)) { throw 'Objeto nao verificado no backup.' }
    }
    if ($native) {
        if (-not $known.ContainsKey((Join-Path $source 'recovery.json'))) { throw 'Configuracao de recuperacao nao verificada.' }
        foreach ($file in Get-ChildItem (Join-Path $source 'tls') -Recurse -File) {
            if (-not $known.ContainsKey($file.FullName)) { throw 'Arquivo TLS nao verificado.' }
        }
    }
    foreach ($key in @('BETTER_AUTH_SECRET','LICENSE_INSTALLATION_ENCRYPTION_KEY')) {
        if (-not $recovery.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($recovery[$key])) { throw "Chave de recuperacao ausente: $key" }
    }
    if ([Convert]::FromBase64String($recovery.LICENSE_INSTALLATION_ENCRYPTION_KEY).Length -ne 32) { throw 'Chave de criptografia da instalacao invalida.' }
    foreach ($key in @('BETTER_AUTH_SECRET','FILE_DOWNLOAD_SIGNING_SECRET','LICENSE_SERVICE_URL','LICENSE_CLIENT_API_KEY','LICENSE_SIGNING_PUBLIC_KEY','LICENSE_INSTALLATION_ENCRYPTION_KEY')) {
        if ($recovery.ContainsKey($key)) {
            $value = [string]$recovery[$key]
            if ($value -match '[\r\n#]' -or $value.Contains([char]34) -or $value.Contains([char]39)) { throw "Configuracao de recuperacao invalida: $key" }
        }
    }
    Invoke-Native (Join-Path $PgBin 'pg_restore.exe') @('--list',(Join-Path $source 'database.dump')) | Out-Null
    $safety = Backup-Native
    Write-Host "Backup de seguranca preservado em $safety"
    Stop-NativeService 'SiloNRHTTPS'; Stop-NativeService 'SiloNRApp'
    $succeeded = $false
    try {
        Invoke-Database 'drop database if exists silonr with (force);' -Admin | Out-Null
        Invoke-Database 'create database silonr owner silonr_app;' -Admin | Out-Null
        $values = Read-Env
        $env:PGPASSWORD = ([uri]$values.DATABASE_URL).UserInfo.Split(':',2)[1]
        Invoke-Native (Join-Path $PgBin 'pg_restore.exe') @('-h','127.0.0.1','-p','54329','-U','silonr_app','-d','silonr','--no-owner','--no-privileges','--exit-on-error',(Join-Path $source 'database.dump'))
        $suffix = '.before-restore-' + [guid]::NewGuid().ToString('N')
        Move-Item -LiteralPath $ObjectsRoot -Destination ($ObjectsRoot+$suffix)
        Copy-PrivateTree (Join-Path $source 'objects') $ObjectsRoot
        Set-PrivateAcl $ObjectsRoot 'S-1-5-19' 'M' -Directory
        Invoke-Native "$env:WINDIR\System32\icacls.exe" @($ObjectsRoot,'/grant','*S-1-5-19:(OI)(CI)M','/T') | Out-Null
        foreach ($key in @('BETTER_AUTH_SECRET','FILE_DOWNLOAD_SIGNING_SECRET','LICENSE_SERVICE_URL','LICENSE_CLIENT_API_KEY','LICENSE_SIGNING_PUBLIC_KEY','LICENSE_INSTALLATION_ENCRYPTION_KEY')) {
            if ($recovery.ContainsKey($key)) { $values[$key] = $recovery[$key] }
        }
        Save-Env $values
        if ($native) {
            Move-Item -LiteralPath (Join-Path $NativeRoot 'caddy') -Destination (Join-Path $NativeRoot ('caddy'+$suffix))
            Copy-PrivateTree (Join-Path $source 'tls') (Join-Path $NativeRoot 'caddy')
            Invoke-Native "$env:WINDIR\System32\icacls.exe" @((Join-Path $NativeRoot 'caddy'),'/grant','*S-1-5-19:(OI)(CI)M','/T') | Out-Null
        }
        Invoke-Migrations
        Invoke-Native $Node @((Join-Path $PSScriptRoot 'verify-storage.mjs'))
        $succeeded = $true
    } finally {
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        if ($succeeded) { Start-NativeService 'SiloNRApp'; Start-NativeService 'SiloNRHTTPS'; Wait-Ready }
    }
    Write-Host 'Restauracao concluida. Arquivos anteriores preservados nas pastas before-restore e no backup de seguranca.'
    Write-Host 'Se mudou de servidor, execute novamente Setup para atualizar o pacote de conexao/certificado.'
}

$mutex = New-Object Threading.Mutex($false, 'Global\SiloNRNativeMaintenance')
$locked = $false
try {
    try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Outra operacao de manutencao esta em andamento. Tente novamente depois.' }
    switch ($Action) {
        'Backup' { Backup-Native | Out-Null }
        'Restore' { Restore-Native }
        'Monitor' {
            $healthy = $true
            try { $ready = Invoke-RestMethod 'http://127.0.0.1:3000/api/health/ready' -TimeoutSec 10; $healthy = $ready.status -eq 'ready' } catch { $healthy = $false }
            $maintenance = Get-Content $MaintenanceFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $drives = @([IO.Path]::GetPathRoot($NativeRoot), [IO.Path]::GetPathRoot($maintenance.BackupPath)) | Select-Object -Unique
            $disks = @(foreach ($drive in $drives) {
                $info = New-Object IO.DriveInfo($drive)
                if (-not $info.IsReady -or $info.AvailableFreeSpace -lt 5GB) { $healthy = $false }
                @{ drive=$drive; available=if ($info.IsReady) { $info.AvailableFreeSpace } else { 0 } }
            })
            $states = @(Get-Service -Name $Services | Select-Object Name,Status)
            if ($states | Where-Object { $_.Status -ne 'Running' }) { $healthy = $false }
            Write-Utf8 (Join-Path $NativeRoot 'monitor.json') (@{ healthy=$healthy; checkedAt=[DateTime]::UtcNow.ToString('o'); services=$states; disk=$disks } | ConvertTo-Json -Depth 5)
            if (-not $healthy) { throw 'Monitor: servico indisponivel ou menos de 5 GB livres. Consulte monitor.json.' }
        }
        'Diagnostics' {
            # Deliberately exclude logs, environment, recovery files and credentials.
            $report = @{
                version = (Get-Content (Join-Path $InstallRoot 'version.txt') -Raw).Trim()
                services = @(Get-Service -Name $Services | Select-Object Name,Status)
                disk = @(Get-Volume | Select-Object DriveLetter,Size,SizeRemaining,HealthStatus)
                lastBackupTask = (Get-ScheduledTaskInfo -TaskName 'SiloNR Backup Diario' | Select-Object LastRunTime,LastTaskResult)
            }
            $output = Join-Path $NativeRoot 'diagnostico.json'
            Write-Utf8 $output ($report | ConvertTo-Json -Depth 5)
            Write-Host "Diagnostico sem segredos: $output"
        }
    }
} catch { Write-Error $_.Exception.Message -ErrorAction Continue; throw }
finally { if ($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
