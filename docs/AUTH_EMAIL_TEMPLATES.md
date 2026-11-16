# Șabloanele de email Supabase Auth în limba utilizatorului (lotul L8a)

Emailurile de **confirmare a contului** și de **resetare a parolei** nu trec prin
Menuvia: le trimite Supabase Auth (prin SMTP-ul Resend), din șabloanele din
Dashboard. Repo-ul nu le poate schimba, deci pasul e al fondatorului. Mai jos
sunt textele gata de lipit, în 4 limbi.

## De unde vine limba

La înscriere, aplicația pune limba ecranului în `user_metadata.ui_lang`:

- pe `/auth` (`src/pages/AuthPage.tsx`) — limba funnel-ului (`?lang=`, cont,
  dispozitiv, browser; azi `ro` sau `en`);
- pe pagina de acceptare a invitației (`src/pages/InviteAcceptPage.tsx`) —
  limba rezolvată a ecranului.

Cheia e citită **doar** de aceste șabloane, niciodată la autorizare. Conturile
create înainte de lotul L8a n-o au, deci primesc ramura **română**.
`fr` și `de` sunt gata, dar nu pot apărea până când franceza și germana intră
în funnel (`FUNNEL_LANGS` din `src/i18n/langs.ts`).

## Forma condiției (de ce `printf`)

În șabloanele Go ale Supabase, o cheie LIPSĂ din `.Data` nu e un șir: un
`eq .Data.ui_lang "en"` pe un cont vechi poate opri randarea. `printf "%v"`
transformă orice valoare (inclusiv lipsa) într-un șir, deci comparația e sigură:

```
{{ if eq (printf "%v" .Data.ui_lang) "en" }} … {{ else if eq (printf "%v" .Data.ui_lang) "fr" }} … {{ else if eq (printf "%v" .Data.ui_lang) "de" }} … {{ else }} ROMÂNA {{ end }}
```

## Pas cu pas (Supabase Dashboard → Authentication → Emails → Email Templates)

1. **Înainte de orice, copiază textul ACTUAL** al celor două șabloane (subiect +
   corp) într-un fișier local. Ramura `{{ else }}` de mai jos TREBUIE să fie
   exact acel text: așa conturile românești primesc byte cu byte ce primeau.
   Textul de mai jos e cel din `docs/dosar/05-ghid-sedinta-1.md` (Pasul 8.4);
   dacă în Dashboard e altul, înlocuiește ramura română cu cel din Dashboard.
2. **Confirm signup**: lipește subiectul și corpul din secțiunea 1. Save.
3. **Reset password**: lipește subiectul și corpul din secțiunea 2. Save.
   Dacă azi șablonul de resetare e cel implicit al Supabase (în engleză),
   ramura română de mai jos e NOUĂ — o schimbare vizibilă pentru conturile
   românești; păstreaz-o doar dacă o vrei.
4. **Testează** (trei emailuri):
   - cont nou pe `/auth` → confirmarea vine în **română**, cu cod + link;
   - cont nou pe `/auth?lang=en` → confirmarea vine în **engleză**;
   - „Am uitat parola” pe un cont vechi → resetarea vine în **română**.
   Spune-mi ce a ieșit; dacă vreun email vine gol sau cu `<no value>`, revino
   la textul salvat la pasul 1 și trimite-mi o captură.

## 1. Confirm signup

**Subiect:**

```
{{ if eq (printf "%v" .Data.ui_lang) "en" }}Your Menuvia code: {{ .Token }}{{ else if eq (printf "%v" .Data.ui_lang) "fr" }}Votre code Menuvia : {{ .Token }}{{ else if eq (printf "%v" .Data.ui_lang) "de" }}Ihr Menuvia-Code: {{ .Token }}{{ else }}Codul tău Menuvia: {{ .Token }}{{ end }}
```

**Corp:**

```html
{{ if eq (printf "%v" .Data.ui_lang) "en" }}
<h2>Confirm your Menuvia account</h2>
<p>Enter this code in the app:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:700">{{ .Token }}</p>
<p>Or tap the link:</p>
<p><a href="{{ .ConfirmationURL }}">Confirm your email address</a></p>
<p>If you did not create an account, ignore this email.</p>
{{ else if eq (printf "%v" .Data.ui_lang) "fr" }}
<h2>Confirmez votre compte Menuvia</h2>
<p>Saisissez ce code dans l’application :</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:700">{{ .Token }}</p>
<p>Ou cliquez sur le lien :</p>
<p><a href="{{ .ConfirmationURL }}">Confirmer l’adresse e-mail</a></p>
<p>Si vous n’avez pas créé de compte, ignorez cet e-mail.</p>
{{ else if eq (printf "%v" .Data.ui_lang) "de" }}
<h2>Bestätigen Sie Ihr Menuvia-Konto</h2>
<p>Geben Sie diesen Code in der App ein:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:700">{{ .Token }}</p>
<p>Oder tippen Sie auf den Link:</p>
<p><a href="{{ .ConfirmationURL }}">E-Mail-Adresse bestätigen</a></p>
<p>Wenn Sie kein Konto erstellt haben, ignorieren Sie diese E-Mail.</p>
{{ else }}
<h2>Confirmă-ți contul Menuvia</h2>
<p>Introdu acest cod în aplicație:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:700">{{ .Token }}</p>
<p>Sau apasă linkul:</p>
<p><a href="{{ .ConfirmationURL }}">Confirmă adresa de email</a></p>
<p>Dacă nu ai creat tu un cont, ignoră acest email.</p>
{{ end }}
```

Lungimea codului OTP rămâne **6** (ecranul `ConfirmEmailCodeStep` cere 6 cifre).

## 2. Reset password

Aplicația folosește resetarea prin **link** (`resetPasswordForEmail` cu
`redirectTo` spre `/reset-password`), deci șablonul are nevoie doar de
`{{ .ConfirmationURL }}`.

**Subiect:**

```
{{ if eq (printf "%v" .Data.ui_lang) "en" }}Reset your Menuvia password{{ else if eq (printf "%v" .Data.ui_lang) "fr" }}Réinitialisez votre mot de passe Menuvia{{ else if eq (printf "%v" .Data.ui_lang) "de" }}Menuvia-Passwort zurücksetzen{{ else }}Resetează parola Menuvia{{ end }}
```

**Corp:**

```html
{{ if eq (printf "%v" .Data.ui_lang) "en" }}
<h2>Reset your password</h2>
<p>We received a request to reset the password of your Menuvia account.</p>
<p><a href="{{ .ConfirmationURL }}">Choose a new password</a></p>
<p>If you did not ask for this, ignore this email — your password stays the same.</p>
{{ else if eq (printf "%v" .Data.ui_lang) "fr" }}
<h2>Réinitialisez votre mot de passe</h2>
<p>Nous avons reçu une demande de réinitialisation du mot de passe de votre compte Menuvia.</p>
<p><a href="{{ .ConfirmationURL }}">Choisir un nouveau mot de passe</a></p>
<p>Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail : votre mot de passe reste inchangé.</p>
{{ else if eq (printf "%v" .Data.ui_lang) "de" }}
<h2>Passwort zurücksetzen</h2>
<p>Wir haben eine Anfrage erhalten, das Passwort Ihres Menuvia-Kontos zurückzusetzen.</p>
<p><a href="{{ .ConfirmationURL }}">Neues Passwort festlegen</a></p>
<p>Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail — Ihr Passwort bleibt unverändert.</p>
{{ else }}
<h2>Resetează-ți parola</h2>
<p>Am primit o cerere de resetare a parolei contului tău Menuvia.</p>
<p><a href="{{ .ConfirmationURL }}">Alege o parolă nouă</a></p>
<p>Dacă nu ai cerut tu asta, ignoră acest email — parola rămâne aceeași.</p>
{{ end }}
```

## Reziduuri consemnate

- Un utilizator poate edita propriul `user_metadata.ui_lang`: schimbă doar limba
  propriilor emailuri Auth, nimic altceva.
- Limba se fixează la înscriere: un cont care își schimbă ulterior limba în
  panou (`profiles.ui_language`) primește resetarea parolei tot în limba de la
  înscriere, până când clientul va sincroniza cheia (după activarea limbilor
  pentru personal).
- Conturile create din funnel-ul ENGLEZ (`/auth?lang=en`, `/en`, menuvia.com)
  ÎNAINTE de lotul L8a n-au `ui_lang`, deci cad tot pe ramura română. Dacă azi
  șablonul de resetare e cel implicit al Supabase (în engleză), acele conturi
  primeau engleza și, după lipirea șablonului de mai sus, vor primi româna —
  verifică la pasul 4 dacă există astfel de conturi înainte de a salva.
