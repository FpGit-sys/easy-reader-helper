Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$InstallRoot = Split-Path -Parent $PSScriptRoot
$NativeRoot = Join-Path $env:ProgramData 'SiloNR'
$ConfigRoot = Join-Path $NativeRoot 'config'
$EnvFile = Join-Path $ConfigRoot 'server.env'
$MaintenanceFile = Join-Path $ConfigRoot 'maintenance.json'
$ObjectsRoot = Join-Path $NativeRoot 'data\evidencias'
$PgData = Join-Path $NativeRoot 'data\postgres'
$PgBin = Join-Path $InstallRoot 'postgres\pgsql\bin'
$Node = Join-Path $InstallRoot 'runtime\node.exe'
$Services = @('SiloNRApp', 'SiloNRHTTPS', 'SiloNRPostgreSQL')

function Assert-Admin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Execute como administrador.' }
}
function Invoke-Native([string]$Exe, [string[]]$Arguments = @()) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Falha em $([IO.Path]::GetFileName($Exe)); codigo $LASTEXITCODE." }
}
function New-Secret([int]$Length = 32, [switch]$Base64) {
    $bytes = New-Object byte[] $Length
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $value = [Convert]::ToBase64String($bytes)
    if ($Base64) { return $value }
    return $value.TrimEnd('=').Replace('+','-').Replace('/','_')
}
function Set-PrivateAcl([string]$Path, [string]$ServiceSid = '', [string]$Rights = 'M', [switch]$Directory) {
    $inherit = if ($Directory) { '(OI)(CI)' } else { '' }
    $arguments = @($Path, '/inheritance:r', '/grant:r', ('*S-1-5-18:{0}F' -f $inherit), ('*S-1-5-32-544:{0}F' -f $inherit))
    if ($ServiceSid) { $arguments += ('*{0}:{1}{2}' -f $ServiceSid,$inherit,$Rights) }
    Invoke-Native "$env:WINDIR\System32\icacls.exe" $arguments | Out-Null
}
function Write-Utf8([string]$Path, [string]$Text) {
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}
function Read-Env {
    $values = @{}
    foreach ($line in [IO.File]::ReadAllLines($EnvFile)) {
        if ($line -match '^([A-Z_][A-Z0-9_]*)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
    }
    return $values
}
function Save-Env([System.Collections.IDictionary]$Values) {
    $lines = foreach ($key in ($Values.Keys | Sort-Object)) {
        $value = [string]$Values[$key]
        if ($value -match '[\r\n#]' -or $value.Contains([char]34) -or $value.Contains([char]39)) { throw "Valor inseguro no campo $key." }
        "$key=$value"
    }
    Write-Utf8 $EnvFile (($lines -join [Environment]::NewLine) + [Environment]::NewLine)
    Set-PrivateAcl $EnvFile 'S-1-5-19' 'R'
}
function Import-Env {
    $values = Read-Env
    foreach ($key in $values.Keys) { [Environment]::SetEnvironmentVariable($key, $values[$key], 'Process') }
}
function Invoke-Database([string]$Sql, [switch]$Admin) {
    $maintenance = Get-Content -LiteralPath $MaintenanceFile -Raw | ConvertFrom-Json
    $values = Read-Env
    $user = 'silonr_app'; $database = 'silonr'
    $password = ([uri]$values.DATABASE_URL).UserInfo.Split(':',2)[1]
    if ($Admin) { $user = 'postgres'; $database = 'postgres'; $password = $maintenance.PostgresAdminPassword }
    $previous = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = $password
        $result = $Sql | & (Join-Path $PgBin 'psql.exe') -X -h 127.0.0.1 -p 54329 -U $user -d $database -v ON_ERROR_STOP=1 -At -f -
        if ($LASTEXITCODE -ne 0) { throw 'Falha na operacao de banco.' }
        return $result
    } finally { $env:PGPASSWORD = $previous }
}
function Invoke-Migrations {
    Import-Env
    $env:SILONR_MIGRATIONS_PATH = Join-Path $InstallRoot 'migrations'
    Invoke-Native $Node @((Join-Path $InstallRoot 'tools\migrate.mjs'))
    Invoke-Native $Node @((Join-Path $InstallRoot 'tools\licensing.mjs'))
}
function Stop-NativeService([string]$Name) {
    $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne 'Stopped') {
        Stop-Service $Name -Force
        $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    }
}
function Start-NativeService([string]$Name) {
    Start-Service $Name
    (Get-Service $Name).WaitForStatus('Running', [TimeSpan]::FromSeconds(60))
}
function Test-PrivateIP([string]$Value, [bool]$AllowLoopback = $false) {
    $address = $null
    if (-not [Net.IPAddress]::TryParse($Value, [ref]$address)) { return $false }
    $b = $address.GetAddressBytes()
    return $b.Length -eq 4 -and ($b[0] -eq 10 -or ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or ($b[0] -eq 192 -and $b[1] -eq 168) -or ($AllowLoopback -and $b[0] -eq 127))
}
function Wait-Ready([string]$Url = 'http://127.0.0.1:3000/api/health/ready') {
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        try {
            $response = Invoke-RestMethod -Uri $Url -TimeoutSec 3
            if ($response.status -eq 'ready') { return }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw "Servidor indisponivel: $Url. Consulte os logs em $NativeRoot\logs."
}
function Assert-BackupPath([string]$Path) {
    if (-not [IO.Path]::IsPathRooted($Path) -or $Path.StartsWith('\\')) { throw 'Use uma pasta de backup em disco local/externo. NAS exige configuracao adicional de conta.' }
    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
    foreach ($reserved in @($NativeRoot, $InstallRoot)) {
        $base = [IO.Path]::GetFullPath($reserved).TrimEnd('\') + '\'
        if ($candidate.StartsWith($base, [StringComparison]::OrdinalIgnoreCase) -or $base.StartsWith($candidate, [StringComparison]::OrdinalIgnoreCase)) { throw 'A pasta de backup deve ficar fora das pastas do SiloNR.' }
    }
}
