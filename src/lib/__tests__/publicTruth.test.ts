// Adevăr în textele publice (audit v3, S0 — doar România).
//
// Patru promisiuni pe care firma nu le poate onora sau care sunt false, toate
// invizibile pentru orice test fiindcă erau text în JSX:
//   PT1  promisiuni PERSONALE („direct de la fondator", „WhatsApp direct",
//        „răspuns în 4 ore"): WhatsApp e oprit (D4), iar suportul real e prin
//        agentul Menuvia și pe email — vezi datele ȘI sursele paginilor publice;
//   PT2  „10% în fiecare lună": comisionul recurent are plafon (următoarele N
//        facturi lunare), nu curge „în fiecare lună";
//   PT3  review gating: linkul Google apare TUTUROR — nicio condiție pe notă
//        în FeedbackWidget, nicio descriere de marketing a filtrării;
//   PT4  QR-ul de Plan 1 nu promite „pentru a comanda" (qrCopy) și bifa „Gata de
//        comenzi" din onboarding nu mai e hard-codată;
//   PT5  /recrutare (RecrutarePage) vinde EXACT oferta pilot din pricingCopy
//        (`PILOT_DAYS` pe Meniu + Comenzi), nu „3 luni, plan complet", și nu mai
//        are prețuri/defecte ale concurenței sau procente fără sursă. Pagina a
//        intrat și în PT1c: promisiunile personale ale fondatorului (WhatsApp-ul
//        lui, termenul lui de răspuns, apelul lui) au fost scoase.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { INCLUDED_EVERYWHERE, PILOT_BANNER, TRIAL_FAQ } from '../pricingCopy'
import { PLANS, TRUST_SIGNALS } from '../plans'
import { qrCardSubtitles } from '../qrCopy'

// Din process.cwd(), NU din import.meta.url (capcana din qr-scan.test.ts, #269).
const ROOT = process.cwd()
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

const PUBLIC_COPY_FILES = [
  'src/lib/plans.ts',
  'src/lib/pricingCopy.ts',
  'src/pages/PricingPage.tsx',
  'src/pages/LandingPage.tsx',
  'src/pages/LandingPageEn.tsx',
  'src/pages/ComparatiePage.tsx',
  'src/pages/CaseDeMarcatPage.tsx',
  'src/pages/VerticalPage.tsx',
  'src/pages/RezervariPage.tsx',
  'src/pages/AfiliatIntroPage.tsx',
  'src/pages/RecrutarePage.tsx',
]

const PERSONAL_PROMISES: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /direct (cu|de la) fondator/i, why: 'promisiune personală (fondator)' },
  { re: /(from|with) the founder/i, why: 'promisiune personală (founder)' },
  { re: /whatsapp direct|direct (pe|prin) whatsapp/i, why: 'WhatsApp e oprit (D4)' },
  { re: /suport (pe )?whatsapp|support on whatsapp/i, why: 'WhatsApp e oprit (D4)' },
  { re: /(răspuns|răspund\w*) [^.\n]{0,20}\d+ ore/i, why: 'termen de răspuns personal' },
  // Persoana I singular a fondatorului: „te sun eu", „în maximum 24 de ore",
  // „a ajuns la mine", „te ajut personal", „WhatsApp-ul meu".
  { re: /\bte sun (eu|în)\b/i, why: 'apel personal (fondator)' },
  { re: /\b\d+ de ore\b/i, why: 'termen de răspuns personal' },
  { re: /ajuns la mine|te ajut personal|whatsapp(-ul)? meu/i, why: 'promisiune personală (fondator)' },
]

describe('promisiuni personale', () => {
  it('PT1a: datele exportate (planuri, semnale, bandă) nu conțin promisiuni personale', () => {
    const texts = [
      ...INCLUDED_EVERYWHERE,
      PILOT_BANNER.title,
      PILOT_BANNER.body,
      TRIAL_FAQ.q,
      TRIAL_FAQ.a,
      ...TRUST_SIGNALS.flatMap((t) => [t.label, t.desc]),
      ...PLANS.flatMap((p) => [p.tagline, ...p.included, ...p.notIncluded]),
    ]
    expect(texts.length).toBeGreaterThan(30)
    for (const text of texts) {
      for (const { re, why } of PERSONAL_PROMISES) {
        expect(text, `„${text}" — ${why}`).not.toMatch(re)
      }
    }
  })

  it('PT1b: înlocuitorul adevărat e prezent (suport prin agent și email)', () => {
    expect(INCLUDED_EVERYWHERE.join(' ')).toMatch(/agentul tău Menuvia și pe email/)
    const pro = PLANS.find((p) => p.id === 'pro')
    expect(pro?.included.join(' ')).toMatch(/agentul tău Menuvia și pe email/)
  })

  it('PT1c: sursele paginilor publice nu conțin promisiuni personale', () => {
    for (const f of PUBLIC_COPY_FILES) {
      const src = read(f)
      expect(src.length, `${f} gol`).toBeGreaterThan(500)
      for (const { re, why } of PERSONAL_PROMISES) {
        expect(src, `${f} — ${why}`).not.toMatch(re)
      }
    }
  })
})

describe('/recrutare vinde oferta pilot reală', () => {
  const src = read('src/pages/RecrutarePage.tsx')

  it('PT5a: durata vine din PILOT_DAYS, nu dintr-un literal de luni', () => {
    expect(src).toMatch(/import \{ PILOT_DAYS, TRIAL_DAYS \} from '\.\.\/lib\/pricingCopy'/)
    expect(src).toContain('{PILOT_DAYS} de zile gratuite')
    expect(src).not.toMatch(/\d+ luni/i)
    expect(src).not.toMatch(/plan complet|totul inclus|fără limită/i)
  })

  it('PT5b: fără prețuri sau defecte ale concurenței, fără procente fără sursă', () => {
    expect(src).not.toMatch(/SmartBill|Octopus/)
    expect(src).not.toMatch(/✕ Restul/)
    expect(src).not.toMatch(/\bcu \d+%/)
  })

  it('PT5c: Happy Hour nu „sugerează la plată" — se aplică singur (mig 077)', () => {
    expect(src).not.toMatch(/sugerează aplicarea/)
    expect(src).toContain('Reducerea se aplică singură pe comenzile prin QR și de ridicare')
  })

  it('PT5e: exportul pentru contabil e numit pe Planul 3 (ReportsTab: fiscalReports = money ≥ 3)', () => {
    // Pilotul e pe Meniu + Comenzi; acolo ReportsTab ascunde Export CSV/PDF.
    expect(src).not.toMatch(/vândute, export/i)
    expect(src).toContain(
      "Pe ${getPlan('pro').name}: vânzări pe oră, raport TVA, încasări pe tură și export PDF/CSV pentru contabil",
    )
    // Vânzările pe oră / pe ospătar sunt tot Plan 3: problema nu le mai pomenește.
    expect(src).not.toMatch(/când e peak|cine vinde cât/)
  })

  it('PT5d: suportul real e numit (control pozitiv)', () => {
    expect(src).toContain('prin agentul tău Menuvia și pe email')
    expect(src).toContain('Cererea ta a ajuns la noi.')
  })
})

describe('comisionul de afiliere', () => {
  it('PT2: „în fiecare lună" nu mai apare pe paginile de afiliere', () => {
    for (const f of ['src/pages/LandingPage.tsx', 'src/pages/AfiliatIntroPage.tsx']) {
      const src = read(f)
      expect(src, f).not.toMatch(/în fiecare lună/i)
      expect(src, f).not.toMatch(/apoi lunar/i)
    }
    // Înlocuitorul numește plafonul (control pozitiv).
    expect(read('src/pages/LandingPage.tsx')).toMatch(/următoarele \$\{affiliate\.recurring_cap_months/)
    expect(read('src/pages/AfiliatIntroPage.tsx')).toMatch(/următoarele\{' '\}\s*\{defaults\.recurring_cap_months\} facturi lunare/)
  })
})

describe('recenzii Google fără filtrare', () => {
  it('PT3a: FeedbackWidget nu condiționează linkul de notă', () => {
    const src = read('src/components/PaymentConfirmedScreen.tsx')
    const code = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l))
      .join('\n')
    expect(code).not.toMatch(/avgRating/)
    expect(code).not.toMatch(/Rating\s*>=\s*\d/)
    expect(code).toMatch(/const showGoogleCTA = step === 'complete' && Boolean\(safeReviewUrl\)/)
  })

  it('PT3b: copy-ul de marketing/setări nu descrie filtrarea după notă', () => {
    const settings = read('src/components/SettingsTab.tsx')
    expect(settings).not.toMatch(/rating\s*≥\s*4/)
    expect(settings).not.toMatch(/feedback pozitiv/i)
    const vertical = read('src/pages/VerticalPage.tsx')
    expect(vertical).not.toMatch(/clienții mulțumiți sunt invitați/i)
    expect(vertical).not.toMatch(/mai puțin bun vine la tine, privat/i)
  })
})

describe('QR și onboarding nu promit comenzi pe planuri fără comenzi', () => {
  it('PT4a: qrCardSubtitles — „pentru a comanda" doar dacă planul permite comenzi', () => {
    expect(qrCardSubtitles(true).ro).toMatch(/comanda/i)
    expect(qrCardSubtitles(true).en).toMatch(/order/i)
    expect(qrCardSubtitles(false).ro).not.toMatch(/comanda/i)
    expect(qrCardSubtitles(false).en).not.toMatch(/order/i)
  })

  it('PT4b: TablesManager folosește helperul, nu textul fix', () => {
    const src = read('src/components/TablesManager.tsx')
    expect(src).toContain('qrCardSubtitles(')
    expect(src).not.toContain("'Scanează pentru a comanda'")
    expect(src).not.toContain("'Scan to order'")
  })

  it('PT4c: „Gata de comenzi" din onboarding depinde de plan', () => {
    const src = read('src/pages/OnboardingPage.tsx')
    expect(src).toContain("hasFeature(f, 'order_qr')")
    expect(src).toContain('canOrder ? t.step4.ordersReady : t.step4.menuQrReady')
    // Nu mai e în lista fixă de bife.
    expect(src).not.toMatch(/achievements: \[[^\]]*Gata de comenzi/)
    expect(src).not.toMatch(/achievements: \[[^\]]*Ready for orders/)
  })
})
