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

/**
 * Dicționarul gata de folosit, sau promisiunea care îl încarcă (pentru
 * Suspense). O încărcare eșuată (chunk indisponibil, rețea) cade pe română:
 * un ecran în limba sursă e mai bun decât unul agățat pe spinner.
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
