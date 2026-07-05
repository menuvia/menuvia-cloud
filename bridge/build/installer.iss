; Inno Setup — installer Menuvia Bridge pentru Windows.
; Presupune un singur executabil `dist\menuvia-bridge.exe` (vezi BUILD.md).
; Compilează cu: iscc build\installer.iss  (Inno Setup 6+).

#define AppName "Menuvia Bridge"
#define AppVersion "0.1.0"
#define ExeName "menuvia-bridge.exe"

[Setup]
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Menuvia
DefaultDirName={autopf}\MenuviaBridge
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputBaseFilename=menuvia-bridge-setup
Compression=lzma2
SolidCompression=yes
; Are nevoie de admin ca să scrie cheia de autostart în HKLM.
PrivilegesRequired=admin
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "ro"; MessagesFile: "compiler:Languages\Romanian.isl"

[Files]
Source: "..\dist\{#ExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Configurare Menuvia Bridge"; Filename: "{app}\{#ExeName}"; Parameters: "--setup"; WorkingDir: "{app}"
Name: "{group}\Verificare conexiune (check)"; Filename: "{app}\{#ExeName}"; Parameters: "--check"; WorkingDir: "{app}"
Name: "{group}\Pornește bridge-ul"; Filename: "{app}\{#ExeName}"; WorkingDir: "{app}"

[Tasks]
Name: "autostart"; Description: "Pornește automat Menuvia Bridge la logon"; GroupDescription: "Opțiuni:"

[Registry]
; Autostart la logon. WorkingDir nu se poate seta în cheia Run, dar config.json e citit
; și de lângă executabil (vezi lib/config.js), deci `--setup` scris în {app} e găsit.
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "MenuviaBridge"; \
  ValueData: """{app}\{#ExeName}"""; \
  Tasks: autostart; Flags: uninsdeletevalue

[Run]
; La finalul instalării: rulează wizardul de configurare (scrie config.json în {app}).
Filename: "{app}\{#ExeName}"; Parameters: "--setup"; WorkingDir: "{app}"; \
  Description: "Configurează acum (Supabase + device secret)"; \
  Flags: postinstall runascurrentuser

[UninstallDelete]
; Șterge config.json la dezinstalare (conține secrete).
Type: files; Name: "{app}\config.json"
