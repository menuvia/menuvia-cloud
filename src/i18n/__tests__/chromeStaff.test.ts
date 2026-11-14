// Cromul comun pe rutele personalului și ale funnel-ului (lotul L4d) — partea
// fără DOM. Partea cu DOM: LD1–LD7 (`StaffDocumentLang.test.tsx`).
//   LZ1  cheile noi din `chrome.ts` există în cele patru limbi, iar româna e
//        BYTE-identică cu textele scrise direct înainte (PWAPrompt, Spinner,
//        main.tsx, poarta de rol). CR1 (`chrome.test.ts`) cere deja aceleași
//        chei peste tot. Mutația care pică: „Mai târziu” → „Mai tarziu”.
//   LZ2  `app_doc_title` în română = `<title>` din index.html (titlul tab-ului
//        nu se schimbă cât timp ecranul e în română). Mutația care pică: un
//        titlu românesc rescris doar în chrome.ts.
//   LZ3  registrul: germana la „Sie” (fără du/dein), franceza cu spațiu
//        înainte de : ? ! — ca `common`. Control pozitiv pe detector.
//   LZ4  motivul comenzii offline respinse: hint cunoscut → cheia lui,
//        necunoscut/lipsă → `offline_reason_other`; fiecare cheie există în
//        `waiter`, în cele patru limbi. `readOfflineDrop` citește defensiv.
//   LZ5  clichet STRUCTURAL pe cablaj: App.tsx învelește în `StaffDocumentLang`
//        EXACT panoul, ospătarul și bucătăria, plus spinner-ul redirectului
//        pe ecranul rolului, care nu conține NICIO pagină (spinner-ul de
//        context rămâne neînvelit: RR4 îi îngheață literalul); în `FunnelDocumentLang` EXACT cele patru
//        pagini ale funnel-ului (cu spinner-ul rutei: fallback-ul chunk-ului,
//        redirectul spre /auth, așteptarea sesiunii pe rutele funnel-ului) — nicio pagină a
//        oaspetelui sau a personalului în niciunul; poarta de Termeni e
//        `scope="overlay"`, cele patru pagini ale funnel-ului au provider-ul
//        simplu (fără `<Suspense>` propriu: îl dă ruta);
//        main.tsx citește limba în `getDerivedStateFromError`; WaiterPage
//        traduce motivul doar în afara românei. Mutațiile care pică:
//        `<StaffDocumentLang>` mutat deasupra rutei `qr`; `scope="overlay"`
//        scos din poartă; ruta /auth fără `FunnelDocumentLang`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHROME_STRINGS, type ChromeKey } from '../chrome'
import { offlineDropReasonKey, readOfflineDrop, type OfflineDropReasonKey } from '../../lib/offlineDrop'
import waiterRo from '../ns/waiter/ro'
import waiterEn from '../ns/waiter/en'
import waiterFr from '../ns/waiter/fr'
import waiterDe from '../ns/waiter/de'

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

const NEW_RO: Readonly<Partial<Record<ChromeKey, string>>> = {
  spinner_label: 'Se încarcă',
  boot_error: 'A apărut o eroare. Reîncarcă pagina.',
  app_doc_title: 'Menuvia — Meniu digital și comenzi QR pentru restaurante',
  gate_perms_error: 'Nu am putut încărca permisiunile. Verifică conexiunea și reîncearcă.',
  gate_no_access: 'Nu ai acces la această pagină. Contactează managerul restaurantului.',
  gate_go_home: 'Mergi la ecranul tău',
  pwa_update_title: 'Actualizare disponibilă',
  pwa_update_body: 'O versiune nouă a aplicației e gata. Poți actualiza acum sau la următoarea deschidere.',
  pwa_update_action: 'Actualizează',
  pwa_update_later: 'Mai târziu',
  pwa_install_title: 'Instalează Menuvia',
  pwa_install_body: 'Folosește aplicația direct de pe ecranul principal.',
  pwa_install_action: 'Instalează',
  pwa_close: 'Închide',
}
const NEW_KEYS = Object.keys(NEW_RO) as ChromeKey[]

describe('LZ1–LZ3 textele noi ale cromului', () => {
  it('LZ1 există în cele patru limbi; româna e textul de dinainte', () => {
    for (const k of NEW_KEYS) {
      expect(CHROME_STRINGS.ro[k], k).toBe(NEW_RO[k])
      for (const l of ['en', 'fr', 'de'] as const) {
        expect(CHROME_STRINGS[l][k], `${l}.${k}`).toBeTruthy()
        // Fiecare limbă are textul EI (numele „Menuvia” singur nu contează).
        expect(CHROME_STRINGS[l][k], `${l}.${k}`).not.toBe(CHROME_STRINGS.ro[k])
      }
    }
  })

  it('LZ2 titlul românesc = `<title>` din index.html', () => {
    const m = read('index.html').match(/<title>([^<]*)<\/title>/)
    expect(m?.[1]).toBe(CHROME_STRINGS.ro.app_doc_title)
  })

  it('LZ3 registrul: de la „Sie”, fr cu spațiu înainte de : ? !', () => {
    const du = /\b(du|dein|deine|deinen|dich|dir)\b/i
    const frPunct = /[^\s  ][:?!]/
    // Control pozitiv: detectorii văd forma greșită.
    expect(du.test('Lade die Seite neu, wenn du willst')).toBe(true)
    expect(frPunct.test('Erreur: réessayez')).toBe(true)
    for (const k of NEW_KEYS) {
      expect(CHROME_STRINGS.de[k], `de.${k}`).not.toMatch(du)
      expect(CHROME_STRINGS.fr[k], `fr.${k}`).not.toMatch(frPunct)
    }
  })
})

describe('LZ4 motivul comenzii offline respinse', () => {
  it('LZ4 hint → cheie; necunoscut sau lipsă → „respinsă de server”', () => {
    expect(offlineDropReasonKey('product_sold_out')).toBe('offline_reason_soldOut')
    expect(offlineDropReasonKey('product_inactive')).toBe('offline_reason_gone')
    expect(offlineDropReasonKey('missing_required_group')).toBe('offline_reason_group')
    expect(offlineDropReasonKey('invalid_extras')).toBe('offline_reason_options')
    expect(offlineDropReasonKey('item_notes_too_long')).toBe('offline_reason_notes')
    expect(offlineDropReasonKey('plan_upgrade_required')).toBe('offline_reason_orderingOff')
    expect(offlineDropReasonKey('too_many_items')).toBe('offline_reason_quantity')
    expect(offlineDropReasonKey('ceva_nou')).toBe('offline_reason_other')
    expect(offlineDropReasonKey('toString')).toBe('offline_reason_other')
    expect(offlineDropReasonKey(null)).toBe('offline_reason_other')
    expect(offlineDropReasonKey(undefined)).toBe('offline_reason_other')
  })

  it('LZ4 fiecare cheie de motiv există în `waiter`, în cele patru limbi', () => {
    const keys: OfflineDropReasonKey[] = [
      'offline_reason_soldOut',
      'offline_reason_gone',
      'offline_reason_options',
      'offline_reason_group',
      'offline_reason_quantity',
      'offline_reason_notes',
      'offline_reason_orderingOff',
      'offline_reason_other',
    ]
    for (const dict of [waiterRo, waiterEn, waiterFr, waiterDe] as const) {
      const table = dict as unknown as Record<string, unknown>
      for (const k of keys) expect(typeof table[k], k).toBe('string')
    }
  })

  it('LZ4 readOfflineDrop: detaliu complet, vechi (doar `reason`) sau lipsă', () => {
    expect(readOfflineDrop({ reason: 'x', hint: 'product_sold_out', code: 'P0001' })).toEqual({
      reason: 'x',
      hint: 'product_sold_out',
      code: 'P0001',
    })
    expect(readOfflineDrop({ reason: 'Produs inactiv' })).toEqual({
      reason: 'Produs inactiv',
      hint: null,
      code: null,
    })
    expect(readOfflineDrop(undefined)).toEqual({ reason: 'eroare necunoscută', hint: null, code: null })
  })
})

/** Blocurile `<Tag>…</Tag>` din sursă. */
function blocks(src: string, tag: string): string[] {
  const out: string[] = []
  let at = src.indexOf(`<${tag}>`)
  while (at !== -1) {
    const end = src.indexOf(`</${tag}>`, at)
    expect(end).toBeGreaterThan(at)
    out.push(src.slice(at, end))
    at = src.indexOf(`<${tag}>`, end)
  }
  return out
}

const GUEST_AND_OTHER_PAGES = [
  '<QrMenuPage',
  '<PublicMenuPage',
  '<ReservePage',
  '<NotFoundPage',
  '<LandingPage',
  '<FounderPage',
  '<AffiliateRoute',
]
const STAFF_PAGES = ['<KitchenPage', '<WaiterPage', '<DashboardPage']
const FUNNEL_PAGES = ['<AuthPage', '<OnboardingPage', '<ResetPasswordPage', '<InviteAcceptPage']
/** Un bloc care nu conține nicio pagină: doar spinner-ul rutei. */
const spinnerOnly = (b: string): boolean =>
  b.replace(/^<[A-Za-z]+>/, '').trim() === '<PageSpinner />'

describe('LZ5 cablajul', () => {
  it('LZ5 App.tsx: exact panoul, ospătarul și bucătăria sub StaffDocumentLang', () => {
    const staff = blocks(read('src/App.tsx'), 'StaffDocumentLang')
    const withPage = staff.filter((b) => !spinnerOnly(b))
    expect(withPage).toHaveLength(3)
    expect(staff.filter(spinnerOnly)).toHaveLength(1)
    const joined = staff.join('\n')
    for (const page of STAFF_PAGES) expect(joined).toContain(page)
    for (const page of [...GUEST_AND_OTHER_PAGES, ...FUNNEL_PAGES]) {
      expect(joined, page).not.toContain(page)
    }
  })

  it('LZ5 App.tsx: exact cele patru pagini ale funnel-ului sub FunnelDocumentLang', () => {
    const funnel = blocks(read('src/App.tsx'), 'FunnelDocumentLang')
    const withPage = funnel.filter((b) => !spinnerOnly(b))
    expect(withPage).toHaveLength(4)
    for (const page of FUNNEL_PAGES) {
      expect(withPage.filter((b) => b.includes(page)), page).toHaveLength(1)
    }
    // Spinner-ele rutelor funnel-ului: așteptarea sesiunii (/auth,
    // /reset-password, /invite) și redirectul spre /auth.
    expect(funnel.filter(spinnerOnly)).toHaveLength(2)
    const joined = funnel.join('\n')
    for (const page of [...GUEST_AND_OTHER_PAGES, ...STAFF_PAGES]) {
      expect(joined, page).not.toContain(page)
    }
  })

  it('LZ5 funnel-ul: poarta e overlay, paginile au provider-ul simplu', () => {
    expect(read('src/components/TermsAcceptanceGate.tsx')).toContain('<FunnelLangProvider scope="overlay">')
    for (const p of ['AuthPage', 'OnboardingPage', 'ResetPasswordPage', 'InviteAcceptPage']) {
      const src = read(`src/pages/${p}.tsx`)
      expect(src, p).toContain('<FunnelLangProvider>')
      expect(src, p).not.toContain('scope="overlay"')
    }
  })

  it('LZ5 main.tsx și WaiterPage', () => {
    const main = read('src/main.tsx')
    expect(main).toMatch(
      /getDerivedStateFromError\(\)[\s\S]{0,80}?return \{ hasError: true, lang: documentChromeLang\(\) \}/,
    )
    expect(main).toContain("chromeT(this.state.lang, 'boot_error')")
    expect(main).not.toContain('A apărut o eroare. Reîncarcă pagina.')
    const waiter = read('src/pages/WaiterPage.tsx')
    expect(waiter).toMatch(
      /tw\.lang === 'ro'\s*\?\s*offlineQueue\.droppedReason\s*:\s*tw\.t\(offlineDropReasonKey\(offlineQueue\.dropped\?\.hint\)\)/,
    )
  })
})
