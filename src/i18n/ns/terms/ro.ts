// Namespace `terms` — poarta de consimțământ de după autentificare
// (TermsAcceptanceGate, lotul L2a). Separat de `auth`: poarta stă în chunk-ul
// ei leneș, montat lângă router, și nu trebuie să tragă după ea textele
// formularului de autentificare. SURSA DE ADEVĂR; texte byte-identice cu cele
// de dinainte de L2a.
const ro = {
  title: 'Acceptă Termenii ca să continui',
  body: 'Avem nevoie de acordul tău consemnat pentru Termeni și pentru Politica de confidențialitate. Durează o secundă și se cere o singură dată.',
  // `{terms}` și `{privacy}` devin linkuri (`fillNodes`).
  sentence: 'Am citit și accept {terms} și {privacy}.',
  linkTerms: 'Termenii',
  linkPrivacy: 'Politica de confidențialitate',
  recordFailed: 'Nu am putut consemna acceptarea. Reîncearcă.',
  network: 'Fără conexiune. Verifică internetul și reîncearcă.',
  recording: 'Se consemnează...',
  accept: 'Accept și continui',
  signOut: 'Ieși din cont',
}

export default ro
