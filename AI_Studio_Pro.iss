; ===========================================================================
;  AI Studio Pro - installer script for Inno Setup 6 (6.3 or newer recommended)
;  Put this file in your project folder (next to app-2.py and the dist folder).
;  Steps: 1) run build_exe.bat   2) run build_installer.bat   (or open this file in Inno Setup and press Compile)
;  Result: installer\AI_Studio_Pro_Setup.exe
; ===========================================================================

#define MyAppName "AI Studio Pro"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "AI Studio Pro"
#define MyAppExeName "AI Studio Pro.exe"
#define MyBuildDir "dist\AI Studio Pro"

#if !DirExists(MyBuildDir)
  #error The folder "dist\AI Studio Pro" was not found. Run build_exe.bat first, then compile again.
#endif

[Setup]
; AppId identifies this program for updates and uninstall. NEVER change it.
AppId={{5EAA6E11-0016-4548-991C-6A6CD2B776C8}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Installs for the current user only (no administrator password needed) into %LocalAppData%\Programs.
; The app writes a few files next to its .exe, which works because this folder is writable.
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=installer
OutputBaseFilename=AI_Studio_Pro_Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=yes
RestartApplications=no
#ifexist "assets\icon.ico"
SetupIconFile=assets\icon.ico
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#MyBuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Files the app created itself next to the .exe (the library downloads)
Type: filesandordirs; Name: "{app}\vendor"
Type: dirifempty; Name: "{app}"

[Code]
const
  WebView2Key = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2UserKey = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

// The app shows its window with Microsoft's free WebView2 Runtime (built into current Windows 10/11).
function WebView2Installed: Boolean;
var
  V: String;
begin
  Result := False;
  if RegQueryStringValue(HKLM32, WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0') then
    Result := True
  else if RegQueryStringValue(HKCU, WebView2UserKey, 'pv', V) and (V <> '') and (V <> '0.0.0.0') then
    Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ErrorCode: Integer;
begin
  if (CurStep = ssPostInstall) and (not WizardSilent) and (not WebView2Installed) then
  begin
    if MsgBox('AI Studio Pro needs the free "Microsoft Edge WebView2 Runtime" to show its window, and it was not found on this PC.' + #13#10#13#10 +
              'Open the Microsoft download page now? (Install the "Evergreen" runtime, then start AI Studio Pro.)',
              mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;
end;

// On uninstall, ask before touching the user's chats and settings.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
  begin
    DataDir := ExpandConstant('{%USERPROFILE}\AIStudioPro');
    if DirExists(DataDir) then
    begin
      if MsgBox('Do you also want to delete your chats, settings and saved images?' + #13#10#13#10 + DataDir + #13#10#13#10 +
                'Choose No to keep them (recommended if you plan to install again).',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;
