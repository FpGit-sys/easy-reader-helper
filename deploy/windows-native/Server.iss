#ifndef StageDir
  #define StageDir "stage"
#endif
#ifndef OutputDir
  #define OutputDir "output"
#endif
#ifndef AppVersion
  #define AppVersion "0.2.0"
#endif
[Setup]
AppId={{A65C80E2-AB46-4DF7-A037-0D4A22EAA0A6}
AppName=SiloNR Servidor Local
AppVersion={#AppVersion}
AppPublisher=SiloNR
DefaultDirName={autopf64}\SiloNR Server
DefaultGroupName=SiloNR
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=SiloNR-Servidor-Setup-{#AppVersion}
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
SetupLogging=yes
CloseApplications=no
RestartApplications=no
[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Abrir SiloNR"; Filename: "https://silonr.local"
Name: "{group}\Administrar servidor"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\Manager.ps1"""
[Code]
function RunConfiguration(Action: String): Boolean;
var
  Args, Config: String;
  ResultCode: Integer;
begin
  Args := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\tools\Setup.ps1') + '" -Action ' + Action;
  Config := ExpandConstant('{param:SILONRCONFIG|}');
  if (Action = 'Install') and (Config <> '') then Args := Args + ' -ConfigurationPath "' + Config + '"';
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Args, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if Result then Result := ResultCode = 0;
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\tools\Setup.ps1')) then
    if not RunConfiguration('BeforeUpgrade') then Result := 'O backup ou a parada segura falhou. A atualizacao foi interrompida antes de substituir arquivos.';
end;
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    if not RunConfiguration('Install') then RaiseException('A configuracao nao foi concluida. Os dados foram preservados. Consulte C:\ProgramData\SiloNR\setup-error.txt e execute o instalador novamente.');
end;
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    if not RunConfiguration('Uninstall') then RaiseException('Nao foi possivel parar os servicos. Desinstalacao interrompida para preservar os dados.');
end;
