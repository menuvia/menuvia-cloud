// Fila Mese & QR în limba personalului (lotul L6a): TablesManager (lista,
// QR-ul general, generarea rapidă, modalul mesei, confirmările, PDF-ul) citește
// namespace-ul `tables` (+ „Anulează”/„Salvează”/„Șterge”/„Reîncearcă” din
// `common`). Testele de comportament (token-uri, roluri, toast-ul generării,
// ridicarea) rămân în TablesManager.*.test.tsx / TablesManagerPickup.test.tsx,
// NESCHIMBATE — aici e doar limba. Partea pură (pluralele, textele despre
// ridicare, slug-ul, precondiția structurală) e în
// src/lib/__tests__/tablesLang.test.ts (TQ8–TQ11), iar textul TIPĂRIT pe card
// în src/lib/__tests__/qrCardCopy.test.ts (QC).
// (Prefixul TQ: verificat cu grep în src/, tests/ și supabase/tests, nefolosit
// înainte.)
//   TQ0  control POZITIV al verificării „fără text românesc”: fila randată în
//        română, comparată cu dicționarul englez, ARE resturi. Fără el, TQ2–TQ4
//        ar trece și cu o verificare stricată.
//   TQ1  fără provider (azi, mereu româna): textele de dinainte — contorul
//        „1 active · 1 total”, „4 locuri”, „Duce la /m/la-bella — clienții văd
//        meniul. …” (textContent-ul nodului împărțit), numele accesibile.
//        Mutația care pică: `general_leadsTo` fără spațiul de după „—”.
//   TQ2  lista în engleză: contorul, pluralul locurilor, QR-ul general, numele
//        accesibile ale acțiunilor, fără resturi românești. Mutația care pică:
//        un literal românesc lăsat (ex. `aria-label="Copiază link"` readus).
//   TQ3  modalul în franceză: etichetele, „Annuler”/„Enregistrer” din `common`,
//        validarea numelui; schimbarea limbii cu eroarea pe ecran (ACEEAȘI
//        rădăcină `UiLangScope`) o retraduce în germană — eroarea e ținută ca
//        DATĂ (cheia). Mutația care pică: `setError(tm.t('modal_err_…'))`.
//   TQ4  confirmările în germană (regenerare, ștergere), cu butoanele din
//        `common`, fără resturi românești. Mutația care pică: „Regenerează”
//        readus pe butonul de confirmare.
//   TQ5  refuzul serverului la încărcare: în română EXACT textul românesc al
//        serverului (ca `toUserMessage`); în engleză rezerva tradusă, FĂRĂ
//        mesajul brut; pe aceeași rădăcină, trecut în germană, se retraduce.
//        Ștergerea refuzată de RLS în engleză → clasa erorii din `common`.
//        Mutația care pică: `setLoadError(toUserMessage(e, …))` (text compus
//        la încărcare).
//   TQ6  PDF-ul: `downloadQrPdf` primește limba de BAZĂ a meniului
//        (`restaurant.language`), NU limba personalului; toast-ul e în limba
//        personalului; refuzul „fără carduri” e tradus în engleză, iar în
//        română rămâne mesajul de dinainte. Mutația care pică: `menuLanguage`
//        scos din apel (sau `menuLanguage: lang` al personalului).
//   TQ7  generarea rapidă în engleză și germană inserează mesele cu numele
//        DATĂ `Masa N` / slug `masa-N` (numele apare pe cardul QR tipărit și în
//        meniul oaspetelui), nu „Table N” / „Tisch N”; butonul și toast-ul sunt
//        în limba personalului. Mutația care pică: numele trecut prin
//        traducător (`tm.t(…)`).
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Restaurant } from '../../hooks/useData'

const h = vi.hoisted(() => ({
  tokensError: null as { message: string } | null,
  deleteResult: { data: [] as unknown[] | null, error: null as { message: string } | null },
  tableInserts: [] as Array<Array<{ restaurant_id: string; name: string; slug: string }>>,
  download: vi.fn<(input: Record<string, unknown>) => Promise<string>>(() => Promise.resolve('qr.pdf')),
}))

vi.mock('../../hooks/useFeatures', () => ({
  useFeatures: () => ({ features: null, loading: false, has: () => false, limit: () => null }),
}))
vi.mock('qrcode', () => ({
  default: { toDataURL: () => Promise.resolve('data:image/png;base64,x') },
}))
vi.mock('../../lib/qrPdf', () => ({
  downloadQrPdf: h.download,
  QR_PDF_NO_CARDS_HINT: 'qr_pdf_no_cards',
}))
vi.mock('../../lib/supabase', () => {
  const tableRow = {
    id: 't1',
    restaurant_id: 'r1',
    name: 'Masa 1',
    slug: 'masa-1',
    seats: 4,
    zone: null,
    is_active: true,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  }
  const tokenRow = {
    id: 'tk1',
    restaurant_id: 'r1',
    table_id: 't1',
    token: 'abc123',
    is_active: true,
    expires_at: null,
    created_at: '2026-10-01T10:00:00Z',
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'tables')
          return {
            select: () => ({
              eq: () => {
                const res = { data: [tableRow], error: null }
                return {
                  order: () => Promise.resolve(res),
                  // Zonele existente din modal: select('zone').eq().not(…).
                  not: () => Promise.resolve({ data: [], error: null }),
                  then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
                    Promise.resolve(res).then(ok, ko),
                }
              },
            }),
            delete: () => ({ eq: () => ({ select: () => Promise.resolve(h.deleteResult) }) }),
            insert: (rows: Array<{ restaurant_id: string; name: string; slug: string }>) => {
              h.tableInserts.push(rows)
              return Promise.resolve({ error: null })
            },
          }
        if (table === 'qr_tokens')
          return {
            select: () => ({
              in: () => ({
                eq: () =>
                  Promise.resolve(h.tokensError ? { data: null, error: h.tokensError } : { data: [tokenRow], error: null }),
              }),
            }),
            insert: () => Promise.resolve({ error: null }),
          }
        throw new Error('tabelă neașteptată: ' + table)
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  }
})

import TablesManager from '../TablesManager'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { tablesNs } from '../../i18n/ns/tables'
import { commonNs } from '../../i18n/ns/common'
import tablesRo from '../../i18n/ns/tables/ro'
import tablesEn from '../../i18n/ns/tables/en'
import tablesFr from '../../i18n/ns/tables/fr'
import tablesDe from '../../i18n/ns/tables/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(langs.flatMap((l) => [preloadNamespace(tablesNs, l), preloadNamespace(commonNs, l)]))
})

const restaurant = (language: string | null = null): Restaurant =>
  ({
    id: 'r1',
    name: 'La Bella',
    slug: 'la-bella',
    primary_color: '#C8963C',
    pickup_settings: null,
    language,
  }) as unknown as Restaurant

beforeEach(() => {
  h.tokensError = null
  h.deleteResult = { data: [], error: null }
  h.tableInserts = []
  h.download.mockReset()
  h.download.mockImplementation(() => Promise.resolve('qr.pdf'))
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const tab = (language: string | null = null) => <TablesManager restaurant={restaurant(language)} canRotateQr />
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [tablesEn as Dict, commonEn as Dict],
  fr: [tablesFr as Dict, commonFr as Dict],
  de: [tablesDe as Dict, commonDe as Dict],
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
// Textul pe NODURI (capcana (b) din L5a2): `textContent` lipește textele
// elementelor vecine, iar granița de cuvânt n-ar mai găsi fragmentul.
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}
/** Plus numele accesibile (aria-label / title / placeholder / alt). */
function attrText(root: Element): string {
  const out: string[] = []
  for (const el of root.querySelectorAll('[aria-label],[title],[placeholder],[alt]'))
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a)
      if (v) out.push(v)
    }
  return out.join('\n')
}
const visible = (root: Element): string => `${nodeText(root)}\n${attrText(root)}`

/** Fragmentele românești ale lui `tables` + `common` rămase în text (fără cele
 *  identice în limba țintă), pe bucățile fixe de cel puțin 6 caractere. */
function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [tablesRo as Dict, commonRo as Dict]
  sources.forEach((src, i) => {
    const target = TARGETS[lang][i]!
    for (const [k, v] of Object.entries(src)) {
      const own = formsOf(target[k]).join('\n')
      for (const form of formsOf(v))
        for (const piece of form.split(/\{\w+\}/)) {
          const p = piece.trim()
          if (p.length >= 6 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
        }
    }
  })
  return out
}

describe('Mese & QR în limba personalului', () => {
  it('TQ0: control pozitiv — fila românească are resturi față de engleză', async () => {
    const { container } = inLang(null, tab())
    await screen.findByText('4 locuri')
    const left = romanianLeftovers(visible(container), 'en')
    expect(left.length).toBeGreaterThan(5)
    expect(left.some((l) => l.startsWith('addTable:'))).toBe(true)
    expect(left.some((l) => l.startsWith('copyLink:'))).toBe(true)
  })

  it('TQ1: fără provider, româna de dinainte', async () => {
    const { container } = inLang(null, tab())
    expect(await screen.findByText('4 locuri')).toBeInTheDocument()
    expect(screen.getByText('1 active · 1 total')).toBeInTheDocument()
    expect(screen.getByText('QR meniu general')).toBeInTheDocument()
    const lead = [...container.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Duce la '))
    expect(lead?.textContent).toBe(
      'Duce la /m/la-bella — clienții văd meniul. Bun pentru vitrină, flyere sau tejghea.',
    )
    expect(screen.getByRole('button', { name: 'Adaugă masă' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descarcă QR-uri' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerează QR' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Copiază link' }).length).toBe(2)
    expect(screen.getByRole('button', { name: 'Dezactivează masă' })).toBeInTheDocument()
    expect(screen.getByText('QR activ')).toBeInTheDocument()
    expect(screen.getByText('Generează QR-urile pentru mese')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Câte mese? ex. 80')).toBeInTheDocument()
  })

  it('TQ2: lista în engleză, fără resturi românești', async () => {
    const { container } = inLang('en', tab())
    expect(await screen.findByText('4 seats')).toBeInTheDocument()
    expect(screen.getByText('1 active · 1 in total')).toBeInTheDocument()
    expect(screen.getByText('General menu QR')).toBeInTheDocument()
    const lead = [...container.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Opens '))
    expect(lead?.textContent).toBe('Opens /m/la-bella — guests see the menu. Good for the shop window, flyers or the counter.')
    expect(screen.getByRole('button', { name: 'Add table' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate QR' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Copy link' }).length).toBe(2)
    expect(screen.getByRole('button', { name: 'Download QR (PNG)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deactivate table' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit table' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete table' })).toBeInTheDocument()
    expect(screen.getByLabelText('Number of tables')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'QR code for Masa 1' })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'General menu QR' })).toBeInTheDocument()
    // Meniul de formate PDF.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download QR codes' }))
    const menu = screen.getByRole('menu', { name: 'QR download formats' })
    expect(within(menu).getByText('Grid — 6 / page')).toBeInTheDocument()
    expect(within(menu).getByText('A4 poster')).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'en')).toEqual([])
    expect(nodeText(container)).not.toMatch(/[ăĂșȘțȚ]/)
  })

  it('TQ3: modalul în franceză; eroarea de validare se retraduce la schimbarea limbii', async () => {
    const user = userEvent.setup()
    const r = inLang('fr', tab())
    await user.click(await screen.findByRole('button', { name: 'Ajouter une table' }))
    const dialog = screen.getByRole('dialog', { name: 'Ajouter une table' })
    expect(within(dialog).getByText('Nom de la table *')).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText('Table 1, Terrasse A…')).toBeInTheDocument()
    expect(within(dialog).getByText('Zone (facultatif)')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    expect(within(dialog).getByText('Le nom est obligatoire.')).toBeInTheDocument()
    expect(romanianLeftovers(visible(dialog), 'fr')).toEqual([])

    r.rerender(tree('de', tab()))
    const de = screen.getByRole('dialog', { name: 'Tisch hinzufügen' })
    expect(within(de).getByText('Der Name ist erforderlich.')).toBeInTheDocument()
    expect(within(de).queryByText('Le nom est obligatoire.')).not.toBeInTheDocument()
    expect(within(de).getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
  })

  it('TQ4: confirmările în germană', async () => {
    const user = userEvent.setup()
    inLang('de', tab())
    await user.click(await screen.findByRole('button', { name: 'QR neu erstellen' }))
    const rot = screen.getByRole('dialog', { name: 'QR-Code für Masa 1 neu erstellen' })
    expect(within(rot).getByText('QR neu erstellen — Masa 1')).toBeInTheDocument()
    expect(within(rot).getByRole('button', { name: 'Neu erstellen' })).toBeInTheDocument()
    expect(romanianLeftovers(visible(rot), 'de')).toEqual([])
    await user.click(within(rot).getByRole('button', { name: 'Abbrechen' }))

    await user.click(screen.getByRole('button', { name: 'Tisch löschen' }))
    const del = screen.getByRole('dialog', { name: 'Tisch löschen' })
    expect(within(del).getByText(/Alle zugehörigen QR-Codes werden gelöscht/)).toBeInTheDocument()
    expect(within(del).getByRole('button', { name: 'Löschen' })).toBeInTheDocument()
    expect(romanianLeftovers(visible(del), 'de')).toEqual([])
  })

  it('TQ5: refuzul serverului — în română mesajul lui, în engleză/germană fără el', async () => {
    const SERVER = 'Accesul la token-uri a fost refuzat de politică.'
    h.tokensError = { message: SERVER }
    const ro = inLang(null, tab())
    expect(await screen.findByText(SERVER)).toBeInTheDocument()
    expect(screen.getByText('Nu s-au putut încărca mesele')).toBeInTheDocument()
    ro.unmount()

    const r = inLang('en', tab())
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getAllByText('We couldn’t load the tables').length).toBe(2)
    expect(screen.queryByText(SERVER)).not.toBeInTheDocument()

    r.rerender(tree('de', tab()))
    expect(await screen.findByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
    expect(screen.getAllByText('Wir konnten die Tische nicht laden').length).toBe(2)
    expect(screen.queryByText('We couldn’t load the tables')).not.toBeInTheDocument()
    expect(screen.queryByText(SERVER)).not.toBeInTheDocument()
  })

  it('TQ5b: ștergerea refuzată de RLS în engleză → clasa erorii, nu textul românesc', async () => {
    const user = userEvent.setup()
    inLang('en', tab())
    await user.click(await screen.findByRole('button', { name: 'Delete table' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete table' })).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(commonEn.err_permission)).toBeInTheDocument()
    expect(screen.queryByText(commonRo.err_permission)).not.toBeInTheDocument()
    expect(screen.queryByText('Table deleted')).not.toBeInTheDocument()
  })

  it('TQ6: PDF-ul primește limba MENIULUI; toast-ul și refuzul sunt ale personalului', async () => {
    const user = userEvent.setup()
    const pick = async (trigger: string, format: RegExp) => {
      await user.click(screen.getByRole('button', { name: trigger }))
      await user.click(screen.getByRole('menuitem', { name: format }))
    }
    // Personal german, meniu francez → cardul tipărit e în franceză.
    const de = inLang('de', tab('fr'))
    await screen.findByText('4 Plätze')
    await pick('QR-Codes herunterladen', /Raster/)
    expect(await screen.findByText('PDF heruntergeladen')).toBeInTheDocument()
    expect(h.download).toHaveBeenCalledTimes(1)
    expect(h.download.mock.calls[0]![0]).toMatchObject({ menuLanguage: 'fr', format: 'grid', canOrder: false })
    de.unmount()

    // Refuzul „fără carduri”: tradus în engleză, mesajul de dinainte în română.
    const noCards = () => Promise.reject(Object.assign(new Error('Niciun QR de tipărit'), { hint: 'qr_pdf_no_cards' }))
    h.download.mockImplementation(noCards)
    const en = inLang('en', tab())
    await screen.findByText('4 seats')
    await pick('Download QR codes', /A4 poster/)
    expect(await screen.findByText('No QR codes to print')).toBeInTheDocument()
    expect(screen.queryByText('Niciun QR de tipărit')).not.toBeInTheDocument()
    expect(h.download.mock.calls.at(-1)![0]).toMatchObject({ menuLanguage: null })
    en.unmount()

    inLang(null, tab('ro'))
    await screen.findByText('4 locuri')
    await pick('Descarcă QR-uri', /Grilă/)
    expect(await screen.findByText('Niciun QR de tipărit')).toBeInTheDocument()
    expect(h.download.mock.calls.at(-1)![0]).toMatchObject({ menuLanguage: 'ro' })
  })

  it('TQ7: generarea rapidă în engleză/germană scrie numele-DATĂ `Masa N`', async () => {
    const user = userEvent.setup()
    const en = inLang('en', tab())
    await screen.findByText('4 seats')
    await user.type(screen.getByLabelText('Number of tables'), '3')
    await user.click(screen.getByRole('button', { name: 'Generate QR codes' }))
    await vi.waitFor(() => expect(h.tableInserts).toHaveLength(1))
    // Masa 1 / masa-1 există deja → se creează exact 2 și 3.
    expect(h.tableInserts[0]).toEqual([
      { restaurant_id: 'r1', name: 'Masa 2', slug: 'masa-2' },
      { restaurant_id: 'r1', name: 'Masa 3', slug: 'masa-3' },
    ])
    en.unmount()

    inLang('de', tab())
    await screen.findByText('4 Plätze')
    await user.type(screen.getByLabelText(tablesDe.bulk_aria), '2')
    await user.click(screen.getByRole('button', { name: tablesDe.bulk_btn }))
    await vi.waitFor(() => expect(h.tableInserts).toHaveLength(2))
    expect(h.tableInserts[1]!.map((r) => r.name)).toEqual(['Masa 2'])
    expect(h.tableInserts[1]!.some((r) => /Tisch|Table/.test(r.name))).toBe(false)
  })
})
