#ifndef StageDir
  #define StageDir "stage"
#endif
#ifndef OutputDir
  #define OutputDir "output"
#endif
#ifndef AppVersion
  #define AppVersion "0.2.1"
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
var
  ConfigurationFailed: Boolean;

function RunConfiguration(Action: String): Boolean;
var
  Args, Config: String;
  ResultCode, ShowCommand: Integer;
begin
  Args := '-NoProfile -STA -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\tools\Setup.ps1') + '" -Action ' + Action;
  Config := ExpandConstant('{param:SILONRCONFIG|}');
  ShowCommand := SW_HIDE;
  if (Action = 'Install') and (Config <> '') then Args := Args + ' -ConfigurationPath "' + Config + '"';
  if Action = 'Install' then
  begin
    if WizardSilent then Args := Args + ' -NonInteractive'
    else
    begin
      ShowCommand := SW_SHOWNORMAL;
      Args := Args + ' -InstallerWindowHandle ' + IntToStr(WizardForm.Handle);
    end;
  end;
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Args, ExpandConstant('{app}'), ShowCommand, ewWaitUntilTerminated, ResultCode);
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
  begin
    WizardForm.PageNameLabel.Caption := 'Configurando o servidor SiloNR';
    WizardForm.PageDescriptionLabel.Caption := 'Os arquivos foram copiados. A configuracao do servidor ainda precisa terminar.';
    WizardForm.StatusLabel.Caption := 'Preencha o formulario SiloNR, se solicitado, e aguarde a configuracao.';
    WizardForm.FilenameLabel.Caption := 'Nao feche esta janela nem abra outro instalador durante esta etapa.';
    ConfigurationFailed := not RunConfiguration('Install');
    if ConfigurationFailed then RaiseException('A configuracao nao foi concluida. Os dados foram preservados. Consulte C:\ProgramData\SiloNR\setup-error.txt e execute o instalador novamente.');
  end;
end;
function GetCustomSetupExitCode: Integer;
begin
  if ConfigurationFailed then Result := 1001 else Result := 0;
end;
procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and ConfigurationFailed then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'Configuracao nao concluida';
    WizardForm.FinishedLabel.Caption := 'O servidor nao foi liberado. Consulte C:\ProgramData\SiloNR\setup-error.txt e execute o instalador novamente. Seus dados foram preservados.';
  end;
end;
function InitializeUninstall: Boolean;
begin
  Result := RunConfiguration('Uninstall');
  if not Result then SuppressibleMsgBox('Nao foi possivel parar os servicos. Desinstalacao interrompida para preservar os dados.', mbError, MB_OK, IDOK);
end;
