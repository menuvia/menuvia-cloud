// Cardurile montate de fila Setări în limba personalului (lotul L6b):
// LoyaltySettingsCard, SmsNotificationsCard, MfaCard și GdprCard citesc
// namespace-ul `settingsCards` (+ „Reîncearcă”/„Anulează”/„Se încarcă…” din
// `common`). AddLocationCard e în LocationsLang.test.tsx (LN4–LN6). Testele de
// comportament (LoyaltySettingsCard.test LY1–LY4, SettingsTab*.test) rămân
// NESCHIMBATE — aici e doar limba. Partea pură (refuzurile fără hint,
// precondiția structurală, datele netraduse) e în
// src/lib/__tests__/settingsCardsLang.test.ts (GQ10–GQ12).
// (Prefixul GQ: verificat cu grep în src/, tests/ și supabase/tests, nefolosit
// înainte.)
//   GQ0  control POZITIV al verificării „fără text românesc”: cardurile randate
//        în română, comparate cu dicționarul englez, AU resturi. Fără el,
//        GQ2–GQ8 ar trece și cu o verificare stricată.
//   GQ1  fără provider (azi, mereu româna): textele de dinainte, inclusiv
//        textContent-ul nodurilor împărțite („Disponibil de la planul Meniu +
//        Comenzi — punctele …”, „Luna aceasta: 50 / 50 SMS — plafon atins; …”,
//        „… Detalii în Politica de confidențialitate.”). Mutația care pică:
//        `loy_locked` fără spațiul de după „—”.
//   GQ2  fidelizarea în engleză: etichetele, comutatorul, placeholderul
//        tradus, recompensa implicită RĂMÂNE „Un desert din partea casei” (dată a
//        meniului), validarea în engleză, fără resturi. Mutația care pică:
//        `toast('Pragul trebuie …')` readus.
//   GQ3  refuzurile serverului pe fidelizare: în română EXACT textul serverului;
//        în engleză rezerva tradusă (salvarea → `common.err_generic`, comutatorul
//        → „Couldn’t save”), FĂRĂ mesajul românesc; citirea eșuată în germană.
//        Mutația care pică: `toUserMessage(error)` readus în `save`.
//   GQ4  SMS-urile în germană: comutatorul, contorul cu plafonul atins, toast-ul
//        comutatorului, fără resturi. Mutația care pică: `{usage.used}` +
//        „ SMS” lăsat literal (contorul ar ieși „50 / 50 SMS” fără „Diesen
//        Monat:”).
//   GQ5  MFA în franceză: activarea (QR-ul, cheia manuală, codul), codul greșit;
//        pe ACEEAȘI rădăcină `UiLangScope`, trecut în germană, eroarea se
//        retraduce (e ținută ca DATĂ). Mutația care pică:
//        `setError('Cod incorect …')` readus.
//   GQ6  MFA — refuzurile serverului: citirea factorilor eșuată (română =
//        textul serverului, engleză = rezerva, germană după schimbarea limbii)
//        și refuzul aal2 al lui `set_my_mfa_enforced` cu text propriu în
//        engleză. Mutația care pică: `isMfaAal2Refusal` scos (ar cădea pe
//        „Turning MFA off didn’t go through”).
//   GQ7  GDPR în germană: titlul, linkul (tot spre /confidentialitate),
//        confirmarea cu `confirmLabel` ȘI `cancelLabel` EXPLICITE, refuzul
//        „abonament activ” cu text propriu; în română textul serverului. Data
//        programării în formatul limbii. Mutația care pică: `cancelLabel` scos
//        din `confirm(...)`.
//   GQ8  GDPR cu ștergerea deja programată, în engleză: butonul de anulare și
//        nota, fără resturi.
import { Suspense, type ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { useRestaurantModules } from '../../hooks/useRestaurantModules'
import type { ConfirmOptions } from '../ui/confirm'

interface Res {
  data: unknown
  error: { message: string; code?: string } | null
}

const h = vi.hoisted(() => ({
  loyalty: { data: null, error: null } as Res,
  upsert: { data: null, error: null } as Res,
  profile: { data: null, error: null } as Res,
  rpc: {} as Record<string, Res>,
  factors: { data: { totp: [] }, error: null } as Res,
  verify: { data: null, error: null } as Res,
  toast: { success: [] as string[], error: [] as string[] },
  confirm: [] as ConfirmOptions[],
  confirmAnswer: true,
}))

vi.mock('../../lib/supabase', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = () => b
    b.maybeSingle = () => Promise.resolve(table === 'profiles' ? h.profile : h.loyalty)
    b.upsert = () => Promise.resolve(h.upsert)
    return b
  }
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (fn: string) => Promise.resolve(h.rpc[fn] ?? { data: null, error: null }),
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null }),
        mfa: {
          listFactors: () => Promise.resolve(h.factors),
          unenroll: () => Promise.resolve({ data: null, error: null }),
          enroll: () =>
            Promise.resolve({
              data: {
                id: 'f-new',
                type: 'totp',
                totp: { qr_code: 'data:image/png;base64,x', secret: 'JBSWY3DP' },
              },
              error: null,
            }),
          challenge: () => Promise.resolve({ data: { id: 'ch1' }, error: null }),
          verify: () => Promise.resolve(h.verify),
        },
      },
    },
  }
})
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../ui/useToast', async (importOriginal) => {
  const api = {
    success: (m: string) => h.toast.success.push(m),
    error: (m: string) => h.toast.error.push(m),
    warning: () => {},
    info: () => {},
    dismiss: () => {},
  }
  return { ...((await importOriginal()) as Record<string, unknown>), useToast: () => api }
})
vi.mock('../ui/confirm', () => ({
  confirm: async (o: ConfirmOptions) => {
    h.confirm.push(o)
    return h.confirmAnswer
  },
}))

import LoyaltySettingsCard from '../LoyaltySettingsCard'
import SmsNotificationsCard from '../SmsNotificationsCard'
import MfaCard from '../MfaCard'
import GdprCard from '../GdprCard'
import { preloadNamespace, type Dict } from '../../i18n/core'
import { settingsCardsNs } from '../../i18n/ns/settingsCards'
import { commonNs } from '../../i18n/ns/common'
import cardsRo from '../../i18n/ns/settingsCards/ro'
import cardsEn from '../../i18n/ns/settingsCards/en'
import cardsFr from '../../i18n/ns/settingsCards/fr'
import cardsDe from '../../i18n/ns/settingsCards/de'
import commonRo from '../../i18n/ns/common/ro'
import commonEn from '../../i18n/ns/common/en'
import commonFr from '../../i18n/ns/common/fr'
import commonDe from '../../i18n/ns/common/de'
import { UiLangScope } from '../../i18n/UiLangContext'
import type { StaffLang } from '../../i18n/langs'

beforeAll(async () => {
  const langs: StaffLang[] = ['en', 'fr', 'de']
  await Promise.all(
    langs.flatMap((l) => [preloadNamespace(settingsCardsNs, l), preloadNamespace(commonNs, l)]),
  )
})

const setModule = vi.fn(async () => {})
const modulesState = (enabled: boolean) =>
  ({
    modules: {},
    loading: false,
    loadError: false,
    isEnabled: () => enabled,
    setModule,
    reload: vi.fn(async () => {}),
  }) as unknown as ReturnType<typeof useRestaurantModules>

const SAVED_LOYALTY: Res = { data: null, error: null }

beforeEach(() => {
  h.loyalty = SAVED_LOYALTY
  h.upsert = { data: null, error: null }
  h.profile = { data: { mfa_enforced: false, deletion_requested_at: null }, error: null }
  h.rpc = {}
  h.factors = { data: { totp: [] }, error: null }
  h.verify = { data: null, error: null }
  h.toast = { success: [], error: [] }
  h.confirm = []
  h.confirmAnswer = true
  setModule.mockReset()
  setModule.mockImplementation(async () => {})
})

function tree(lang: StaffLang | null, node: ReactNode) {
  const inner = <Suspense fallback={null}>{node}</Suspense>
  return lang ? <UiLangScope lang={lang}>{inner}</UiLangScope> : inner
}
const inLang = (lang: StaffLang | null, node: ReactNode) => render(tree(lang, node))
const loyalty = (plan = 'growth', toast = vi.fn()) => (
  <LoyaltySettingsCard
    restaurantId="r1"
    plan={plan}
    modulesState={modulesState(true)}
    toast={toast}
  />
)
const sms = (toast = vi.fn()) => (
  <SmsNotificationsCard
    restaurantId="r1"
    plan="growth"
    modulesState={modulesState(true)}
    toast={toast}
  />
)

const TARGETS: Record<'en' | 'fr' | 'de', readonly [Dict, Dict]> = {
  en: [cardsEn as Dict, commonEn as Dict],
  fr: [cardsFr as Dict, commonFr as Dict],
  de: [cardsDe as Dict, commonDe as Dict],
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
// Textul pe NODURI (capcana (b) din L5a2).
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}
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

function romanianLeftovers(text: string, lang: 'en' | 'fr' | 'de'): string[] {
  const formsOf = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : v && typeof v === 'object' ? (Object.values(v) as string[]) : []
  const out: string[] = []
  const sources: readonly [Dict, Dict] = [cardsRo as Dict, commonRo as Dict]
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

describe('cardurile Setărilor în limba personalului', () => {
  it('GQ0: control pozitiv — cardurile românești au resturi față de engleză', async () => {
    const { container } = inLang(
      null,
      <>
        {loyalty()}
        {sms()}
        <MfaCard />
        <GdprCard />
      </>,
    )
    await screen.findByRole('button', { name: 'Activează MFA' })
    const left = romanianLeftovers(visible(container), 'en')
    for (const k of ['loy_title:', 'sms_title:', 'mfa_title:', 'gdpr_title:'])
      expect(
        left.some((l) => l.startsWith(k)),
        k,
      ).toBe(true)
  })

  it('GQ1: fără provider, româna de dinainte', async () => {
    h.rpc.get_sms_usage = {
      data: { used: 50, cap: 50, module_enabled: true, plan_enabled: true },
      error: null,
    }
    const { container } = inLang(
      null,
      <>
        {loyalty('free')}
        {sms()}
        <MfaCard />
        <GdprCard />
      </>,
    )
    expect(await screen.findByRole('button', { name: 'Activează MFA' })).toBeInTheDocument()
    const locked = [...container.querySelectorAll('div')].find((d) =>
      d.textContent?.startsWith('Disponibil de la planul'),
    )
    expect(locked?.textContent).toBe(
      'Disponibil de la planul Meniu + Comenzi — punctele se acordă pe comenzile din QR.',
    )
    const usage = await screen.findByText(
      (_, el) => el?.tagName === 'SPAN' && /^Luna aceasta:/.test(el.textContent ?? ''),
    )
    expect(usage.textContent).toBe('Luna aceasta: 50 / 50 SMS — plafon atins; reia luna viitoare')
    expect(screen.getByRole('switch', { name: 'SMS-uri către clienți' })).toBeInTheDocument()
    expect(screen.getByText('Autentificare în doi pași (MFA)')).toBeInTheDocument()
    expect(screen.getByText('Inactiv')).toBeInTheDocument()
    const gdpr = [...container.querySelectorAll('p')].find((p) =>
      p.textContent?.startsWith('Poți descărca'),
    )
    expect(gdpr?.textContent).toBe(
      'Poți descărca o copie a datelor contului tău sau poți cere ștergerea contului. Detalii în Politica de confidențialitate.',
    )
    expect(screen.getByRole('link', { name: 'Politica de confidențialitate' })).toHaveAttribute(
      'href',
      '/confidentialitate',
    )
    expect(screen.getByRole('button', { name: '⬇ Exportă datele mele (JSON)' })).toBeInTheDocument()
  })

  it('GQ2: fidelizarea în engleză; recompensa implicită rămâne dată', async () => {
    const toast = vi.fn()
    const user = userEvent.setup()
    const { container } = inLang('en', loyalty('growth', toast))
    const save = await screen.findByRole('button', { name: 'Save programme' })
    await waitFor(() => expect(save).toBeEnabled())
    expect(screen.getByText('Loyalty — points and rewards')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Loyalty in the QR menu' })).toBeInTheDocument()
    expect(screen.getByLabelText('Points per leu spent')).toHaveValue('1')
    const reward = screen.getByLabelText('Reward (what the guest gets at the threshold)')
    expect(reward).toHaveValue('Un desert din partea casei')
    expect(reward).toHaveAttribute('placeholder', 'E.g. A dessert on the house')
    expect(romanianLeftovers(visible(container), 'en')).toEqual([])
    const threshold = screen.getByLabelText('Reward threshold (points)')
    await user.clear(threshold)
    await user.type(threshold, '0')
    await user.click(save)
    expect(toast).toHaveBeenCalledWith(
      'The threshold must be between 1 and 100,000 points.',
      'error',
    )
  })

  it('GQ3: refuzurile serverului pe fidelizare', async () => {
    const SERVER = 'Programul nu poate fi salvat: pragul încalcă regula restaurantului.'
    h.upsert = { data: null, error: { message: SERVER, code: 'P0001' } }
    setModule.mockImplementation(async () => {
      throw new Error('Modulul nu poate fi schimbat acum.')
    })
    const user = userEvent.setup()
    const roToast = vi.fn()
    const ro = inLang(null, loyalty('growth', roToast))
    const roSave = await screen.findByRole('button', { name: 'Salvează programul' })
    await waitFor(() => expect(roSave).toBeEnabled())
    await user.click(roSave)
    await waitFor(() => expect(roToast).toHaveBeenCalledWith(SERVER, 'error'))
    ro.unmount()

    const enToast = vi.fn()
    const en = inLang('en', loyalty('growth', enToast))
    const enSave = await screen.findByRole('button', { name: 'Save programme' })
    await waitFor(() => expect(enSave).toBeEnabled())
    await user.click(enSave)
    await waitFor(() => expect(enToast).toHaveBeenCalledWith(commonEn.err_generic, 'error'))
    await user.click(screen.getByRole('switch', { name: 'Loyalty in the QR menu' }))
    await waitFor(() => expect(enToast).toHaveBeenCalledWith('Couldn’t save', 'error'))
    for (const [msg] of enToast.mock.calls) expect(String(msg)).not.toMatch(/[ăĂșȘțȚ]/)
    en.unmount()

    h.loyalty = { data: null, error: { message: 'Failed to fetch' } }
    const { container } = inLang('de', loyalty())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Wir konnten das gespeicherte Treueprogramm nicht lesen.',
    )
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Programm speichern' })).toBeDisabled()
    expect(romanianLeftovers(visible(container), 'de')).toEqual([])
  })

  it('GQ4: SMS-urile în germană', async () => {
    h.rpc.get_sms_usage = {
      data: { used: 50, cap: 50, module_enabled: true, plan_enabled: true },
      error: null,
    }
    const toast = vi.fn()
    const { container } = inLang('de', sms(toast))
    const usage = await screen.findByText(
      (_, el) => el?.tagName === 'SPAN' && /^Diesen Monat:/.test(el.textContent ?? ''),
    )
    expect(usage.textContent).toBe(
      'Diesen Monat: 50 / 50 SMS — Limit erreicht; geht nächsten Monat weiter',
    )
    expect(screen.getByText('SMS-Benachrichtigungen an Gäste')).toBeInTheDocument()
    expect(screen.getByText('SMS aktivieren')).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'de')).toEqual([])
    await userEvent.setup().click(screen.getByRole('switch', { name: 'SMS an Gäste' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('SMS wurden deaktiviert'))
  })

  it('GQ5: MFA în franceză; codul greșit se retraduce în germană', async () => {
    h.verify = { data: null, error: { message: 'Invalid TOTP code entered' } }
    const user = userEvent.setup()
    const r = inLang('fr', <MfaCard />)
    expect(await screen.findByText('Désactivée')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activer la MFA' }))
    expect(
      await screen.findByRole('img', { name: 'Code QR pour l’application d’authentification' }),
    ).toBeInTheDocument()
    const manual = screen.getByText(
      (_, el) => el?.tagName === 'DIV' && /^Impossible de scanner/.test(el.textContent ?? ''),
    )
    expect(manual.textContent).toBe(
      'Impossible de scanner ? Saisissez la clé manuellement : JBSWY3DP',
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Code de vérification de l’application' }),
      '123456',
    )
    await user.click(screen.getByRole('button', { name: 'Confirmer et activer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Code incorrect ou expiré. Réessayez avec le code actuel de l’application.',
    )
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument()
    expect(romanianLeftovers(visible(r.container), 'fr')).toEqual([])

    r.rerender(tree('de', <MfaCard />))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Falscher oder abgelaufener Code. Versuchen Sie es mit dem aktuellen Code aus der App erneut.',
    )
    expect(screen.getByRole('button', { name: 'Bestätigen und aktivieren' })).toBeInTheDocument()
  })

  it('GQ6: MFA — refuzurile serverului', async () => {
    const SERVER = 'Factorii de autentificare nu pot fi citiți acum.'
    h.factors = { data: null, error: { message: SERVER } }
    const ro = inLang(null, <MfaCard />)
    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER)
    ro.unmount()
    const r = inLang('en', <MfaCard />)
    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load the MFA status')
    expect(screen.queryByText(SERVER)).not.toBeInTheDocument()
    r.rerender(tree('de', <MfaCard />))
    expect(screen.getByRole('alert')).toHaveTextContent('Wir konnten den MFA-Status nicht laden')
    r.unmount()

    // Factor verificat + enforcement pornit → dezactivarea, refuzată pe aal2.
    h.factors = { data: { totp: [{ id: 'f1', status: 'verified' }] }, error: null }
    h.profile = { data: { mfa_enforced: true }, error: null }
    h.rpc.set_my_mfa_enforced = {
      data: null,
      error: { message: 'Dezactivarea MFA cere o sesiune verificată cu MFA (aal2)', code: 'P0001' },
    }
    const user = userEvent.setup()
    inLang('en', <MfaCard />)
    expect(await screen.findByText('On')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Turn off MFA…' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Verification code from the app' }),
      '123456',
    )
    await user.click(screen.getByRole('button', { name: 'Turn off MFA' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Turning off MFA requires a session verified with MFA (aal2)',
    )
  })

  it('GQ7: GDPR în germană — confirmarea, refuzul „abonament activ”, data', async () => {
    const SERVER =
      'Aveți un abonament activ. Anulați-l prin Portal Stripe înainte de a șterge contul.'
    h.rpc.request_account_deletion = { data: null, error: { message: SERVER } }
    const user = userEvent.setup()
    const { container, unmount } = inLang('de', <GdprCard />)
    expect(screen.getByText('Meine Daten (DSGVO)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Datenschutzerklärung' })).toHaveAttribute(
      'href',
      '/confidentialitate',
    )
    const del = screen.getByRole('button', { name: 'Konto löschen' })
    await waitFor(() => expect(del).toBeEnabled())
    expect(romanianLeftovers(visible(container), 'de')).toEqual([])
    await user.click(del)
    await waitFor(() => expect(h.toast.error).toHaveLength(1))
    expect(h.confirm[0]).toEqual({
      title: 'Konto löschen?',
      description: cardsDe.gdpr_confirmDesc,
      confirmLabel: 'Löschung planen',
      cancelLabel: 'Abbrechen',
      destructive: true,
    })
    expect(h.toast.error[0]).toBe(
      'Sie haben ein aktives Abonnement. Kündigen Sie es im Stripe-Portal, bevor Sie das Konto löschen.',
    )
    unmount()

    // În română: textul serverului, ca înainte; confirmarea cu „Anulează”.
    h.toast = { success: [], error: [] }
    h.confirm = []
    inLang(null, <GdprCard />)
    const roDel = screen.getByRole('button', { name: 'Șterge contul' })
    await waitFor(() => expect(roDel).toBeEnabled())
    await user.click(roDel)
    await waitFor(() => expect(h.toast.error).toEqual([SERVER]))
    expect(h.confirm[0]?.cancelLabel).toBe('Anulează')
    expect(h.confirm[0]?.title).toBe('Ștergi contul?')
  })

  it('GQ7b: data programării în formatul limbii', async () => {
    h.rpc.request_account_deletion = {
      data: { deletion_scheduled_at: '2026-12-15T10:00:00Z' },
      error: null,
    }
    const user = userEvent.setup()
    const de = inLang('de', <GdprCard />)
    const del = screen.getByRole('button', { name: 'Konto löschen' })
    await waitFor(() => expect(del).toBeEnabled())
    await user.click(del)
    await waitFor(() =>
      expect(h.toast.success).toEqual(['Die Löschung ist für den 15.12.2026 geplant.']),
    )
    de.unmount()
    h.toast = { success: [], error: [] }
    inLang(null, <GdprCard />)
    const roDel = screen.getByRole('button', { name: 'Șterge contul' })
    await waitFor(() => expect(roDel).toBeEnabled())
    await user.click(roDel)
    await waitFor(() =>
      expect(h.toast.success).toEqual(['Ștergerea e programată pentru 15.12.2026.']),
    )
  })

  it('GQ8: GDPR cu ștergerea programată, în engleză', async () => {
    h.profile = { data: { deletion_requested_at: '2026-11-10T10:00:00Z' }, error: null }
    const { container } = inLang('en', <GdprCard />)
    expect(
      await screen.findByRole('button', { name: '↩ Cancel the scheduled deletion' }),
    ).toBeInTheDocument()
    const note = within(container).getByText(/^⚠️ The account deletion is scheduled/)
    expect(note).toBeInTheDocument()
    expect(romanianLeftovers(visible(container), 'en')).toEqual([])
    expect(nodeText(container)).not.toMatch(/[ăĂșȘțȚ]/)
  })
})
