param(
  [string]$BundleRoot = "src-tauri/target/release/bundle"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
  Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Get-SiloUninstallEntries {
  $registryRoots = @(
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
  )

  $entries = foreach ($path in $registryRoots) {
    Get-ItemProperty $path -ErrorAction SilentlyContinue | Where-Object {
      $_.DisplayName -and ($_.DisplayName -like "SiloNR*")
    }
  }

  @($entries)
}

function Get-SiloExecutable {
  foreach ($entry in Get-SiloUninstallEntries) {
    if ($entry.DisplayIcon) {
      $iconPath = [string]$entry.DisplayIcon
      $iconPath = $iconPath.Trim('"') -replace ',\d+$', ''
      if (Test-Path $iconPath) {
        return (Resolve-Path $iconPath).Path
      }
    }

    if ($entry.InstallLocation -and (Test-Path $entry.InstallLocation)) {
      $candidate = Get-ChildItem -Path $entry.InstallLocation -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @("SiloNR.exe", "silonr-desktop.exe") } |
        Select-Object -First 1
      if ($candidate) {
        return $candidate.FullName
      }
    }
  }

  $knownCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\SiloNR\SiloNR.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\SiloNR\silonr-desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "SiloNR\SiloNR.exe"),
    (Join-Path $env:LOCALAPPDATA "SiloNR\silonr-desktop.exe"),
    (Join-Path $env:ProgramFiles "SiloNR\SiloNR.exe"),
    (Join-Path $env:ProgramFiles "SiloNR\silonr-desktop.exe")
  )

  if (${env:ProgramFiles(x86)}) {
    $knownCandidates += Join-Path ${env:ProgramFiles(x86)} "SiloNR\SiloNR.exe"
    $knownCandidates += Join-Path ${env:ProgramFiles(x86)} "SiloNR\silonr-desktop.exe"
  }

  foreach ($candidate in $knownCandidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return (Resolve-Path $candidate).Path
    }
  }

  $searchRoots = @(
    (Join-Path $env:LOCALAPPDATA "Programs"),
    $env:LOCALAPPDATA,
    $env:ProgramFiles
  ) | Where-Object { $_ -and (Test-Path $_) }

  foreach ($root in $searchRoots) {
    $candidate = Get-ChildItem -Path $root -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -in @("SiloNR.exe", "silonr-desktop.exe") } |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }

  return $null
}

function Assert-SiloLaunch([string]$Executable) {
  Write-Step "Validando inicialização do aplicativo"
  Write-Host "Executável: $Executable"

  $process = Start-Process -FilePath $Executable -PassThru
  Start-Sleep -Seconds 8
  $process.Refresh()

  if ($process.HasExited) {
    throw "O SiloNR encerrou imediatamente após a instalação. ExitCode=$($process.ExitCode)"
  }

  Write-Host "Aplicativo permaneceu ativo por 8 segundos. Smoke de inicialização aprovado."
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

function Invoke-Msi([string]$Mode, [string]$Path, [string]$LogPath) {
  $arguments = @(
    "/$Mode",
    "`"$Path`"",
    "/qn",
    "/norestart",
    "/L*v",
    "`"$LogPath`""
  )

  $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) {
    if (Test-Path $LogPath) {
      Write-Host "--- MSI log ---"
      Get-Content $LogPath -Tail 120
    }
    throw "msiexec falhou. Mode=$Mode ExitCode=$($process.ExitCode)"
  }
}

$bundle = Resolve-Path $BundleRoot
$msi = Get-ChildItem -Path (Join-Path $bundle "msi") -Filter "*.msi" -File | Select-Object -First 1
$nsis = Get-ChildItem -Path (Join-Path $bundle "nsis") -Filter "*.exe" -File | Select-Object -First 1

if (-not $msi) {
  throw "Instalador MSI não encontrado em $BundleRoot/msi"
}
if (-not $nsis) {
  throw "Instalador NSIS não encontrado em $BundleRoot/nsis"
}

Write-Host "MSI:  $($msi.FullName)"
Write-Host "NSIS: $($nsis.FullName)"

try {
  Write-Step "Instalação limpa via MSI"
  $msiInstallLog = Join-Path $env:RUNNER_TEMP "silonr-msi-install.log"
  Invoke-Msi -Mode "i" -Path $msi.FullName -LogPath $msiInstallLog

  $msiExe = Get-SiloExecutable
  if (-not $msiExe) {
    throw "MSI finalizou sem erro, mas o executável instalado do SiloNR não foi localizado."
  }
  Assert-SiloLaunch -Executable $msiExe

  Write-Step "Desinstalação silenciosa do MSI"
  $msiUninstallLog = Join-Path $env:RUNNER_TEMP "silonr-msi-uninstall.log"
  Invoke-Msi -Mode "x" -Path $msi.FullName -LogPath $msiUninstallLog
  Start-Sleep -Seconds 3

  Write-Step "Instalação limpa via NSIS"
  $nsisInstall = Start-Process -FilePath $nsis.FullName -ArgumentList "/S" -Wait -PassThru
  if ($nsisInstall.ExitCode -ne 0) {
    throw "Instalador NSIS falhou com ExitCode=$($nsisInstall.ExitCode)"
  }

  $nsisExe = Get-SiloExecutable
  if (-not $nsisExe) {
    throw "NSIS finalizou sem erro, mas o executável instalado do SiloNR não foi localizado."
  }
  Assert-SiloLaunch -Executable $nsisExe

  Write-Step "Desinstalação silenciosa do NSIS"
  $installDirectory = Split-Path -Parent $nsisExe
  $uninstaller = Join-Path $installDirectory "uninstall.exe"

  if (-not (Test-Path $uninstaller)) {
    $entry = Get-SiloUninstallEntries | Where-Object { $_.UninstallString } | Select-Object -First 1
    if ($entry) {
      $raw = ([string]$entry.UninstallString).Trim()
      if ($raw.StartsWith('"')) {
        $closing = $raw.IndexOf('"', 1)
        if ($closing -gt 1) {
          $uninstaller = $raw.Substring(1, $closing - 1)
        }
      } else {
        $uninstaller = ($raw -split '\s+')[0]
      }
    }
  }

  if (-not $uninstaller -or -not (Test-Path $uninstaller)) {
    throw "O desinstalador NSIS não foi localizado."
  }

  $nsisUninstall = Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru
  if ($nsisUninstall.ExitCode -ne 0) {
    throw "Desinstalador NSIS falhou com ExitCode=$($nsisUninstall.ExitCode)"
  }

  Write-Step "Release gate do instalador Windows aprovado"
  Write-Host "MSI instalou, abriu e desinstalou."
  Write-Host "NSIS instalou, abriu e desinstalou."
} finally {
  Get-Process -Name "SiloNR", "silonr-desktop" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
}
