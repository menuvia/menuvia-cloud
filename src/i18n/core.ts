// src/i18n/core.ts — dicționarele personalului (lotul L0b). Fără bibliotecă:
// aceeași idee ca `T()` al oaspetelui, cu două lucruri în plus — plural pe
// regulile limbii (`Intl.PluralRules`) și încărcare leneșă pe limbă.
//
// Un NAMESPACE = un grup de texte al unui ecran sau al unei familii de ecrane
// (`src/i18n/ns/<ns>/{ro,en,fr,de}.ts` + `index.ts`). Reguli:
//   - `ro.ts` e SURSA DE ADEVĂR și e importat static de `index.ts`: zero cost
//     și zero schimbare pentru românii de azi, iar testele cu text românesc
//     rămân neschimbate;
//   - `en/fr/de` au tipul `Translation<typeof ro>`: o cheie lipsă sau în plus
//     e eroare de COMPILARE; se încarcă prin `import()` doar când e cerută
//     limba lor, deci nu intră niciodată în pachetul de intrare;
//   - o limbă fără fișier cade ÎNTREG pe engleză (apoi pe română) — niciodată
//     un ecran amestecat cheie cu cheie;
//   - un namespace se importă DOAR din ecranele personalului (lazy): clichetul
//     SK4 din `staffI18n.test.ts` verifică graful static al intrării și al
//     paginilor oaspetelui.
import type { StaffLang } from './langs'

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
/** Formele de plural ale unui text; categoriile exacte depind de limbă
 *  (ro: one/few/other, en/de: one/other, fr: one/many/other) — SK3. */
export type Plural = { other: string } & Partial<Record<Exclude<PluralCategory, 'other'>, string>>
export type Dict = Record<string, string | Plural>
/** Forma pe care trebuie s-o aibă o traducere a dicționarului `D`. */
export type Translation<D extends Dict> = { [K in keyof D]: D[K] extends string ? string : Plural }

export type StringKey<D> = { [K in keyof D]: D[K] extends string ? K : never }[keyof D] & string
export type PluralKey<D> = { [K in keyof D]: D[K] extends string ? never : K }[keyof D] & string
export type Vars = Record<string, string | number>

type Loader<D extends Dict> = () => Promise<{ default: Translation<D> }>
type LoadedLang = Exclude<StaffLang, 'ro'>

export interface Namespace<D extends Dict> {
  readonly name: string
  readonly ro: D
  readonly loaders: Partial<Record<LoadedLang, Loader<D>>>
  /** Starea încărcării per limbă: dicționarul gata sau promisiunea în zbor. */
  readonly cache: Map<LoadedLang, Translation<D> | Promise<void>>
}

export function defineNamespace<D extends Dict>(
  name: string,
  ro: D,
  loaders: Partial<Record<LoadedLang, Loader<D>>>,
): Namespace<D> {
  return { name, ro, loaders, cache: new Map() }
}

/** Limba din care se servește EFECTIV namespace-ul: cea cerută dacă are
 *  fișier, altfel engleza dacă are, altfel româna (sursa). */
export function effectiveLang<D extends Dict>(ns: Namespace<D>, lang: StaffLang): StaffLang {
  if (lang === 'ro') return 'ro'
  if (ns.loaders[lang]) return lang
  return ns.loaders.en ? 'en' : 'ro'
}

/** Reîncercările în fundal după o încărcare eșuată (ms de la eșec). */
export const NAMESPACE_RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const

/**
 * După un eșec, dicționarul se reîncearcă în FUNDAL (la revenirea rețelei sau
 * după câteva secunde, de cel mult trei ori), fără să suspende nimic: cache-ul
 * ține deja româna, deci ecranul rămâne randat, iar următoarea randare (o
 * comandă nouă, o navigare) îl preia în limba cerută. Fără asta, o singură
 * cădere de rețea la deschiderea Bucătăriei lăsa ecranul în română până la
 * reîncărcarea paginii. Gărzile pe `window` contează: un temporizator care se
 * declanșează după demontarea mediului de test (jsdom) nu are voie să arunce.
 * Rezidual consemnat: unele motoare (WebKit) țin minte un `import()` eșuat
 * pentru aceeași adresă și resping reîncercarea pe loc — acolo cele trei
 * încercări pică inofensiv și ecranul rămâne în română până la reîncărcare,
 * exact comportamentul de dinainte (recenzia adversarială pe #388).
 */
function scheduleRetry<D extends Dict>(ns: Namespace<D>, eff: LoadedLang, loader: Loader<D>, attempt: number): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  if (attempt >= NAMESPACE_RETRY_DELAYS_MS.length) return
  let started = false
  const run = (fromTimer: boolean): void => {
    if (started || typeof window === 'undefined') return
    // Offline, temporizatorul NU consumă o încercare (ar fi pică sigur): se
    // așteaptă doar evenimentul `online` — altfel o pană de Wi-Fi mai lungă de
    // ~2,5 minute epuiza cele trei încercări și dicționarul nu mai revenea
    // (recenzia adversarială pe #388).
    if (fromTimer && typeof navigator !== 'undefined' && navigator.onLine === false) return
    started = true
    window.removeEventListener('online', onOnline)
    clearTimeout(timer)
    loader().then(
      (m) => {
        // Doar dacă locul ține încă rezerva românească (nimeni n-a pus altceva).
        if (ns.cache.get(eff) === (ns.ro as unknown)) ns.cache.set(eff, m.default)
      },
      () => scheduleRetry(ns, eff, loader, attempt + 1),
    )
  }
  const onOnline = (): void => run(false)
  const timer = setTimeout(() => run(true), NAMESPACE_RETRY_DELAYS_MS[attempt])
  window.addEventListener('online', onOnline)
}

/**
 * Dicționarul gata de folosit, sau promisiunea care îl încarcă (pentru
 * Suspense). O încărcare eșuată (chunk indisponibil, rețea) cade pe română:
 * un ecran în limba sursă e mai bun decât unul agățat pe spinner. Încărcarea
 * se reîncearcă apoi în fundal (`scheduleRetry`).
 */
export function readNamespace<D extends Dict>(
  ns: Namespace<D>,
  lang: StaffLang,
): { dict: Translation<D> | D; lang: StaffLang } | { pending: Promise<void> } {
  const eff = effectiveLang(ns, lang)
  if (eff === 'ro') return { dict: ns.ro, lang: 'ro' }
  const hit = ns.cache.get(eff)
  // O încărcare eșuată a pus româna în cache: textele SUNT în română, deci și
  // limba raportată (pluralul, `describeStaffError`) trebuie să fie 'ro'.
  if (hit && !(hit instanceof Promise)) return { dict: hit, lang: hit === (ns.ro as unknown) ? 'ro' : eff }
  if (hit instanceof Promise) return { pending: hit }
  const loader = ns.loaders[eff]
  if (!loader) return { dict: ns.ro, lang: 'ro' }
  const p = loader().then(
    (m) => {
      ns.cache.set(eff, m.default)
    },
    (err: unknown) => {
      console.warn(`[i18n] namespace „${ns.name}” (${eff}) nu s-a încărcat; rămâne în română`, err)
      ns.cache.set(eff, ns.ro as unknown as Translation<D>)
      scheduleRetry(ns, eff, loader, 0)
    },
  )
  ns.cache.set(eff, p)
  return { pending: p }
}

/** Pornește (sau așteaptă) încărcarea unei limbi fără să suspende nimic:
 *  pentru teste și pentru ecranele care știu dinainte limba de care vor avea
 *  nevoie. Nu aruncă: o încărcare eșuată a pus deja româna în cache. */
export function preloadNamespace<D extends Dict>(ns: Namespace<D>, lang: StaffLang): Promise<void> {
  const r = readNamespace(ns, lang)
  return 'pending' in r ? r.pending : Promise.resolve()
}

/** `{nume}` → valoarea din `vars`; un loc fără valoare rămâne VIZIBIL
 *  (`{nume}`), ca testele să-l prindă în loc să dispară tăcut. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m: string, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m,
  )
}

const pluralRulesCache = new Map<string, Intl.PluralRules>()
export function pluralCategory(lang: StaffLang, count: number): PluralCategory {
  let rules = pluralRulesCache.get(lang)
  if (!rules) {
    rules = new Intl.PluralRules(lang)
    pluralRulesCache.set(lang, rules)
  }
  return rules.select(count) as PluralCategory
}

export function selectPlural(forms: Plural, lang: StaffLang, count: number): string {
  return forms[pluralCategory(lang, count)] ?? forms.other
}

export interface Translator<D extends Dict> {
  /** Limba în care sunt EFECTIV textele (poate fi engleza pentru un namespace
   *  fără fișier în limba cerută). */
  lang: StaffLang
  t: (key: StringKey<D>, vars?: Vars) => string
  /** Plural: `{n}` primește numărul ca atare (fără separatori de mii — la fel
   *  ca textele românești de azi). */
  tp: (key: PluralKey<D>, count: number, vars?: Vars) => string
}

export function makeTranslator<D extends Dict>(dict: Translation<D> | D, lang: StaffLang): Translator<D> {
  const table = dict as Record<string, string | Plural>
  return {
    lang,
    t: (key, vars) => {
      const v = table[key]
      return interpolate(typeof v === 'string' ? v : (v?.other ?? key), vars)
    },
    tp: (key, count, vars) => {
      const v = table[key]
      const forms: Plural = typeof v === 'string' ? { other: v } : (v ?? { other: key })
      return interpolate(selectPlural(forms, lang, count), { n: String(count), ...vars })
    },
  }
}
