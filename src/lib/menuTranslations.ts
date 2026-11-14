// ─────────────────────────────────────────────────────────────
// menuTranslations — raportul de traduceri al meniului (lotul O6c), PUR.
//
// Ecranul Meniu → Traduceri arată, pe fiecare limbă activă, ce texte ale
// meniului VĂZUT de oaspete nu sunt încă traduse: numele categoriilor (+
// subtitlul), numele și descrierile produselor, grupurile de opțiuni,
// opțiunile și extra-urile. Unitatea de lucru e un RÂND (o categorie, un
// produs…), cu câmpurile pe care oaspetele le-ar citi; numărătorile sunt în
// TEXTE (câmpuri), nu în rânduri.
//
// Vizibilitatea OGLINDEȘTE filtrele lui `get_menu_for_restaurant` (mig 321):
// produs = activ, nepublicat-ca-ciornă și cu categorie; extra = disponibil, pe
// un produs vizibil; grup = legat (product_modifier_groups) de cel puțin un
// produs vizibil; opțiune = disponibilă, într-un grup vizibil; categoriile =
// toate. Schimbi filtrele RPC-ului → le schimbi și aici, altfel procentele
// mint tăcut.
// ─────────────────────────────────────────────────────────────
import {
  aiFieldsOf,
  availableMenuLangs,
  normalizeMenuSearch,
  type TranslatedField,
  type Translations,
} from './i18nMenu'

export type TrKind = 'category' | 'product' | 'group' | 'option' | 'extra'
export type TrTable = 'categories' | 'products' | 'modifier_groups' | 'modifier_options' | 'product_extras'

export const TR_TABLE: Readonly<Record<TrKind, TrTable>> = {
  category: 'categories',
  product: 'products',
  group: 'modifier_groups',
  option: 'modifier_options',
  extra: 'product_extras',
}

// Formele minime ale rândurilor citite (structurale: `Product`/`Category` din
// useData le satisfac fără conversie).
export interface TrCategoryRow {
  id: string
  name: string
  meta_text: string | null
  display_order: number
  translations?: Translations | null
}
export interface TrProductRow {
  id: string
  name: string
  description: string | null
  category_id: string | null
  is_active: boolean
  is_draft: boolean
  display_order: number
  translations?: Translations | null
}
export interface TrGroupRow {
  id: string
  name: string
  display_order: number
  translations?: Translations | null
}
export interface TrOptionRow {
  id: string
  modifier_group_id: string
  name: string
  is_available: boolean
  display_order: number
  translations?: Translations | null
}
export interface TrExtraRow {
  id: string
  product_id: string
  name: string
  is_available: boolean
  display_order: number
  translations?: Translations | null
}
export interface TrLinkRow {
  product_id: string
  modifier_group_id: string
}

export interface TrSource {
  name: string
  description?: string
  meta_text?: string
}

export interface TrUnit {
  /** `${kind}:${id}` — unic pe tot meniul. */
  key: string
  kind: TrKind
  table: TrTable
  id: string
  /** Originalul, în limba de bază. */
  source: TrSource
  /** Câmpurile pe care oaspetele le citește (cele cu original nevid). */
  fields: TranslatedField[]
  translations: Translations | null
  /** Contextul de pe ecran: categoria produsului, grupul opțiunii, produsul extra-ului. */
  contextLabel: string
  /** Contextul trimis AI-ului (doar grupuri, opțiuni, extra-uri). */
  aiContext?: string
  /** Gruparea pe ecran: categoriile, o categorie, un grup, un produs. */
  sectionKey: string
  /** Azi mereu `true`: rândurile ascunse oaspeților nu intră în raport (follow-up). */
  visible: boolean
}

/** Produsul pe care îl vede oaspetele (filtrele lui get_menu_for_restaurant). */
export function isGuestVisibleProduct(p: Pick<TrProductRow, 'is_active' | 'is_draft' | 'category_id'>): boolean {
  return p.is_active && !p.is_draft && p.category_id != null
}

const nonEmpty = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim().length > 0

/**
 * Câmpurile traductibile ale unui rând: numele, descrierea DOAR pe produse cu
 * descriere, subtitlul DOAR pe categorii cu subtitlu. Aceeași regulă pentru
 * raport și pentru traducerea AI (AiBulkGenerate).
 */
export function trFieldsFor(kind: TrKind, source: TrSource): TranslatedField[] {
  const out: TranslatedField[] = []
  if (nonEmpty(source.name)) out.push('name')
  if (kind === 'product' && nonEmpty(source.description)) out.push('description')
  if (kind === 'category' && nonEmpty(source.meta_text)) out.push('meta_text')
  return out
}

const byOrder = (a: { display_order: number; name: string }, b: { display_order: number; name: string }) =>
  a.display_order - b.display_order || a.name.localeCompare(b.name, 'ro')

function unit(
  kind: TrKind,
  id: string,
  source: TrSource,
  translations: Translations | null | undefined,
  contextLabel: string,
  sectionKey: string,
  aiContext?: string,
): TrUnit | null {
  const fields = trFieldsFor(kind, source)
  if (fields.length === 0) return null
  return {
    key: `${kind}:${id}`,
    kind,
    table: TR_TABLE[kind],
    id,
    source,
    fields,
    translations: translations ?? null,
    contextLabel,
    ...(aiContext ? { aiContext } : {}),
    sectionKey,
    visible: true,
  }
}

function sourceOf(name: string, description?: string | null, meta?: string | null): TrSource {
  const s: TrSource = { name }
  if (nonEmpty(description)) s.description = description
  if (nonEmpty(meta)) s.meta_text = meta
  return s
}

/**
 * Rândurile traductibile ale meniului VĂZUT de oaspete, în ordinea meniului:
 * categoriile, produsele sub categoria lor, fiecare grup urmat de opțiunile
 * lui, apoi extra-urile pe produs. Ce nu e trimis (`groups` etc.) lipsește.
 */
export function buildTranslationUnits(input: {
  categories: readonly TrCategoryRow[]
  products: readonly TrProductRow[]
  groups?: readonly TrGroupRow[]
  options?: readonly TrOptionRow[]
  extras?: readonly TrExtraRow[]
  links?: readonly TrLinkRow[]
}): TrUnit[] {
  const out: TrUnit[] = []
  const push = (u: TrUnit | null) => {
    if (u) out.push(u)
  }
  const cats = [...input.categories].sort(byOrder)
  for (const c of cats) {
    push(unit('category', c.id, sourceOf(c.name, null, c.meta_text), c.translations, '', 'categories'))
  }
  const catIds = new Set(cats.map((c) => c.id))
  const catName = new Map(cats.map((c) => [c.id, c.name]))
  // Produsele vizibile, în ordinea meniului (categorie, apoi poziție, apoi nume).
  const catRank = new Map(cats.map((c, i) => [c.id, i]))
  const visible = input.products
    .filter((p) => isGuestVisibleProduct(p) && p.category_id != null && catIds.has(p.category_id))
    .sort(
      (a, b) =>
        (catRank.get(a.category_id ?? '') ?? 0) - (catRank.get(b.category_id ?? '') ?? 0) ||
        byOrder(a, b),
    )
  for (const p of visible) {
    const cid = p.category_id ?? ''
    push(
      unit(
        'product',
        p.id,
        sourceOf(p.name, p.description),
        p.translations,
        catName.get(cid) ?? '',
        `cat:${cid}`,
      ),
    )
  }
  const visibleIds = new Set(visible.map((p) => p.id))

  if (input.groups && input.links) {
    const linked = new Set(
      input.links.filter((l) => visibleIds.has(l.product_id)).map((l) => l.modifier_group_id),
    )
    const groups = input.groups.filter((g) => linked.has(g.id)).sort(byOrder)
    const opts = (input.options ?? []).filter((o) => o.is_available)
    for (const g of groups) {
      const mine = opts.filter((o) => o.modifier_group_id === g.id).sort(byOrder)
      const examples = mine
        .slice(0, 3)
        .map((o) => o.name.trim())
        .filter(Boolean)
      push(
        unit(
          'group',
          g.id,
          sourceOf(g.name),
          g.translations,
          '',
          `group:${g.id}`,
          examples.length > 0 ? `Grup de opțiuni (ex.: ${examples.join(', ')})` : 'Grup de opțiuni',
        ),
      )
      for (const o of mine) {
        push(
          unit(
            'option',
            o.id,
            sourceOf(o.name),
            o.translations,
            g.name,
            `group:${g.id}`,
            `Opțiune din grupul «${g.name}»`,
          ),
        )
      }
    }
  }

  if (input.extras) {
    const extras = input.extras.filter((e) => e.is_available && visibleIds.has(e.product_id))
    for (const p of visible) {
      for (const e of extras.filter((x) => x.product_id === p.id).sort(byOrder)) {
        push(
          unit(
            'extra',
            e.id,
            sourceOf(e.name),
            e.translations,
            p.name,
            `prod:${p.id}`,
            `Extra plătit la produsul «${p.name}»`,
          ),
        )
      }
    }
  }
  return out
}

/** Câmpurile cerute încă netraduse pe o limbă (spațiile goale = lipsă; baza nu cere nimic). */
export function missingFields(u: TrUnit, lang: string, base = 'ro'): TranslatedField[] {
  if (lang === base) return []
  const entry = u.translations?.[lang]
  return u.fields.filter((f) => {
    const v = entry?.[f]
    return !(typeof v === 'string' && v.trim().length > 0)
  })
}

/** Câmpurile cerute traduse de AI și neverificate încă, pe o limbă. */
export function reviewFields(u: TrUnit, lang: string, base = 'ro'): TranslatedField[] {
  if (lang === base) return []
  const flagged = aiFieldsOf(u.translations?.[lang])
  return u.fields.filter((f) => flagged.includes(f))
}

/**
 * Regula „are nevoie de traducere AI”, comună cu raportul: o limbă țintă la
 * care lipsește vreunul dintre câmpurile cerute.
 */
export function needsAiTranslation(
  fields: readonly TranslatedField[],
  translations: Translations | null | undefined,
  langs: readonly string[],
): boolean {
  return langs.some((l) =>
    fields.some((f) => {
      const v = translations?.[l]?.[f]
      return !(typeof v === 'string' && v.trim().length > 0)
    }),
  )
}

export interface LangCoverage {
  total: number
  done: number
  missing: number
  review: number
}

/** Acoperirea unei limbi, în TEXTE. */
export function langCoverage(units: readonly TrUnit[], lang: string, base = 'ro'): LangCoverage {
  let total = 0
  let missing = 0
  let review = 0
  for (const u of units) {
    total += lang === base ? 0 : u.fields.length
    missing += missingFields(u, lang, base).length
    review += reviewFields(u, lang, base).length
  }
  return { total, done: total - missing, missing, review }
}

export type TrFilterMode = 'missing' | 'review' | 'all'

/**
 * Rândurile listei pe o limbă: „Lipsă” / „De verificat” / „Toate”, plus
 * căutarea în original și în traducere (fără diacritice). `keep` = rândurile
 * salvate în sesiune: rămân pe ecran chiar dacă filtrul nu le mai cere.
 */
export function filterUnits(
  units: readonly TrUnit[],
  lang: string,
  mode: TrFilterMode,
  query: string,
  opts: { base?: string; keep?: ReadonlySet<string> } = {},
): TrUnit[] {
  const base = opts.base ?? 'ro'
  const q = normalizeMenuSearch(query.trim())
  return units.filter((u) => {
    const byMode =
      mode === 'all' ||
      opts.keep?.has(u.key) === true ||
      (mode === 'missing' ? missingFields(u, lang, base).length > 0 : reviewFields(u, lang, base).length > 0)
    if (!byMode) return false
    if (!q) return true
    const entry = u.translations?.[lang]
    const hay = [
      u.source.name,
      u.source.description,
      u.source.meta_text,
      entry?.name,
      entry?.description,
      entry?.meta_text,
    ]
    return hay.some((t) => typeof t === 'string' && normalizeMenuSearch(t).includes(q))
  })
}

/**
 * Limbile în care oaspetele VEDE meniul azi: aceeași regulă ca pagina publică
 * (availableMenuLangs), pe categoriile și produsele vizibile.
 */
export function guestMenuLangs(
  units: readonly TrUnit[],
  allowed: readonly string[] | null | undefined,
  base: string,
): string[] {
  const rows = units
    .filter((u) => u.kind === 'category' || u.kind === 'product')
    .map((u) => ({ translations: u.translations }))
  return availableMenuLangs([{ translations: null, products: rows }], allowed ? [...allowed] : null, base)
}

/** Categoriile se traduc cu subtitlul în locul descrierii: răspunsul AI se mută la loc. */
export function remapCategoryAi(map: Record<string, Translations>): Record<string, Translations> {
  const out: Record<string, Translations> = {}
  for (const [id, tr] of Object.entries(map)) {
    const next: Translations = {}
    for (const [code, entry] of Object.entries(tr)) {
      const moved = { ...entry }
      if (typeof moved.description === 'string') {
        moved.meta_text = moved.description
        delete moved.description
      }
      next[code] = moved
    }
    out[id] = next
  }
  return out
}

// Rândurile de opțiuni/extra-uri pentru traducerea AI în lot (AiBulkGenerate).
export interface AiOptionRow {
  id: string
  name: string
  translations: Translations | null
  context?: string
}
export interface AiOptionRows {
  groups: AiOptionRow[]
  options: AiOptionRow[]
  extras: AiOptionRow[]
}

/** Grupurile, opțiunile și extra-urile din raport, gata de tradus cu AI. */
export function aiOptionRows(units: readonly TrUnit[]): AiOptionRows {
  const row = (u: TrUnit): AiOptionRow => ({
    id: u.id,
    name: u.source.name,
    translations: u.translations,
    ...(u.aiContext ? { context: u.aiContext } : {}),
  })
  return {
    groups: units.filter((u) => u.kind === 'group').map(row),
    options: units.filter((u) => u.kind === 'option').map(row),
    extras: units.filter((u) => u.kind === 'extra').map(row),
  }
}

/** Calea meniului public într-o limbă (pagina /m/:slug citește `?lang=`). */
export function menuPreviewPath(slug: string, lang: string): string {
  return `/m/${encodeURIComponent(slug)}?lang=${lang}`
}

/** Plural românesc: „1 text”, „19 texte”, „20 de texte”, „101 texte”, „120 de texte”.
 *  Din lotul L5a2 nu mai are apelanți pe ecran (AiBulkGenerate citește
 *  `imports.bulk_textsTranslated`); rămâne oracolul testelor LX8/IY5: formele
 *  dicționarelor trebuie să fie EXACT ale lui. */
export function roCount(n: number, one: string, many: string): string {
  if (n === 1) return `1 ${one}`
  const r = Math.abs(n) % 100
  const de = Math.abs(n) >= 20 && (r === 0 || r >= 20)
  return `${n} ${de ? 'de ' : ''}${many}`
}
