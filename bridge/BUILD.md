# Împachetare Menuvia Bridge (.exe + installer Windows)

> Se rulează pe o mașină de build (Windows recomandat pentru installer; exe-ul se poate
> face și pe Linux/Mac cu `@yao-pkg/pkg`). Pilotul rulează pe PC-ul de la casă, lângă
> FiscalNet. Bridge-ul e zero-dependency runtime, deci împachetarea e simplă.

## Build automat (recomandat) — `.github/workflows/bridge-release.yml`

Actions → „Bridge release (Windows)" → **Run workflow** (sau un tag `bridge-v*`).
Rulează testele bridge pe Windows, construiește exe-ul (Opțiunea A de mai jos),
face un test de fum (`--check` fără config trebuie să ajungă la „Config invalid")
și compilează installer-ul (Inno Setup; `Romanian.isl` se aduce din depozitul
Inno Setup dacă lipsește — nu e printre limbile oficiale). Artefactul
`menuvia-bridge-windows` conține `menuvia-bridge-setup.exe`, `menuvia-bridge.exe`
și `SHA256SUMS.txt`.

Workflow-ul NU publică nimic: fondatorul descarcă artefactul, îl găzduiește pe un
URL `https://` și pune URL-ul în `VITE_BRIDGE_DOWNLOAD_URL` (Netlify UI + variabila
de repo citită de `deploy-vps.yml`). Abia atunci fila Bridge din panou arată
butonul „Descarcă installer-ul"; fără variabilă butonul lipsește (niciodată un
link mort — nu există o rută `/download` pe site).

## Opțiunea A — `@yao-pkg/pkg` (bundluiește automat multi-fișier)

`pkg` clasic e arhivat; folosește fork-ul menținut `@yao-pkg/pkg`.

```bash
cd bridge
npx @yao-pkg/pkg@6 menuvia-bridge.js \
  --targets node22-win-x64 \
  --output dist/menuvia-bridge.exe
```

`pkg` urmărește automat `require`-urile (`lib/*.js`) și le include în exe. Rezultă un
singur `dist/menuvia-bridge.exe` (~40-50 MB, cu runtime Node inclus).

Testează exe-ul:

```bash
dist/menuvia-bridge.exe --check      # verifică config + Supabase + FiscalNet
dist/menuvia-bridge.exe --setup      # wizard config.json
dist/menuvia-bridge.exe              # rulează bucla
```

## Opțiunea B — Node SEA (Single Executable Application, zero dep externă)

SEA nu urmărește `require`-uri de fișiere locale la runtime → trebuie întâi bundluit
într-un singur fișier (esbuild, dev dep pe mașina de build):

```bash
cd bridge
npx esbuild menuvia-bridge.js --bundle --platform=node --outfile=dist/bundle.js
node --experimental-sea-config build/sea-config.json
# apoi copiezi node.exe și injectezi blob-ul cu postject (vezi docs Node „Single Executable Applications")
```

`build/sea-config.json` e inclus. Opțiunea A e mai simplă; SEA e util doar dacă vrei
zero dependențe de build.

## Installer Windows (Inno Setup)

`build/installer.iss` produce `menuvia-bridge-setup.exe`:

```bash
# pe Windows, cu Inno Setup 6+ instalat:
iscc build\installer.iss
```

Ce face installer-ul:
- copiază `dist\menuvia-bridge.exe` în `C:\Program Files\MenuviaBridge\`;
- copiază lângă el `config.json`-ul aflat în ACELAȘI folder cu installer-ul (cel
  descărcat din panou — vezi mai jos), dacă există — **doar dacă în
  `C:\Program Files\MenuviaBridge\` nu e deja unul** (`onlyifdoesntexist`): o
  reinstalare / un upgrade păstrează configul completat de wizard (IP-ul
  imprimantei, modul file, folderele) în loc să-l înlocuiască tăcut cu fișierul
  brut din Descărcări. Un config existent se schimbă din „Configurare Menuvia
  Bridge” (cheia nouă a unui dispozitiv re-înregistrat se lipește la „Device
  secret”; wizardul arată coada cheii pe care o păstrează);
- rulează wizardul `--setup` la final: cu `config.json` prezent, valorile lui sunt
  cele implicite (Enter = păstrează); fără el, owner-ul le introduce de mână;
- apoi **pornește bridge-ul** (bifa „Pornește Menuvia Bridge acum”, după wizard)
  — altfel bucla pornea abia la următorul logon;
- opțional, autostart la logon (cheie HKLM Run);
- scurtături în Start Menu: Configurare / Verificare / Pornește;
- la dezinstalare, șterge `config.json` (conține secrete).

`config.json` e scris și citit **lângă executabil** când rulează ca .exe (vezi
`lib/config.js` + `--setup`), deci autostart-ul (cwd = system32) găsește configul corect.

## Pași la client (rezumat)

1. Owner: Dashboard → „Casă & tichete" (Planul 3) / „Imprimantă bucătărie"
   (Planul 2) → „Înregistrează". Fereastra care urmează are 3 pași.
2. „Descarcă installer-ul" (linkul din `VITE_BRIDGE_DOWNLOAD_URL`) și
   „Descarcă config.json" — **unul lângă altul, într-un folder NOU și gol** (nu
   direct în Descărcări: un `config.json` mai vechi rămas acolo ar fi cel copiat,
   iar browserul îl salvează pe cel nou ca `config (1).json`; copiile vechi se
   șterg). config.json are adresa serverului, cheia anon (publică) și
   `device_secret`-ul dispozitivului; pe Planul 2 și `kitchen.enabled: true` +
   `fiscalnet.required: false` (PC fără FiscalNet: bucla nu ridică bonuri fiscale,
   le lasă pentru casa de marcat).
3. Rulează `menuvia-bridge-setup.exe`: installer-ul ia config.json (doar la prima
   instalare), wizardul îl preia — pe Planul 3 doar Enter, pe Planul 2 se tastează
   IP-ul imprimantei termice. Wizardul arată coada cheii (`…a1b2`): trebuie să fie
   cea din fereastra panoului.
4. La final rămâne bifat „Pornește Menuvia Bridge acum” (altfel: Start → Menuvia
   Bridge → „Pornește bridge-ul”, sau repornire). Opțional, Start → Menuvia Bridge →
   `Verificare conexiune (check)` → vede Supabase + FiscalNet (pe Planul 2:
   Supabase + imprimanta; pasul FiscalNet e sărit). Fereastra așteaptă Enter
   înainte să se închidă (doar într-o consolă reală — rulat din pipe/CI iese imediat).
5. Dovada: dispozitivul rămâne „● Online" în panou **și după 3 minute**.
   Verificarea singură NU dovedește nimic: `bridge_validate_device` scrie
   `last_seen_at`, deci pastila se aprinde ~3 minute și fără ca bucla să ruleze.
