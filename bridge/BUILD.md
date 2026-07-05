# Împachetare Menuvia Bridge (.exe + installer Windows)

> Se rulează pe o mașină de build (Windows recomandat pentru installer; exe-ul se poate
> face și pe Linux/Mac cu `@yao-pkg/pkg`). Pilotul rulează pe PC-ul de la casă, lângă
> FiscalNet. Bridge-ul e zero-dependency runtime, deci împachetarea e simplă.

## Opțiunea A — `@yao-pkg/pkg` (recomandat, bundluiește automat multi-fișier)

`pkg` clasic e arhivat; folosește fork-ul menținut `@yao-pkg/pkg`.

```bash
cd bridge
npx @yao-pkg/pkg menuvia-bridge.js \
  --targets node20-win-x64 \
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
- rulează wizardul `--setup` la final (owner-ul pune Supabase URL + `device_secret`);
- opțional, autostart la logon (cheie HKLM Run);
- scurtături în Start Menu: Configurare / Verificare / Pornește;
- la dezinstalare, șterge `config.json` (conține secrete).

`config.json` e scris și citit **lângă executabil** când rulează ca .exe (vezi
`lib/config.js` + `--setup`), deci autostart-ul (cwd = system32) găsește configul corect.

## Pași la client (rezumat)

1. Owner: Dashboard → „Casă de marcat" → „Înregistrează casă" → primește `device_secret`.
2. Descarcă + rulează `menuvia-bridge-setup.exe`.
3. La wizard, lipește `device_secret` (+ Supabase URL/anon key pre-completate).
4. `Verificare conexiune (check)` → confirmă că vede Supabase + FiscalNet.
5. Gata — bridge-ul rulează și tipărește bonurile pe măsură ce apar comenzi plătite.
