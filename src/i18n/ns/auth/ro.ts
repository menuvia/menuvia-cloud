// Namespace `auth` — drumul de DINAINTEA panoului (lotul L2a): autentificarea
// și înscrierea (AuthPage), cererea și setarea parolei noi (ResetPasswordPage),
// codul de 6 cifre din emailul de confirmare (ConfirmEmailCodeStep, lib/otp) și
// codul de agent (AgentCodeSection). SURSA DE ADEVĂR: en/fr/de au tipul
// `Translation<typeof ro>`. Textele sunt BYTE-identice cu cele de dinainte de
// L2a — fluxul românesc nu se schimbă vizual.
const ro = {
  brand: 'Menuvia',
  intentContinuePrefix: 'Continui cu',
  intentSubcopy_starter: 'Plan pentru meniu QR, fără comenzi.',
  intentSubcopy_growth: 'Plan recomandat pentru comenzi de la masă.',
  intentSubcopy_pro: 'Se activează cu verificare inițială — te contactăm noi.',
  resetCheckEmailTitle: 'Verifică emailul',
  resetSentPrefix: 'Am trimis un link de resetare la',
  backToLogin: 'Înapoi la autentificare',
  resetPasswordTitle: 'Resetează parola',
  resetPasswordSubtitle: 'Introdu emailul și vei primi un link de resetare.',
  emailLabel: 'Email',
  emailPlaceholder: 'email@restaurant.ro',
  emailRequiredError: 'Scrie adresa de email a contului.',
  processingBtn: 'Se procesează...',
  sendResetLinkBtn: 'Trimite link de resetare',
  backToLoginArrow: '← Înapoi la autentificare',
  brandTagline: 'Configurezi restaurantul în câteva minute.',
  heroSubtitle: 'Adaugi meniul, generezi QR-urile și poți primi comenzi direct de la masă.',
  heroBullet1: 'Meniu QR gata de folosit',
  heroBullet2: 'QR-uri pentru mese generate automat',
  heroBullet3: 'Poți porni simplu și activa comenzi când ai nevoie',
  heroFooter: '30 de zile gratuite. Anulezi oricând.',
  loginTitle: 'Bun venit înapoi',
  signupTitle: 'Creează cont gratuit',
  loginSubtitle: 'Intră în contul tău Menuvia.',
  signupSubtitle: 'Începi cu meniul digital în 30 de secunde.',
  nameLabel: 'Nume',
  namePlaceholder: 'Numele tău',
  passwordLabel: 'Parolă',
  passwordPlaceholder: 'Minimum 8 caractere',
  loginBtn: 'Intră în cont',
  signupBtn: 'Creează cont',
  forgotPassword: 'Ai uitat parola?',
  noAccount: 'Nu ai cont?',
  hasAccount: 'Ai deja cont?',
  createOne: 'Creează unul',
  errorGeneric: 'Nu am putut procesa cererea. Verifică datele și reîncearcă.',
  // `{terms}` și `{privacy}` devin linkuri (`splitLinks`): ordinea cuvintelor
  // diferă de la o limbă la alta (germana pune verbul la final).
  termsSentence: 'Am citit și accept {terms} și {privacy}',
  termsLinkTerms: 'Termenii',
  termsLinkPrivacy: 'Politica de confidențialitate',
  termsRequiredError:
    'Bifează acceptarea Termenilor și a Politicii de confidențialitate pentru a crea contul.',
  mfaTitle: 'Verificare în doi pași',
  mfaSubtitle: 'Introdu codul de 6 cifre din aplicația ta de autentificare.',
  mfaCodeLabel: 'Cod de verificare',
  mfaVerifyBtn: 'Verifică',
  mfaInvalidCode: 'Cod incorect sau expirat. Încearcă din nou.',
  mfaBack: '← Înapoi la autentificare',

  // Erorile GoTrue (vin în engleză), pe clase — `classifyAuthFormError`.
  errInvalidCredentials: 'Email sau parolă greșită.',
  errAlreadyRegistered: 'Există deja un cont cu acest email. Încearcă autentificarea sau resetarea parolei.',
  errEmailNotConfirmed:
    'Emailul nu e confirmat încă. Verifică inbox-ul (și spam-ul) pentru linkul de confirmare.',
  errPasswordShort: 'Parola e prea scurtă — folosește minim 6 caractere.',
  errRateLimit: 'Prea multe încercări. Așteaptă un minut și reîncearcă.',
  errInvalidEmail: 'Adresa de email nu pare validă. Verific-o și reîncearcă.',
  errNetwork: 'Problemă de conexiune. Verifică internetul și reîncearcă.',

  // „Verifică emailul" după înscriere (ConfirmEmailCodeStep).
  confirmTitle: 'Verifică emailul',
  confirmSentPrefix: 'Am trimis un email la',
  confirmInstructions:
    'Scrie aici codul de 6 cifre din el sau apasă linkul din email — te aduce direct înapoi în contul tău.',
  confirmCodeLabel: 'Cod din email',
  confirmVerifyBtn: 'Confirmă codul',
  confirmVerifying: 'Se verifică...',
  confirmIncomplete: 'Scrie cele 6 cifre din email.',
  confirmResend: 'Retrimite emailul',
  confirmResendIn: 'Retrimite peste {s} s',
  confirmResending: 'Se trimite...',
  confirmResent: 'Am trimis un email nou. Folosește cel mai recent cod.',
  confirmBack: 'Înapoi la autentificare',
  otpVerify_invalid:
    'Codul e greșit sau a expirat. Verifică ultimul email primit sau cere unul nou cu „Retrimite”.',
  otpVerify_rate_limit: 'Prea multe încercări. Așteaptă puțin și încearcă din nou.',
  otpVerify_network: 'Problemă de conexiune. Verifică internetul și reîncearcă.',
  otpVerify_other: 'Nu am putut verifica codul. Reîncearcă sau folosește linkul din email.',
  otpResend_invalid: 'Nu am putut retrimite emailul. Reîncearcă peste un minut.',
  otpResend_rate_limit: 'Ai cerut prea multe coduri. Așteaptă puțin și încearcă din nou.',
  otpResend_network: 'Problemă de conexiune. Verifică internetul și reîncearcă.',
  otpResend_other: 'Nu am putut retrimite emailul. Reîncearcă peste un minut.',

  // Codul de agent la înscriere (AgentCodeSection, mig 301).
  agentBannerTitle: 'Ai venit prin agentul tău Menuvia',
  agentBannerBody:
    'Îl legăm de contul tău, ca să te poată ajuta la configurare. Nu are acces la datele restaurantului decât dacă îi dai tu acordul.',
  agentNotMine: 'Nu e agentul meu',
  agentHaveCode: 'Am un cod de agent',
  agentCodeLabel: 'Codul agentului',
  agentCodePlaceholder: 'ex. k7m2xq9',
  agentCodeHelp: 'Îl primești de la agentul tău. Poți lăsa câmpul gol.',
  agentShape:
    'Codul poate avea doar litere, cifre și cratimă (2–40 de caractere). Verifică-l sau lasă câmpul gol.',
  agentUnknown: 'Nu găsim acest cod de agent. Verifică-l sau lasă câmpul gol.',

  // Parola nouă, din linkul de resetare (ResetPasswordPage).
  newPwStrength0: 'Slabă',
  newPwStrength1: 'Acceptabilă',
  newPwStrength2: 'Puternică',
  newPwTooShort: 'Parola trebuie să aibă cel puțin 8 caractere.',
  newPwMismatch: 'Parolele nu coincid.',
  newPwSaveFailed: 'Parola nu a putut fi schimbată. Dacă linkul a expirat, cere unul nou.',
  newPwChecking: 'Se verifică link-ul...',
  newPwInvalidTitle: 'Link invalid sau expirat',
  newPwInvalidBody:
    'Link-urile de resetare sunt valabile 1 oră și pot fi folosite o singură dată. Solicită un link nou dacă ai nevoie.',
  newPwRequestNew: 'Solicită link nou',
  newPwDoneTitle: 'Parolă schimbată',
  newPwDoneBody: 'Noua parolă a fost salvată. Poți intra în panou.',
  newPwGoToPanel: 'Intră în panou →',
  newPwTitle: 'Parolă nouă',
  newPwSubtitle: 'Alege o parolă sigură pentru contul tău.',
  newPwLabel: 'Parolă nouă',
  newPwConfirmLabel: 'Confirmă parola',
  newPwConfirmPlaceholder: 'Repetă parola',
  newPwMismatchInline: 'Parolele nu coincid',
  newPwMatch: '✓ Parolele coincid',
  newPwSaving: 'Se salvează...',
  newPwSave: 'Salvează parola',
}

export default ro
