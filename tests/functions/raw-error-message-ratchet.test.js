// tests/functions/raw-error-message-ratchet.test.js
// CLICHET: niciun ecran din src/components și src/pages nu mai arată omului
// textul BRUT al unei erori (`error.message` / `e.message`).
//
// Auditul de roluri (nov 2026) a numărat ~80 de locuri care randau mesajul
// tehnic: „new row violates row-level security policy for table products",
// „JSON object requested, multiple (or no) rows returned", „Forbidden",
// „permission denied for function is_admin". Un ospătar sau un manager care
// vede asta nu știe dacă e vina lui, a rețelei sau a aplicației. Contractul e
// `toUserMessage(err, fallback?)` din src/lib/userMessages.ts: refuzurile de
// drepturi / rețeaua / unicitatea în română, mesajele deja românești păstrate,
// restul pe un text de rezervă.
//
//   RM0  CONTROL POZITIV pe linii SINTETICE: fiecare formă interzisă e prinsă
//        (inclusiv `toast(e.message`, `setError(err.message`, `'Eroare: ' + x.message`,
//        `e instanceof Error ? e.message : …` într-un setter), iar formele
//        legitime (prin `toUserMessage(`, `console.*`, un câmp `.message` care nu
//        ajunge într-un setter) NU sunt prinse. Fără el, un regex stricat ar face
//        RM1 verde pe orice cod.
//   RM1  nicio linie din src/components și src/pages (fără teste) nu poartă o
//        formă interzisă în afara registrului ALLOWED.
//        Mutația care îl pică: readuci `toast(e.message, 'error')` în
//        ProductsTab sau `setError(e.message)` în ModifiersTab.
//   RM2  registrul e ONEST: fiecare intrare se potrivește EXACT pe o linie care
//        chiar e prinsă de scanner (o scutire care nu mai acoperă nimic pică —
//        tiparul DC1b / GI3).
//
// Ce NU prinde (consemnat): o eroare brută pe MAI MULTE rânduri (setter pe un
// rând, `.message` pe următorul) și randarea directă în JSX (`{error.message}`).
// Locurile cunoscute de acest fel au fost mutate pe toUserMessage în același PR.
'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const DIRS = ['src/components', 'src/pages']

// Un setter/toast care ajunge pe ecran.
// ORICE setter de stare (`setX(`), nu o listă fixă: lista veche scăpa
// `setTablesLoadError`, `setResult`, `setSubmitError` (recenzia pe #333).
const SINK = /\b(?:toast(?:\.(?:error|warning|info|success))?|pmToast|set[A-Z]\w*)\(/
const RULES = [
  { name: 'setter/toast cu .message', test: (l) => SINK.test(l) && /\.message\b/.test(l) },
  { name: "'Eroare: ' + ….message", test: (l) => /'Eroare: '\s*\+\s*[^;]*\.message\b/.test(l) },
  // Randarea DIRECTĂ în JSX: `{error.message}`, `{e?.message}`, `{r.error.message}`.
  // Fără `${…}`: interpolarea într-un șir (`new Error(\`…: ${e.message}\`)`) nu e
  // randare — mesajul aruncat trece mai departe prin toUserMessage.
  { name: 'JSX {….message}', test: (l) => /(?<!\$)\{\s*[\w.?]+\.message\s*\}/.test(l) },
]

function violations(line) {
  if (line.includes('toUserMessage(')) return []
  const code = line.replace(/\/\/.*$/, '')
  if (/^\s*\*/.test(code) || /console\.(?:error|warn|log|info)\(/.test(code)) return []
  return RULES.filter((r) => r.test(code)).map((r) => r.name)
}

// Scutiri: fișier + fragment EXACT de pe linie → motiv.
const ALLOWED = [
  {
    file: 'src/pages/AuthPage.tsx',
    contains: 'setError(translateAuthError(signUpErr.message))',
    reason: 'translateAuthError traduce deja mesajele Supabase Auth în română',
  },
  {
    file: 'src/pages/AuthPage.tsx',
    contains: 'setError(translateAuthError(signInErr.message))',
    reason: 'translateAuthError traduce deja mesajele Supabase Auth în română',
  },
  {
    file: 'src/pages/AuthPage.tsx',
    contains: 'setError(translateAuthError(resetErr.message))',
    reason: 'translateAuthError traduce deja mesajele Supabase Auth în română',
  },
  {
    file: 'src/components/CancelOrderDialog.tsx',
    contains: "setError(res.message || t('cancel_errGeneric'))",
    reason:
      '`res` vine din describeCancelRejection (WaiterPage) — mesaj românesc construit de noi; textul de rezervă e din dicționarul `orders` (lotul L4a)',
  },
  {
    file: 'src/components/WaiterOrderCard.tsx',
    contains: "setErrorMsg(res.message || t('pay_errRejected'))",
    reason:
      '`res` e refuzul tradus de describePayRejection (sume, metodă, rol) în limba personalului; textul de rezervă e din dicționarul `payments` (lotul L4b)',
  },
  {
    file: 'src/components/PayTableSheet.tsx',
    contains: "setErrorMsg(result.error.message || T(lang, 'pt_declined'))",
    reason: 'mesajul Stripe Elements, localizat în limba oaspetelui prin `locale: lang`',
  },
  {
    file: 'src/components/ui/Toast.tsx',
    contains: '{t.message}',
    reason: 'câmpul `message` al toast-ului însuși (text deja ales de apelant)',
  },
  {
    file: 'src/pages/PricingPage.tsx',
    contains: 'setCheckoutError({ message: err.message, action: err.action })',
    reason: 'CheckoutError poartă textul românesc din describeCheckoutFailure (CH1–CH8)',
  },
  {
    file: 'src/pages/PricingPage.tsx',
    contains: '{checkoutError.message}',
    reason: 'același CheckoutError, randat',
  },
  {
    file: 'src/components/afiliat/ContractReacceptSection.tsx',
    contains: '{gate.message}',
    reason: '`gate` = contractGate (lib/salesContract.ts), mesaj românesc construit de noi',
  },
  {
    file: 'src/pages/SalesInviteRedeemPage.tsx',
    contains: '{gate.message}',
    reason: '`gate` = contractGate (lib/salesContract.ts), mesaj românesc construit de noi',
  },
]

// Suprafețele INTERNE ale fondatorului: acolo mesajul tehnic E diagnosticul
// (fondatorul depanează, nu un client). Scutite pe fișier, cu motiv.
const ALLOWED_FILES = {
  'src/pages/FounderPage.tsx': 'panoul fondatorului — eroarea tehnică e diagnosticul',
  'src/components/FounderAiPanel.tsx': 'raport AI al platformei, doar fondatorul',
  'src/components/FounderPayoutRow.tsx': 'plăți de afiliere, doar fondatorul',
  'src/components/FounderActivationCard.tsx': 'activare de cont, doar fondatorul',
  'src/components/founder/SalesNetworkPanel.tsx': 'rețeaua de vânzări, doar fondatorul',
}

function sourceFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) {
      if (e.name !== '__tests__') out.push(...sourceFiles(rel))
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(rel)
    }
  }
  return out
}

function scan() {
  const hits = []
  for (const dir of DIRS) {
    for (const file of sourceFiles(dir)) {
      fs.readFileSync(path.join(ROOT, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const v = violations(line)
          if (v.length) hits.push({ file, line: line.trim(), where: `${file}:${i + 1}`, rules: v })
        })
    }
  }
  return hits
}

describe('clichet: fără mesaje de eroare brute pe ecran', () => {
  it('RM0 control pozitiv: scannerul prinde formele interzise și le lasă pe cele legitime', () => {
    const caught = [
      "toast(e.message, 'error')",
      "      toast(err.message, 'error')",
      'setError(e.message)',
      'setError(err.message)',
      "if (error) toast('Eroare: ' + error.message, 'error')",
      "pmToast('Nu am putut salva: ' + error.message, 'error')",
      "setErr(e instanceof Error ? e.message : 'Eroare')",
      'toast.error(e instanceof Error ? e.message : "x")',
      "setMsg({ kind: 'err', text: e.message })",
      "const m = 'Eroare: ' + res.error.message",
      // setter-e ÎN AFARA listei vechi (recenzia pe #333)
      'setTablesLoadError(e.message)',
      "setResult({ ok: false, text: e instanceof Error ? e.message : 'Eroare' })",
      "setSubmitError(e instanceof Error ? e.message : 'x')",
      // randarea directă în JSX
      '<div>{error.message}</div>',
      '{r.error?.message}',
    ]
    for (const l of caught) assert.ok(violations(l).length > 0, `ar trebui prinsă: ${l}`)
    const fine = [
      "toast(toUserMessage(e), 'error')",
      "setError(toUserMessage(err, 'Nu am putut salva.'))",
      "console.error('[x]', e.message)",
      "// toast(e.message) era vechiul cod",
      'const text = form.checkout_suggestion_settings?.message ?? ""',
      "setError('Parolele nu coincid.')",
      // interpolare într-un Error aruncat (nu randare)
      'throw new Error(`Eroare la batch ${i}: ${insErr.message}`)',
      '{toUserMessage(new Error(this.state.error.message), FALLBACK)}',
    ]
    for (const l of fine) assert.deepEqual(violations(l), [], `nu trebuie prinsă: ${l}`)
  })

  it('RM1 nicio eroare brută în afara registrului', () => {
    const hits = scan().filter(
      (h) =>
        !(h.file in ALLOWED_FILES) &&
        !ALLOWED.some((a) => a.file === h.file && h.line.includes(a.contains)),
    )
    assert.deepEqual(
      hits.map((h) => `${h.where}  ${h.line}`),
      [],
      'Mesaj de eroare brut pe ecran: folosește toUserMessage(err, fallback) din src/lib/userMessages.ts',
    )
  })

  it('RM2 registrul e onest: fiecare scutire acoperă o linie chiar prinsă', () => {
    const hits = scan()
    for (const a of ALLOWED) {
      const n = hits.filter((h) => h.file === a.file && h.line.includes(a.contains)).length
      assert.equal(n, 1, `scutirea „${a.contains}" (${a.file}) nu mai acoperă exact o linie prinsă`)
    }
    for (const file of Object.keys(ALLOWED_FILES)) {
      assert.ok(
        hits.some((h) => h.file === file),
        `scutirea pe fișier ${file} nu mai acoperă nimic — scoate-o din ALLOWED_FILES`,
      )
    }
  })
})
