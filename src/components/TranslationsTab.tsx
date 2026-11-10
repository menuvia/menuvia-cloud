// Meniu → Traduceri (lotul O6c): pe fiecare limbă activă a meniului, ce texte
// văzute de oaspete nu sunt încă traduse (categorii, produse, grupuri de
// opțiuni, opțiuni, extra-uri) și ce a tradus AI-ul fără să fi verificat
// cineva — cu editare pe loc, traducere AI în lot și previzualizarea meniului
// public în limba aleasă.
//
// Raportul e pur (lib/menuTranslations.ts: vizibilitatea oglindește
// get_menu_for_restaurant, mig 321); citirile/scrierile opțiunilor și ale
// rândurilor sunt în lib/menuTranslationsData.ts. Produsele și categoriile vin
// din aceleași hook-uri ca tab-ul Produse. Partenerul vede ecranul
// (PARTNER_TAB_IDS): toate tabelele scrise sunt în politicile lui (mig 286).
// Fără h1: titlul paginii îl dă PageHeader din NAV_GROUPS.
// Textele din namespace-ul `translations` (lotul L5a): numele limbilor
// MENIULUI (ale oaspetelui) se afișează în limba PERSONALULUI prin
// `menuLangName`/`menuLangTitle` (lib/translationMessages; în română exact
// etichetele de dinainte din MENU_LANGS); erorile se țin ca DATE în stare și
// se traduc la randare (`describeTranslationError`).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useCategories, useProducts } from '../hooks/useData'
import { D } from '../lib/constants'
import {
  MENU_LANGS,
  activeTranslationLangs,
  applyManualEdit,
  markTranslationReviewed,
  type TranslatedField,
  type Translations,
} from '../lib/i18nMenu'
import {
  aiOptionRows,
  buildTranslationUnits,
  filterUnits,
  guestMenuLangs,
  isGuestVisibleProduct,
  langCoverage,
  menuPreviewPath,
  type TrFilterMode,
  type TrKind,
  type TrUnit,
} from '../lib/menuTranslations'
import {
  loadTranslationOptions,
  saveRowTranslations,
  type TranslationOptions,
} from '../lib/menuTranslationsData'
import { describeTranslationError, menuLangName, menuLangTitle } from '../lib/translationMessages'
import { useT } from '../i18n/useT'
import { commonNs } from '../i18n/ns/common'
import { translationsNs } from '../i18n/ns/translations'
import { QueryError } from './PageLoader'
import { Inp } from './_dashboard/sharedUI'
import { TranslationRow } from './_dashboard/TranslationRow'
import { Button } from './ui/Button'
import { EmptyState } from './ui/EmptyState'
import { Skeleton } from './ui/Skeleton'

const AiBulkGenerate = lazy(() => import('./AiBulkGenerate'))

// Limba aleasă ultima dată, per restaurant, cât trăiește pagina (fără storage).
const LAST_LANG = new Map<string, string>()
const PAGE = 60
// Plafonul de rânduri al PostgREST (`max_rows`, 1000 pe Supabase): useProducts
// și useCategories nu paginează, deci o listă care îl atinge e posibil tăiată.
const LIST_CAP = 1000

type Draft = Partial<Record<TranslatedField, string>>
type SectionId = 'categories' | 'products' | 'options' | 'extras'
interface OptState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: TranslationOptions | null
  /** Eroarea ca DATĂ (tradusă la randare); are sens doar pe `error`. */
  error: unknown
}
/** Refuzul unui rând, ca DATĂ: textul de rezervă depinde de acțiune. */
interface RowError {
  err: unknown
  action: 'save' | 'confirm'
}

const KIND_KEY = {
  category: 'kind_category',
  product: 'kind_product',
  group: 'kind_group',
  option: 'kind_option',
  extra: 'kind_extra',
} as const satisfies Record<TrKind, string>
const SECTION_KEY = {
  categories: 'sec_categories',
  products: 'sec_products',
  options: 'sec_options',
  extras: 'sec_extras',
} as const satisfies Record<SectionId, string>
const OPTION_KINDS: readonly TrKind[] = ['group', 'option', 'extra']
const MENU_KINDS: readonly TrKind[] = ['category', 'product']

const langMeta = (code: string) => MENU_LANGS.find((l) => l.code === code)
const draftKey = (unitKey: string, lang: string) => `${unitKey}|${lang}`

function without<T>(rec: Record<string, T>, key: string): Record<string, T> {
  if (!(key in rec)) return rec
  const next = { ...rec }
  delete next[key]
  return next
}

/** Overlay-ul local fără rândurile felurilor date (recitite de pe server). */
function dropKinds(o: Record<string, Translations>, kinds: readonly TrKind[]): Record<string, Translations> {
  const next: Record<string, Translations> = {}
  for (const [k, v] of Object.entries(o)) {
    if (!kinds.some((kind) => k.startsWith(`${kind}:`))) next[k] = v
  }
  return next
}

export default function TranslationsTab({
  restaurantId,
  slug,
  menuLanguages,
  baseLang,
  canTranslateAi,
  showOptions,
  isFlipbook,
  onOpenLanguageSettings,
}: {
  restaurantId: string
  slug?: string
  /** `restaurants.menu_languages`. */
  menuLanguages: readonly string[]
  /** Limba în care e scris meniul (`restaurants.language`). */
  baseLang: string
  /** Traducerea AI (`canUseAiMenu`: owner/manager sau partenerul cu acces). */
  canTranslateAi: boolean
  /** Opțiunile și extra-urile (planul cu comenzi); `null` = planul necunoscut. */
  showOptions: boolean | null
  isFlipbook: boolean
  /** Setări → Aspect meniu (doar adminul; partenerul n-are Setările). */
  onOpenLanguageSettings?: () => void
}) {
  // Traducătorii SUS, înaintea oricărui return timpuriu: rândurile
  // (TranslationRow) și insigna AI cer aceleași namespace-uri (clichetul LX10).
  const tr = useT(translationsNs)
  const { t, tp } = tr
  const tc = useT(commonNs)
  const {
    products,
    loading: pLoading,
    error: pError,
    refetch: refetchProducts,
  } = useProducts(restaurantId)
  const {
    categories,
    loading: cLoading,
    error: cError,
    refetch: refetchCats,
  } = useCategories(restaurantId)

  // Limbile de tradus: cele active, fără bază. Cheia text ține memo-urile
  // stabile (lista vine nouă la fiecare randare a panoului).
  const langsKey = activeTranslationLangs(menuLanguages, baseLang).join(',')
  const langs = useMemo(() => (langsKey ? langsKey.split(',') : []), [langsKey])
  const wantOptions = showOptions === true
  const productsReady = !pLoading && !pError
  const visibleIdsKey = useMemo(
    () =>
      products
        .filter(isGuestVisibleProduct)
        .map((p) => p.id)
        .join(','),
    [products],
  )

  // ── Opțiunile, grupurile, extra-urile (doar pe planul cu comenzi) ──
  const [opt, setOpt] = useState<OptState>({ status: 'idle', data: null, error: null })
  const [optReload, setOptReload] = useState(0)
  // Rândurile salvate în sesiune, peste datele citite (cheie = unitatea).
  const [overlay, setOverlay] = useState<Record<string, Translations>>({})
  useEffect(() => {
    if (!wantOptions || !productsReady) return
    let cancelled = false
    setOpt((o) => ({ ...o, status: 'loading', error: null }))
    loadTranslationOptions(restaurantId, visibleIdsKey ? visibleIdsKey.split(',') : [])
      .then((data) => {
        if (cancelled) return
        setOpt({ status: 'ready', data, error: null })
        // Datele proaspete le înlocuiesc pe cele salvate local.
        setOverlay((o) => dropKinds(o, OPTION_KINDS))
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setOpt({ status: 'error', data: null, error: e })
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId, wantOptions, productsReady, visibleIdsKey, optReload])

  const baseUnits = useMemo(
    () =>
      buildTranslationUnits({
        categories,
        products,
        ...(wantOptions && opt.data ? opt.data : {}),
      }),
    [categories, products, wantOptions, opt.data],
  )
  const units = useMemo(
    () =>
      baseUnits.map((u) => {
        const o = overlay[u.key]
        return o ? { ...u, translations: o } : u
      }),
    [baseUnits, overlay],
  )
  const coverage = useMemo(
    () => new Map(langs.map((l) => [l, langCoverage(units, l, baseLang)])),
    [langs, units, baseLang],
  )
  const totalMissing = langs.reduce((n, l) => n + (coverage.get(l)?.missing ?? 0), 0)
  const guestLangs = useMemo(() => guestMenuLangs(units, langs, baseLang), [units, langs, baseLang])

  // ── Limba aleasă ──
  const dataReady = !pLoading && !cLoading && !pError && !cError
  const [langPick, setLangPick] = useState<string | null>(() => LAST_LANG.get(restaurantId) ?? null)
  const defaultLang = langs.find((l) => (coverage.get(l)?.missing ?? 0) > 0) ?? langs[0] ?? null
  const lang = langPick != null && langs.includes(langPick) ? langPick : defaultLang
  // Implicitul se fixează o dată, când datele sunt citite: altfel, cu ultimul
  // gol completat, „prima limbă cu goluri” s-ar muta sub degetul omului.
  useEffect(() => {
    if (dataReady && lang != null && langPick !== lang) setLangPick(lang)
  }, [dataReady, lang, langPick])

  // ── Lista ──
  const [mode, setMode] = useState<TrFilterMode>('missing')
  const [query, setQuery] = useState('')
  const [limits, setLimits] = useState<Partial<Record<SectionId, number>>>({})
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, RowError>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  // Rândurile salvate (cheie `unitate|limbă`): rămân pe ecran, cu „✓ Salvat”,
  // până la schimbarea limbii sau a filtrului — lista nu sare sub deget.
  const [savedKeys, setSavedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [savingAll, setSavingAll] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  const keep = useMemo(() => {
    const out = new Set<string>()
    if (lang == null) return out
    for (const dk of savedKeys) {
      const i = dk.lastIndexOf('|')
      if (dk.slice(i + 1) === lang) out.add(dk.slice(0, i))
    }
    return out
  }, [savedKeys, lang])
  const shown = useMemo(
    () => (lang == null ? [] : filterUnits(units, lang, mode, query, { base: baseLang, keep })),
    [units, lang, mode, query, baseLang, keep],
  )
  const missingRows = useMemo(
    () => (lang == null ? 0 : filterUnits(units, lang, 'missing', '', { base: baseLang }).length),
    [units, lang, baseLang],
  )
  const reviewRows = useMemo(
    () => (lang == null ? 0 : filterUnits(units, lang, 'review', '', { base: baseLang }).length),
    [units, lang, baseLang],
  )

  // Ultimele valori pentru callback-urile stabile ale rândurilor, actualizate
  // după commit (nu în randare: o randare abandonată n-are voie să le schimbe).
  const unitsRef = useRef(units)
  const draftsRef = useRef(drafts)
  useEffect(() => {
    unitsRef.current = units
    draftsRef.current = drafts
  }, [units, drafts])

  const resetSession = () => {
    setSavedKeys(new Set())
    setLimits({})
  }
  const selectLang = (code: string) => {
    setLangPick(code)
    LAST_LANG.set(restaurantId, code)
    resetSession()
  }
  const selectMode = (m: TrFilterMode) => {
    setMode(m)
    resetSession()
  }

  const onChange = useCallback((unitKey: string, l: string, field: TranslatedField, value: string) => {
    const dk = draftKey(unitKey, l)
    setDrafts((d) => ({ ...d, [dk]: { ...d[dk], [field]: value } }))
    setRowErrors((r) => without(r, dk))
  }, [])

  const saveRow = useCallback(
    async (unitKey: string, l: string): Promise<boolean> => {
      const dk = draftKey(unitKey, l)
      const unit = unitsRef.current.find((u) => u.key === unitKey)
      const draft = draftsRef.current[dk]
      if (!unit || !draft || Object.keys(draft).length === 0) return true
      setBusy((b) => ({ ...b, [dk]: true }))
      setRowErrors((r) => without(r, dk))
      try {
        const written = await saveRowTranslations(unit.table, unit.id, (fresh) =>
          applyManualEdit(fresh, l, draft, baseLang),
        )
        setOverlay((o) => ({ ...o, [unitKey]: written }))
        // Ce s-a tastat în timpul salvării rămâne ciornă.
        setDrafts((d) => (d[dk] === draft ? without(d, dk) : d))
        setSavedKeys((s) => new Set(s).add(dk))
        return true
      } catch (e) {
        setRowErrors((r) => ({ ...r, [dk]: { err: e, action: 'save' } }))
        return false
      } finally {
        setBusy((b) => without(b, dk))
      }
    },
    [baseLang],
  )
  const onSave = useCallback(
    (unitKey: string, l: string) => {
      void saveRow(unitKey, l)
    },
    [saveRow],
  )
  const onConfirm = useCallback((unitKey: string, l: string) => {
    const dk = draftKey(unitKey, l)
    const unit = unitsRef.current.find((u) => u.key === unitKey)
    if (!unit) return
    setBusy((b) => ({ ...b, [dk]: true }))
    setRowErrors((r) => without(r, dk))
    void saveRowTranslations(unit.table, unit.id, (fresh) => markTranslationReviewed(fresh, l))
      .then((written) => {
        setOverlay((o) => ({ ...o, [unitKey]: written }))
        setSavedKeys((s) => new Set(s).add(dk))
      })
      .catch((e: unknown) => {
        setRowErrors((r) => ({ ...r, [dk]: { err: e, action: 'confirm' } }))
      })
      .finally(() => setBusy((b) => without(b, dk)))
  }, [])

  async function saveAll() {
    if (savingAll) return
    setSavingAll(true)
    try {
      // În ordinea în care au fost începute; prima eroare oprește restul (care rămân).
      for (const dk of Object.keys(draftsRef.current)) {
        const i = dk.lastIndexOf('|')
        const ok = await saveRow(dk.slice(0, i), dk.slice(i + 1))
        if (!ok) break
      }
    } finally {
      setSavingAll(false)
    }
  }

  // Lotul AI: aceleași rânduri vizibile, cu ce s-a salvat în sesiune (altfel
  // AI-ul ar completa peste un instantaneu în care traducerea nu există încă).
  const aiProducts = useMemo(
    () =>
      products.filter(isGuestVisibleProduct).map((p) => {
        const o = overlay[`product:${p.id}`]
        return o ? { ...p, translations: o } : p
      }),
    [products, overlay],
  )
  const aiCategories = useMemo(
    () =>
      categories.map((c) => {
        const o = overlay[`category:${c.id}`]
        return o ? { ...c, translations: o } : c
      }),
    [categories, overlay],
  )
  const optionRows = useMemo(() => aiOptionRows(units), [units])
  const onAiDone = useCallback(() => {
    setSavedKeys(new Set())
    setLimits({})
    setMode('review')
    void Promise.all([refetchProducts(), refetchCats()]).then(() =>
      setOverlay((o) => dropKinds(o, MENU_KINDS)),
    )
    setOptReload((n) => n + 1)
  }, [refetchProducts, refetchCats])

  const baseMeta = langMeta(baseLang)
  const baseLabel = menuLangName(baseLang, tr, baseLang)
  const baseName = `${baseMeta?.flag ?? ''} ${baseLabel}`.trim()

  // ── Stări de ecran ──
  if (langs.length === 0) {
    return (
      <EmptyState
        icon="menu"
        title={t('tab_onlyBase', { lang: baseLabel })}
        description={onOpenLanguageSettings ? t('tab_pickLangsAdmin') : t('tab_pickLangsOwner')}
        action={
          onOpenLanguageSettings ? (
            <Button variant="primary" onClick={onOpenLanguageSettings}>
              {t('tab_pickLangs')}
            </Button>
          ) : undefined
        }
      />
    )
  }
  if (pError || cError) {
    return (
      <QueryError
        message={describeTranslationError(pError || cError, tr, tc, t('tab_loadFailed'))}
        onRetry={() => {
          void refetchProducts()
          void refetchCats()
        }}
      />
    )
  }
  if (pLoading || cLoading || lang == null) return <Skeleton variant="card" count={3} />
  if (!units.some((u) => u.kind === 'product')) {
    return <EmptyState icon="menu" title={t('tab_noProducts')} />
  }

  const cov = coverage.get(lang) ?? { total: 0, done: 0, missing: 0, review: 0 }
  const pct = cov.total > 0 ? Math.round((cov.done / cov.total) * 100) : 100
  const visibleToGuests = guestLangs.includes(lang)
  const curLabel = menuLangName(lang, tr)
  // „Complet” se spune doar când ecranul chiar a văzut tot (recenzia O6c):
  // pe planul NECUNOSCUT opțiunile și extra-urile nu se citesc deloc, iar o
  // listă de produse/categorii plină până la plafonul PostgREST e posibil
  // tăiată (aceeași regulă ca perechile din fișa produsului, lotul O5a).
  const optionsComplete = showOptions === false || (showOptions === true && opt.status === 'ready')
  const listsTruncated = products.length >= LIST_CAP || categories.length >= LIST_CAP
  const complete = cov.missing === 0 && optionsComplete && !listsTruncated
  const draftCount = Object.keys(drafts).length

  const sections: { id: SectionId; rows: TrUnit[]; sub: boolean }[] = [
    { id: 'categories', rows: shown.filter((u) => u.kind === 'category'), sub: false },
    { id: 'products', rows: shown.filter((u) => u.kind === 'product'), sub: true },
    { id: 'options', rows: shown.filter((u) => u.kind === 'group' || u.kind === 'option'), sub: false },
    { id: 'extras', rows: shown.filter((u) => u.kind === 'extra'), sub: true },
  ]

  const previewButton = slug ? (
    <Button
      variant="secondary"
      disabled={!visibleToGuests}
      onClick={() => window.open(menuPreviewPath(slug, lang), '_blank', 'noopener')}
    >
      {t('tab_preview', { lang: curLabel })}
    </Button>
  ) : null

  const renderRow = (u: TrUnit) => {
    const dk = draftKey(u.key, lang)
    const rowErr = rowErrors[dk]
    return (
      <TranslationRow
        key={u.key}
        unitKey={u.key}
        lang={lang}
        langLabel={curLabel}
        kindLabel={t(KIND_KEY[u.kind])}
        context={u.kind === 'option' ? t('row_fromGroup', { group: u.contextLabel }) : undefined}
        source={u.source}
        fields={u.fields}
        stored={u.translations?.[lang]}
        draft={drafts[dk]}
        busy={busy[dk] === true || savingAll}
        error={
          rowErr
            ? describeTranslationError(
                rowErr.err,
                tr,
                tc,
                t(rowErr.action === 'save' ? 'tab_saveFailed' : 'tab_confirmFailed'),
              )
            : null
        }
        saved={savedKeys.has(dk)}
        onChange={onChange}
        onSave={onSave}
        onConfirm={onConfirm}
      />
    )
  }

  const renderSection = (s: (typeof sections)[number]) => {
    if (s.rows.length === 0) return null
    const limit = limits[s.id] ?? PAGE
    const visible = s.rows.slice(0, limit)
    const out: ReactNode[] = []
    let prev: string | null = null
    for (const u of visible) {
      if (s.sub && u.sectionKey !== prev) {
        out.push(
          <div
            key={`h-${u.sectionKey}`}
            style={{ fontSize: '0.78rem', fontWeight: 600, color: D.t2, marginTop: out.length > 0 ? 6 : 0 }}
          >
            {u.contextLabel}
          </div>,
        )
      }
      prev = u.sectionKey
      out.push(renderRow(u))
    }
    return (
      <section key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: D.t1, margin: '8px 0 0' }}>
          {t(SECTION_KEY[s.id])} <span style={{ color: D.t3, fontWeight: 400 }}>({s.rows.length})</span>
        </h2>
        {out}
        {s.rows.length > limit && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setLimits((m) => ({ ...m, [s.id]: limit + PAGE }))}>
              {t('tab_showMore', { n: Math.min(PAGE, s.rows.length - limit) })}
            </Button>
          </div>
        )}
      </section>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
        {t('tab_intro', { base: baseName })}
      </p>

      {/* Limbile */}
      <div role="group" aria-label={t('tab_langGroup')} style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {langs.map((l) => {
          const c = coverage.get(l) ?? { total: 0, done: 0, missing: 0, review: 0 }
          const meta = langMeta(l)
          const selected = l === lang
          return (
            <Button
              key={l}
              size="sm"
              variant={selected ? 'primary' : 'secondary'}
              aria-pressed={selected}
              onClick={() => selectLang(l)}
              style={{ flexShrink: 0 }}
            >
              {meta?.flag} {menuLangTitle(l, tr)} · {c.missing === 0 ? t('tab_complete') : tp('tab_missing', c.missing)}
              {c.review === 0 ? '' : ` · ${t('toReview', { n: c.review })}`}
            </Button>
          )
        })}
      </div>

      {/* Progresul și starea pentru oaspeți */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: '0.85rem', color: D.t1 }}>
          {tp('tab_progress', cov.total, { done: cov.done, pct })}
        </div>
        <div style={{ height: 6, background: D.s3, borderRadius: 3, overflow: 'hidden' }} aria-hidden="true">
          <div style={{ height: '100%', width: `${pct}%`, background: D.gold }} />
        </div>
        <div>
          <span
            style={{
              display: 'inline-block',
              fontSize: '0.78rem',
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: 999,
              color: visibleToGuests ? D.greenText : D.amber,
              background: visibleToGuests ? D.greenA : D.amberA,
            }}
          >
            {visibleToGuests ? t('tab_guestsSee', { lang: curLabel }) : t('tab_guestsDont')}
          </span>
        </div>
      </div>

      {/* Acțiunile */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canTranslateAi && totalMissing > 0 && (
            <Button
              variant="primary"
              disabled={wantOptions && opt.status === 'loading'}
              onClick={() => setAiOpen(true)}
            >
              {t('tab_aiMissing', { n: totalMissing })}
            </Button>
          )}
          {previewButton}
        </div>
        {slug && !visibleToGuests && (
          <div style={{ fontSize: '0.72rem', color: D.t3 }}>
            {t('tab_appearsAfter')}
          </div>
        )}
        {slug && isFlipbook && (
          <div style={{ fontSize: '0.72rem', color: D.t3 }}>
            {t('tab_flipbook')}
          </div>
        )}
      </div>

      {showOptions === null && (
        <div role="status" style={{ fontSize: '0.8rem', color: D.t2 }}>
          {t('tab_planUnknown')}
        </div>
      )}
      {listsTruncated && (
        <div role="status" style={{ fontSize: '0.8rem', color: D.t2 }}>
          {t('tab_truncated', { n: LIST_CAP })}
        </div>
      )}
      {complete && (
        <div
          role="status"
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            background: D.greenA,
            color: D.greenText,
            fontSize: '0.85rem',
            fontWeight: 600,
          }}
        >
          {t('tab_completeAll', { lang: curLabel })}
        </div>
      )}

      {/* Filtrele */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div role="group" aria-label={t('tab_filterGroup')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(
            [
              ['missing', t('tab_fMissing', { n: missingRows })],
              ['review', t('tab_fReview', { n: reviewRows })],
              ['all', t('tab_fAll')],
            ] as [TrFilterMode, string][]
          ).map(([m, label]) => (
            <Button
              key={m}
              size="sm"
              variant={mode === m ? 'primary' : 'ghost'}
              aria-pressed={mode === m}
              onClick={() => selectMode(m)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <Inp
            label={t('tab_searchLabel')}
            value={query}
            onChange={(v) => {
              setQuery(v)
              setLimits({})
            }}
            placeholder={t('tab_searchPlaceholder')}
          />
        </div>
      </div>

      {/* Rândurile */}
      {sections.slice(0, 2).map(renderSection)}
      {wantOptions && opt.status === 'loading' && (
        <div style={{ fontSize: '0.8rem', color: D.t3 }}>{t('tab_optLoading')}</div>
      )}
      {wantOptions && opt.status === 'error' && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            fontSize: '0.8rem',
            color: D.t2,
            padding: '10px 14px',
            borderRadius: 10,
            border: `1px solid ${D.border}`,
          }}
        >
          <span>
            {t('tab_optError', {
              error: describeTranslationError(opt.error, tr, tc, t('tab_optLoadFailed')),
            })}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setOptReload((n) => n + 1)}>
            {tc.t('retry')}
          </Button>
        </div>
      )}
      {wantOptions && opt.status === 'ready' && sections.slice(2).map(renderSection)}
      {shown.length === 0 && !complete && (
        <div style={{ fontSize: '0.85rem', color: D.t3 }}>
          {query.trim()
            ? t('tab_noMatch')
            : mode === 'review'
              ? t('tab_nothingReview', { lang: curLabel })
              : t('tab_nothing')}
        </div>
      )}
      {shown.length === 0 && complete && mode !== 'missing' && (
        <div style={{ fontSize: '0.85rem', color: D.t3 }}>
          {query.trim() ? t('tab_noMatch') : t('tab_nothingReview', { lang: curLabel })}
        </div>
      )}

      {draftCount > 0 && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: D.s1,
            borderTop: `1px solid ${D.border}`,
            padding: '12px 0',
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            zIndex: 10,
            boxShadow: `0 -6px 20px ${D.scrim}`,
          }}
        >
          <span style={{ color: D.t2, fontSize: '0.8rem', marginRight: 'auto' }}>
            {tp('tab_unsaved', draftCount)}
          </span>
          <Button variant="primary" loading={savingAll} onClick={() => void saveAll()}>
            {t('tab_saveAll')}
          </Button>
        </div>
      )}

      {aiOpen && (
        <Suspense fallback={null}>
          <AiBulkGenerate
            restaurantId={restaurantId}
            products={aiProducts}
            categories={aiCategories}
            menuLanguages={[...menuLanguages]}
            baseLang={baseLang}
            translateOnly
            title={t('tab_aiTitle')}
            optionRows={wantOptions && opt.status === 'ready' ? optionRows : undefined}
            onClose={() => setAiOpen(false)}
            onDone={onAiDone}
          />
        </Suspense>
      )}
    </div>
  )
}
