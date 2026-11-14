// src/lib/importMessages.ts — textele calculate ale importurilor meniului
// (lotul L5a2): AiMenuImport, AiBulkGenerate, ProductsCsvImport. Erorile și
// problemele se țin ca DATE în starea componentelor și se traduc AICI, la
// randare (o schimbare de limbă cu eroarea pe ecran o retraduce).
//
// Regula refuzurilor, ca în L5a: în ROMÂNĂ exact `toUserMessage(err, fallback)`
// de dinainte (inclusiv mesajul românesc al serverului/asistentului afișat ca
// atare); în altă limbă codurile cunoscute au textul lor, restul cade pe clasa
// erorii din `common` sau pe textul de rezervă — un mesaj românesc NU ajunge
// pe un ecran englezesc.
import { interpolate, type StringKey, type Translator } from '../i18n/core'
import { describeStaffError } from '../i18n/staffErrors'
import type commonRo from '../i18n/ns/common/ro'
import importsRo from '../i18n/ns/imports/ro'
import type { ProductLimitState } from './aiImportDraft'
import { dropLastCsvColumn, type CsvRowError } from './productsCsv'
import { describeAiError } from './translationMessages'
import { toUserMessage } from './userMessages'

export type ImportsTranslator = Translator<typeof importsRo>
type ImportsText = Pick<ImportsTranslator, 't'>
type CommonTranslator = Translator<typeof commonRo>
type ImKey = StringKey<typeof importsRo>

function codeOf(err: unknown): string {
  if (err == null || typeof err !== 'object') return ''
  const c = (err as { code?: unknown }).code
  return typeof c === 'string' ? c : ''
}

// ── AiMenuImport ─────────────────────────────────────────────

/** Eroarea de citire a unui fișier (FileReader). Mesajul românesc e cel de
 *  dinainte (afișat prin `toUserMessage`); `code` o face recognoscibilă în
 *  celelalte limbi. Un cod necunoscut de `userErrorKind`, deci inofensiv. */
export function fileReadError(): Error {
  return Object.assign(new Error(importsRo.ai_errFileRead), { code: 'file_read' })
}

/** Refuzul extragerii (AI, citirea pozelor). În română exact
 *  `toUserMessage(err, 'Eroare la procesarea pozelor.')`; în altă limbă:
 *  fișier ilizibil, poze prea mari (413 — `payload_too_large`), codurile
 *  AiError prin `describeAiError`, altfel clasa erorii sau rezerva. */
export function describeMenuImportFailure(err: unknown, tr: ImportsTranslator, tc: CommonTranslator): string {
  if (tc.lang !== 'ro') {
    const code = codeOf(err)
    if (code === 'file_read') return tr.t('ai_errFileRead')
    if (code === 'payload_too_large') return tr.t('ai_tooLarge')
  }
  return describeAiError(err, tr, tc, tr.t('ai_errProcess'))
}

/** Bannerul de eroare al importului din poze, ca DATE. */
export type MenuImportError =
  | { kind: 'tooMany' }
  | { kind: 'unsupported' }
  | { kind: 'tooLarge' }
  | { kind: 'noneFound' }
  | { kind: 'process'; err: unknown }
  /** Plafonul planului respins de server; `message` = textul serverului
   *  (afișat doar în română, ca înainte). */
  | { kind: 'serverLimit'; message: string }

export function menuImportErrorText(
  e: MenuImportError,
  tr: ImportsTranslator,
  tc: CommonTranslator,
  maxPhotos: number,
): string {
  switch (e.kind) {
    case 'tooMany':
      return tr.t('ai_tooMany', { max: maxPhotos })
    case 'unsupported':
      return tr.t('ai_unsupported')
    case 'tooLarge':
      return tr.t('ai_tooLarge')
    case 'noneFound':
      return tr.t('ai_noneFound')
    case 'process':
      return describeMenuImportFailure(e.err, tr, tc)
    case 'serverLimit':
      return tr.t('ai_errServerLimit', { message: tr.lang === 'ro' ? e.message : tr.t('ai_limitReached') })
  }
}

/** O problemă de pe ecranul „done” al importului din poze, ca DATE. */
export type ImportIssue =
  | { kind: 'category'; name: string }
  | { kind: 'limit' }
  /** `name` = numele tăiat; gol → „produs fără nume”. */
  | { kind: 'product'; name: string }

export function importIssueText(i: ImportIssue, tr: ImportsText): string {
  switch (i.kind) {
    case 'category':
      return tr.t('ai_issueCategory', { name: i.name })
    case 'limit':
      return tr.t('ai_issueLimit')
    case 'product':
      return tr.t('ai_issueProduct', { name: i.name || tr.t('ai_unnamedProduct') })
  }
}

/** Mesajul unic al plafonului înainte de salvare (`productLimitState`). În
 *  română EXACT `describeProductLimit` (IY4). */
export function productLimitText(st: ProductLimitState, tr: ImportsTranslator): string {
  if (st.kind === 'full') return tr.t('ai_limitFull')
  return `${tr.tp('ai_limitAllowed', st.remaining, { selected: st.selected })} ${tr.tp('ai_limitUntick', st.excess)}`
}

// ── AiBulkGenerate ───────────────────────────────────────────

/** Felul rândurilor traduse de lot (tabela lor). */
export type BulkKind = 'categories' | 'products' | 'groups' | 'options' | 'extras'

const KIND_KEY = {
  categories: 'bulk_kind_categories',
  products: 'bulk_kind_products',
  groups: 'bulk_kind_groups',
  options: 'bulk_kind_options',
  extras: 'bulk_kind_extras',
} as const satisfies Record<BulkKind, ImKey>

const ROW_KEY = {
  categories: 'bulk_row_categories',
  products: 'bulk_row_products',
  groups: 'bulk_row_groups',
  options: 'bulk_row_options',
  extras: 'bulk_row_extras',
} as const satisfies Record<BulkKind, ImKey>

/** O eroare din lot, ca DATE (`err` = eroarea brută). */
export type BulkIssue =
  | { kind: 'trStopped'; err: unknown }
  | { kind: 'trBatch'; of: BulkKind; err: unknown }
  | { kind: 'trRow'; of: BulkKind; name: string; err: unknown }
  | { kind: 'nutritionStopped'; err: unknown }
  | { kind: 'nutritionRow'; name: string; err: unknown }
  | { kind: 'imagesStopped'; err: unknown }
  | { kind: 'imageRow'; name: string; err: unknown }

/** Ce face lotul acum (linia de sub bara de progres), ca DATE. */
export type BulkCurrent = { kind: 'translating'; of: BulkKind; n: number } | { kind: 'product'; name: string }

/** Motivul unui eșec din lot: în română exact `toUserMessage(e, 'eroare la
 *  generare')` de dinainte; în altă limbă codurile AiError (`describeAiError`)
 *  plus furnizorul fără imagini. */
function bulkReason(err: unknown, tr: ImportsTranslator, tc: CommonTranslator): string {
  // Furnizorul fără imagini (`provider_no_images`): mesajul serverului e în
  // română, deci în altă limbă textul lui din namespace.
  if (tc.lang !== 'ro' && codeOf(err) === 'provider_no_images') return tr.t('bulk_errNoImages')
  return describeAiError(err, tr, tc, tr.t('bulk_errGeneric'))
}

export function bulkIssueText(i: BulkIssue, tr: ImportsTranslator, tc: CommonTranslator): string {
  const reason = bulkReason(i.err, tr, tc)
  switch (i.kind) {
    case 'trStopped':
      return tr.t('bulk_errTrStopped', { reason })
    case 'trBatch':
      return tr.t('bulk_errTrBatch', { kind: tr.t(KIND_KEY[i.of]), reason })
    case 'trRow':
      return tr.t('bulk_errRow', { name: i.name, row: tr.t(ROW_KEY[i.of]), reason })
    case 'nutritionStopped':
      return tr.t('bulk_errNutritionStopped', { reason })
    case 'nutritionRow':
      return tr.t('bulk_errRow', { name: i.name, row: tr.t('bulk_row_nutrition'), reason })
    case 'imagesStopped':
      return tr.t('bulk_errImagesStopped', { reason })
    case 'imageRow':
      return tr.t('bulk_errRow', { name: i.name, row: tr.t('bulk_row_image'), reason })
  }
}

export function bulkCurrentText(c: BulkCurrent | null, tr: ImportsText): string {
  if (!c) return ''
  if (c.kind === 'product') return c.name
  return tr.t('bulk_translating', { kind: tr.t(KIND_KEY[c.of]), n: c.n })
}

// ── ProductsCsvImport ────────────────────────────────────────

const HEAD_KEYS = [
  'csv_head_name',
  'csv_head_category',
  'csv_head_price',
  'csv_head_emoji',
  'csv_head_description',
  'csv_head_vat',
] as const satisfies readonly ImKey[]

/** Rândul de antet în limba personalului („nume,categorie,pret,emoji,descriere,tva”). */
export function csvHeaderLine(tr: ImportsText): string {
  return HEAD_KEYS.map((k) => tr.t(k)).join(',')
}

/** Șablonul descărcabil. În română BYTE-identic cu cel de dinainte (IY6);
 *  fără TVA pe plan, ultima coloană se taie de pe fiecare rând. */
export function csvTemplate(tr: ImportsText, showVat: boolean): string {
  const full = `${csvHeaderLine(tr)}\n${tr.t('csv_templateRows')}\n`
  return showVat ? full : dropLastCsvColumn(full)
}

/** Exemplul din caseta „Format așteptat”. */
export function csvExample(tr: ImportsText, showVat: boolean): string {
  const full = `${csvHeaderLine(tr)}\n${tr.t('csv_exampleRows')}`
  return showVat ? full : dropLastCsvColumn(full)
}

/** Placeholder-ul zonei de lipire: antetul + „...”. */
export function csvPlaceholder(tr: ImportsText, showVat: boolean): string {
  const head = csvHeaderLine(tr)
  return `${showVat ? head : dropLastCsvColumn(head)}...`
}

export function csvRowErrorText(e: CsvRowError, tr: ImportsText): string {
  switch (e.code) {
    case 'missing_name':
      return tr.t('csv_rowMissingName')
    case 'missing_category':
      return tr.t('csv_rowMissingCategory')
    case 'missing_price':
      return tr.t('csv_rowMissingPrice')
    case 'bad_price':
      return tr.t('csv_rowBadPrice', { raw: e.raw })
    case 'negative_price':
      return tr.t('csv_rowNegativePrice')
    case 'bad_vat':
      return tr.t('csv_rowBadVat')
    case 'name_too_long':
      return tr.t('csv_rowNameTooLong')
  }
}

export type CsvFailureInfo =
  | { kind: 'baseline' }
  | { kind: 'verifyProducts' }
  | { kind: 'verifyCategories' }
  | { kind: 'category'; name: string; cause: { message: string } }
  | { kind: 'batch'; index: number; cause: { message: string } }

function romanianCsvFailure(info: CsvFailureInfo): string {
  switch (info.kind) {
    case 'baseline':
      return importsRo.csv_errBaseline
    case 'verifyProducts':
      return importsRo.csv_errVerifyProducts
    case 'verifyCategories':
      return importsRo.csv_errVerifyCategories
    case 'category':
      return interpolate(importsRo.csv_errCategory, { name: info.name, reason: info.cause.message })
    case 'batch':
      return interpolate(importsRo.csv_errBatch, { index: info.index, reason: info.cause.message })
  }
}

/**
 * Eșecul importului CSV, ca DATE (`info`). `message` e EXACT textul românesc
 * aruncat înainte (`Eroare la categoria "X": <server>` etc.), deci în română
 * `toUserMessage` dă ce dădea. Fără `code` propriu: `userErrorKind` îl citește.
 */
export class CsvImportFailure extends Error {
  readonly info: CsvFailureInfo
  constructor(info: CsvFailureInfo) {
    super(romanianCsvFailure(info))
    this.name = 'CsvImportFailure'
    this.info = info
  }
}

/** Mesajul unui import CSV eșuat. În română EXACT `toUserMessage(e, 'Eroare
 *  necunoscută la import')` de dinainte. */
export function describeCsvImportError(err: unknown, tr: ImportsTranslator, tc: CommonTranslator): string {
  const fallback = tr.t('csv_errUnknown')
  if (tc.lang === 'ro') return toUserMessage(err, fallback)
  if (err instanceof CsvImportFailure) {
    const info = err.info
    const reasonOf = (cause: unknown): string =>
      describeStaffError(cause, tc, {
        fallback,
        hints: { product_limit: tr.t('csv_hintProductLimit'), upgrade_plan: tr.t('csv_hintProductLimit') },
      })
    switch (info.kind) {
      case 'baseline':
        return tr.t('csv_errBaseline')
      case 'verifyProducts':
        return tr.t('csv_errVerifyProducts')
      case 'verifyCategories':
        return tr.t('csv_errVerifyCategories')
      case 'category':
        return tr.t('csv_errCategory', { name: info.name, reason: reasonOf(info.cause) })
      case 'batch':
        return tr.t('csv_errBatch', { index: info.index, reason: reasonOf(info.cause) })
    }
  }
  return describeStaffError(err, tc, { fallback })
}
