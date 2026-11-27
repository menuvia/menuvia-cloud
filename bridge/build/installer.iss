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
; config.json-ul descărcat din panou (fila Bridge → „Descarcă config.json", lotul
; C7a), dacă stă în ACELAȘI folder cu installer-ul: se copiază lângă exe, iar
; wizardul de la final îl preia (Enter = păstrează) — nimic de tastat în afară de
; IP-ul imprimantei de bucătărie. Fără el, wizardul cere valorile ca înainte.
; `onlyifdoesntexist` e OBLIGATORIU: config.json n-are informație de versiune, iar
; Inno Setup înlocuiește implicit un astfel de fișier. Fără flag, o reinstalare /
; un upgrade rulat din Descărcări (unde config.json-ul din panou stă de luni de
; zile) suprascria TĂCUT configul completat de wizard (IP-ul imprimantei, modul
; file, folderele) cu fișierul brut — pe Planul 2 bridge-ul murea la pornire cu
; „kitchen.host lipsește”. Un config existent se schimbă doar din „Configurare
; Menuvia Bridge” (wizardul îl ia ca implicit; cheia nouă se lipește acolo).
; Clichetul BZ7 (bridge/test/setup.test.js) ține flag-ul.
Source: "{src}\config.json"; DestDir: "{app}"; Flags: external skipifsourcedoesntexist onlyifdoesntexist

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
; Admin (runascurrentuser): config.json stă în Program Files.
Filename: "{app}\{#ExeName}"; Parameters: "--setup"; WorkingDir: "{app}"; \
  Description: "Configurează acum (preia config.json-ul existent sau pe cel de lângă installer)"; \
  Flags: postinstall runascurrentuser
; Apoi PORNEȘTE bridge-ul (după wizard: intrările [Run] rulează în ordine, iar
; --setup așteaptă să se termine). Fără ea, bucla pornea abia la următorul logon
; (cheia Run de mai sus), iar „Verificare conexiune (check)” aprindea pastila
; „● Online” din panou pentru ~3 minute (bridge_validate_device scrie
; last_seen_at) fără ca nimic să ruleze: pe Planul 2 niciun tichet până la
; repornire, pe Planul 3 bonurile stăteau în coadă. Ca utilizatorul obișnuit
; (implicitul intrărilor postinstall), exact ca autostart-ul.
; Clichetul BZ7 ține intrarea, și după --setup.
Filename: "{app}\{#ExeName}"; WorkingDir: "{app}"; \
  Description: "Pornește Menuvia Bridge acum"; \
  Flags: postinstall nowait skipifsilent

[UninstallDelete]
; Șterge config.json la dezinstalare (conține secrete).
Type: files; Name: "{app}\config.json"
