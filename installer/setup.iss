#ifndef ExtensionId
  #define ExtensionId "daeejkhkhbecpokcmeegodkcfedhnpni"
#endif
[Setup]
AppId={{693E07EB-65CB-4B8D-8556-8D3DF720F65C}
AppName=AI Usage Tray
AppVersion=0.6.0
DefaultDirName={localappdata}\AIUsageTray
PrivilegesRequired=lowest
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=AI-Usage-Tray-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
MinVersion=10.0
UninstallDisplayIcon={app}\AIUsageTray.exe
[Files]
Source: "..\build\AIUsageTray.exe"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{userdesktop}\AI Usage Tray"; Filename: "{app}\AIUsageTray.exe"
Name: "{userprograms}\AI Usage Tray"; Filename: "{app}\AIUsageTray.exe"
[Tasks]
Name: "startup"; Description: "Start AI Usage Tray when I sign in"; Flags: unchecked
[Registry]
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\com.aiusage.tray"; ValueType: string; ValueName: ""; ValueData: "{app}\native-host.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "AI Usage Tray"; ValueData: """{app}\AIUsageTray.exe"""; Tasks: startup; Flags: uninsdeletevalue
[Run]
Filename: "{app}\AIUsageTray.exe"; Parameters: "--register {#ExtensionId}"; Flags: runhidden waituntilterminated
Filename: "{app}\AIUsageTray.exe"; Description: "Start AI Usage Tray"; Flags: nowait postinstall skipifsilent
[UninstallDelete]
Type: files; Name: "{app}\native-host.json"
Type: files; Name: "{app}\usage.json"
