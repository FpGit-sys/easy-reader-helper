#Requires -Version 5.1
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$repository=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$stage=Join-Path $repository 'artifacts\windows-server\stage'
$output=Join-Path $repository 'artifacts\windows-server\output'
$cache=Join-Path $repository 'artifacts\windows-server\downloads'
if (Test-Path $stage) { throw 'Stage ja existe. Use um checkout limpo para produzir o instalador.' }
foreach ($dir in @($stage,$output,$cache)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
foreach ($dir in @('app','runtime','tools','config','migrations','postgres','caddy','desktop','services','licenses','prerequisites')) { New-Item -ItemType Directory -Path (Join-Path $stage $dir) | Out-Null }
function Get-Verified([string]$Url,[string]$Name,[string]$Sha) {
    $file=Join-Path $cache $Name
    Write-Host "Downloading and verifying $Name"
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $file
    if ((Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha) { throw "Hash invalido: $Name" }
    return $file
}
Copy-Item (Join-Path $repository '.output') (Join-Path $stage 'app\.output') -Recurse
Copy-Item (Join-Path $repository 'drizzle\*') (Join-Path $stage 'migrations') -Recurse
Copy-Item (Get-Command node.exe).Source (Join-Path $stage 'runtime\node.exe')
Copy-Item (Join-Path $PSScriptRoot '*.ps1') (Join-Path $stage 'tools')
Copy-Item (Join-Path $PSScriptRoot '*.cmd') (Join-Path $stage 'tools')
Copy-Item (Join-Path $repository 'scripts\install-local-ca.ps1') (Join-Path $stage 'tools')
Copy-Item (Join-Path $PSScriptRoot 'Caddyfile') (Join-Path $stage 'config')
foreach ($tool in @(@('scripts/native-migrate.ts','migrate'),@('scripts/migrate-licensing.ts','licensing'),@('scripts/bootstrap-local.ts','bootstrap'),@('scripts/native-verify-storage.ts','verify-storage'))) {
    & bun build --target=node --format=esm (Join-Path $repository $tool[0]) --outfile (Join-Path $stage ('tools\'+$tool[1]+'.mjs'))
    if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar $($tool[1])." }
}
$pg=Get-Verified 'https://get.enterprisedb.com/postgresql/postgresql-16.15-1-windows-x64-binaries.zip' 'postgres.zip' '25e6fcdfb8caec38691bf461125e7564508760666f7b8e5dc6a5f0818f58f81e'
# Do not extract pgAdmin/Python/StackBuilder: they are not server dependencies.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($pg)
try {
    $pgTarget=(Join-Path $stage 'postgres') + '\'
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -notmatch '^pgsql/(bin/|lib/|share/|[^/]+\.txt$)' -or -not $entry.Name) { continue }
        $destination=[IO.Path]::GetFullPath((Join-Path $pgTarget $entry.FullName.Replace('/','\')))
        if (-not $destination.StartsWith($pgTarget,[StringComparison]::OrdinalIgnoreCase)) { throw 'Caminho invalido no pacote PostgreSQL.' }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$false)
    }
} finally { $archive.Dispose() }
$vc=Get-Verified 'https://aka.ms/vs/17/release/vc_redist.x64.exe' 'vc_redist.x64.exe' 'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b'
$signature=Get-AuthenticodeSignature $vc
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Redistributable sem assinatura Microsoft valida.' }
Copy-Item $vc (Join-Path $stage 'prerequisites\vc_redist.x64.exe')
$caddy=Get-Verified 'https://github.com/caddyserver/caddy/releases/download/v2.10.2/caddy_2.10.2_windows_amd64.zip' 'caddy.zip' '9fd1ef9be5d9b05852b66ccc25f96f23d8651bcab20779861a745bdffa273722'
Expand-Archive $caddy (Join-Path $stage 'caddy')
$winsw=Get-Verified 'https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe' 'winsw.exe' '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'
Copy-Item $winsw (Join-Path $stage 'services\SiloNRApp.exe')
Copy-Item $winsw (Join-Path $stage 'services\SiloNRHTTPS.exe')
$nodeVersion=(& node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.[0-9]+\.[0-9]+$') { throw 'Use Node 22 no build.' }
foreach ($notice in @(
    @("https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE",'Node-LICENSE.txt'),
    @('https://raw.githubusercontent.com/winsw/winsw/v2.12.0/LICENSE.txt','WinSW-LICENSE.txt'),
    @('https://raw.githubusercontent.com/caddyserver/caddy/v2.10.2/LICENSE','Caddy-LICENSE.txt')
)) { Invoke-WebRequest -UseBasicParsing -Uri $notice[0] -OutFile (Join-Path $stage ('licenses\'+$notice[1])) }
$desktop=Get-ChildItem (Join-Path $repository 'src-tauri\target\release\bundle\nsis\*.exe') | Select-Object -First 1
if (-not $desktop) { throw 'Build Desktop ausente.' }
Copy-Item $desktop.FullName (Join-Path $stage 'desktop\SiloNR-Desktop-Setup.exe')
Copy-Item (Join-Path $repository 'src-tauri\target\release\silonr-desktop.exe') (Join-Path $stage 'desktop\silonr-desktop.exe')
# Evergreen bootstrapper is mutable; require Microsoft's Authenticode signature.
$webview = Join-Path $stage 'prerequisites\MicrosoftEdgeWebview2Setup.exe'
Invoke-WebRequest -UseBasicParsing 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $webview
$signature = Get-AuthenticodeSignature $webview
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'WebView2 sem assinatura Microsoft valida.' }
Set-Content (Join-Path $stage 'version.txt') '0.2.2-native-preview' -Encoding ASCII
$compiler='C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
if (-not (Test-Path $compiler)) { throw 'Instale Inno Setup 6 no ambiente de build.' }
& $compiler "/DStageDir=$stage" "/DOutputDir=$output" (Join-Path $PSScriptRoot 'Server.iss')
if ($LASTEXITCODE -ne 0) { throw 'Build Inno Setup falhou.' }
