// Cromul comun urmează limba ECRANULUI și pe rutele personalului și ale
// funnel-ului (lotul L4d). Până acum doar paginile oaspetelui puneau
// `<html lang>`; pe un /auth în engleză confirmarea implicită spunea
// „Anulează”, iar cardurile PWA, numele accesibil al Spinner-ului și poarta de
// rol erau scrise direct în română. Fiecare test are controlul lui în română.
//   LD1  ConfirmDialog REAL (fără mock) sub `StaffDocumentLang` + UiLangScope
//        `en`: „Cancel”/„Confirm”, `<html lang>` = en, titlul tab-ului în
//        engleză; la demontare ambele se refac. Control: `ro` → „Anulează”.
//        Mutația care pică: `StaffDocumentLang` fără `useScreenDocument`.
//   LD2  funnel-ul (FunnelLangProvider, limba păstrată `en`): ConfirmDialog
//        REAL în engleză, `<html lang>` = en, titlul în engleză și refăcut la
//        ieșire; `scope="overlay"` (poarta de Termeni) NU atinge documentul.
//        Control: fără preferință → română. Mutația care pică:
//        `useScreenDocument(lang)` necondiționat (overlay-ul ar scrie limba).
//   LD3  pagina oaspetelui NU e suprascrisă: navigarea personal → oaspete și
//        oaspete → personal (ambele ordini) dă de fiecare dată limba ecranului
//        montat; o pagină de oaspete sub limba personalului `en`, fără
//        `StaffDocumentLang`, rămâne `de`; poarta (overlay `en`) montată lângă
//        pagina oaspetelui, în ambele ordini de montare, lasă `de`.
//   LD4  cardurile PWA în en/fr/de (și `it` → engleză cu `lang="en"` pe card),
//        fără resturi românești pe nodurile de text, cu control în română.
//        Mutația care pică: un text lăsat scris direct (ex. „Mai târziu”).
//   LD5  numele accesibil implicit al Spinner-ului (și cel din Button cu
//        `loading`) urmează pagina; o etichetă explicită câștigă. Control: ro.
//   LD6  poarta de rol (RoleGateScreen) în engleză, ambele ramuri; control ro
//        cu textele EXACTE de dinainte. Mutația care pică: limba citită din
//        `<html lang>` la prima randare (ar ieși în română).
//   LD7  `useOfflineOrderQueue` ține respingerea ca DATE (hint + cod), iar
//        `droppedReason` rămâne textul de dinainte (afișat în română).
//   LD8  spinner-ul RUTEI de funnel (`FunnelDocumentLang`, App.tsx): înainte
//        să se descarce chunk-ul paginii, `<html lang>`, titlul și PageSpinner
//        sunt deja în limba funnel-ului; pagina de dedesubt
//        (`FunnelLangProvider`) preia limba rutei și NU mai scrie documentul —
//        la demontarea ei limba rămâne a rutei. Control: fără preferință →
//        „Se încarcă…”. Mutația vizată: `FunnelLangProvider` scriind
//        documentul și sub rută (la demontarea paginii ar reface „fără lang”).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, screen, within } from '@testing-library/react'
import { useState } from 'react'

const h = vi.hoisted(() => ({
  canInstall: false,
  updateAvailable: false,
}))

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ profile: null, user: null }) }))
vi.mock('../../lib/pwa', () => ({
  usePWAInstall: () => ({ canInstall: h.canInstall, install: vi.fn(async () => true), dismiss: vi.fn() }),
  useSWUpdate: () => ({ updateAvailable: h.updateAvailable, applyUpdate: vi.fn() }),
}))
const q = vi.hoisted(() => ({ getPendingOrders: vi.fn(), syncPendingOrders: vi.fn() }))
vi.mock('../../lib/offlineSync', () => q)

import {
  FunnelDocumentLang,
  FunnelLangProvider,
  StaffDocumentLang,
  UiLangScope,
  useUiLang,
} from '../../i18n/UiLangContext'
import { CHROME_STRINGS, type ChromeLang } from '../../i18n/chrome'
import { useDocumentLang } from '../../hooks/useDocumentLang'
import { useOfflineOrderQueue } from '../../hooks/useOfflineOrderQueue'
import { ConfirmRoot } from '../ui/ConfirmDialog'
import { confirm } from '../ui/confirm'
import { Spinner } from '../ui/Spinner'
import { Button } from '../ui/Button'
import PWAPrompt from '../PWAPrompt'
import { RoleGateScreen } from '../RoleGateScreen'
import { PageSpinner } from '../PageLoader'
import type { StaffLang } from '../../i18n/langs'

const INDEX_TITLE = 'Menuvia — Meniu digital și comenzi QR pentru restaurante'

beforeEach(() => {
  document.title = INDEX_TITLE
  h.canInstall = false
  h.updateAvailable = false
  sessionStorage.clear()
  localStorage.clear()
})

afterEach(() => {
  document.documentElement.removeAttribute('lang')
  vi.useRealTimers()
})

function htmlLang(): string | null {
  return document.documentElement.getAttribute('lang')
}

function ask(): void {
  act(() => {
    void confirm({ title: 'Delete?' })
  })
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsWhole = (text: string, piece: string): boolean =>
  new RegExp(`(?<!\\p{L})${escapeRe(piece)}(?!\\p{L})`, 'u').test(text)
function nodeText(root: Node): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '')
  return parts.join('\n')
}
/** Textele românești ale cromului rămase pe nodurile de text (fără cele
 *  identice în limba țintă, ex. „Cookies”). */
function romanianLeftovers(text: string, target: ChromeLang): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(CHROME_STRINGS.ro)) {
    const own = CHROME_STRINGS[target][k as keyof typeof CHROME_STRINGS.ro]
    const p = v.trim()
    if (p.length >= 5 && !own.includes(p) && containsWhole(text, p)) out.push(`${k}: ${p}`)
  }
  return out
}

describe('LD1 rutele personalului', () => {
  function Staff({ lang }: { lang: StaffLang }) {
    return (
      <UiLangScope lang={lang} enabled={['ro', 'en', 'fr', 'de']}>
        <StaffDocumentLang>
          <div>panou</div>
        </StaffDocumentLang>
      </UiLangScope>
    )
  }

  it('LD1 Confirm REAL în engleză, `<html lang>` și titlul urmează personalul și se refac', async () => {
    const view = render(
      <>
        <Staff lang="en" />
        <ConfirmRoot />
      </>,
    )
    expect(htmlLang()).toBe('en')
    expect(document.title).toBe('Menuvia — Digital menu and QR ordering for restaurants')
    ask()
    const dlg = await screen.findByRole('dialog', { name: 'Delete?' })
    expect(within(dlg).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(dlg), 'en')).toEqual([])
    view.unmount()
    expect(htmlLang()).toBeNull()
    expect(document.title).toBe(INDEX_TITLE)
  })

  it('LD1 control: personalul în română → „Anulează”/„Confirmă”, titlul neschimbat', async () => {
    render(
      <>
        <Staff lang="ro" />
        <ConfirmRoot />
      </>,
    )
    expect(htmlLang()).toBe('ro')
    expect(document.title).toBe(INDEX_TITLE)
    ask()
    const dlg = await screen.findByRole('dialog', { name: 'Delete?' })
    expect(within(dlg).getByRole('button', { name: 'Anulează' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Confirmă' })).toBeInTheDocument()
    // Controlul POZITIV al verificării de resturi: pe ecranul românesc le vede.
    expect(romanianLeftovers(nodeText(dlg), 'en').length).toBeGreaterThan(0)
  })
})

describe('LD2 funnel-ul', () => {
  it('LD2 limba funnel-ului (en) ajunge pe document: Confirm REAL în engleză', async () => {
    localStorage.setItem('menuvia_ui_lang', 'en')
    const view = render(
      <>
        <FunnelLangProvider>
          <div>auth</div>
        </FunnelLangProvider>
        <ConfirmRoot />
      </>,
    )
    expect(htmlLang()).toBe('en')
    expect(document.title).toBe('Menuvia — Digital menu and QR ordering for restaurants')
    ask()
    const dlg = await screen.findByRole('dialog', { name: 'Delete?' })
    expect(within(dlg).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    view.unmount()
    expect(htmlLang()).toBeNull()
    expect(document.title).toBe(INDEX_TITLE)
  })

  it('LD2 `scope="overlay"` nu atinge documentul', () => {
    localStorage.setItem('menuvia_ui_lang', 'en')
    render(
      <FunnelLangProvider scope="overlay">
        <div>poarta</div>
      </FunnelLangProvider>,
    )
    expect(htmlLang()).toBeNull()
    expect(document.title).toBe(INDEX_TITLE)
  })

  it('LD2 control: fără preferință, funnel-ul e în română', async () => {
    render(
      <>
        <FunnelLangProvider>
          <div>auth</div>
        </FunnelLangProvider>
        <ConfirmRoot />
      </>,
    )
    expect(htmlLang()).toBe('ro')
    expect(document.title).toBe(INDEX_TITLE)
    ask()
    const dlg = await screen.findByRole('dialog', { name: 'Delete?' })
    expect(within(dlg).getByRole('button', { name: 'Anulează' })).toBeInTheDocument()
  })
})

describe('LD3 pagina oaspetelui nu e suprascrisă', () => {
  function GuestPage() {
    useDocumentLang('de')
    return <div>Speisekarte</div>
  }
  function Router({ initial }: { initial: 'staff' | 'guest' }) {
    const [view, setView] = useState(initial)
    return (
      <UiLangScope lang="en" enabled={['ro', 'en']}>
        <button onClick={() => setView(view === 'staff' ? 'guest' : 'staff')}>switch</button>
        {view === 'staff' ? (
          <StaffDocumentLang>
            <div>panou</div>
          </StaffDocumentLang>
        ) : (
          <GuestPage />
        )}
      </UiLangScope>
    )
  }

  it('LD3 personal → oaspete → personal', () => {
    const view = render(<Router initial="staff" />)
    expect(htmlLang()).toBe('en')
    act(() => screen.getByRole('button', { name: 'switch' }).click())
    expect(htmlLang()).toBe('de')
    act(() => screen.getByRole('button', { name: 'switch' }).click())
    expect(htmlLang()).toBe('en')
    view.unmount()
    expect(htmlLang()).toBeNull()
  })

  it('LD3 oaspete → personal → oaspete', () => {
    const view = render(<Router initial="guest" />)
    expect(htmlLang()).toBe('de')
    act(() => screen.getByRole('button', { name: 'switch' }).click())
    expect(htmlLang()).toBe('en')
    act(() => screen.getByRole('button', { name: 'switch' }).click())
    expect(htmlLang()).toBe('de')
    view.unmount()
    expect(htmlLang()).toBeNull()
  })

  it('LD3 sub limba personalului, fără StaffDocumentLang, oaspetele își păstrează limba', () => {
    render(
      <UiLangScope lang="en">
        <GuestPage />
      </UiLangScope>,
    )
    expect(htmlLang()).toBe('de')
  })

  it('LD3 poarta (overlay) lângă pagina oaspetelui, în ambele ordini de montare', () => {
    localStorage.setItem('menuvia_ui_lang', 'en')
    const gate = (
      <FunnelLangProvider scope="overlay">
        <div>poarta</div>
      </FunnelLangProvider>
    )
    const a = render(
      <>
        <GuestPage />
        {gate}
      </>,
    )
    expect(htmlLang()).toBe('de')
    a.unmount()
    expect(htmlLang()).toBeNull()
    render(
      <>
        {gate}
        <GuestPage />
      </>,
    )
    expect(htmlLang()).toBe('de')
  })
})

describe('LD4 cardurile PWA', () => {
  const cases: Array<{ page: string; chrome: ChromeLang; title: string; later: string; update: string }> = [
    { page: 'en', chrome: 'en', title: 'Update available', later: 'Later', update: 'Update' },
    { page: 'fr', chrome: 'fr', title: 'Mise à jour disponible', later: 'Plus tard', update: 'Mettre à jour' },
    { page: 'de', chrome: 'de', title: 'Update verfügbar', later: 'Später', update: 'Aktualisieren' },
  ]
  for (const c of cases) {
    it(`LD4 actualizarea în ${c.page}`, () => {
      document.documentElement.setAttribute('lang', c.page)
      h.updateAvailable = true
      render(<PWAPrompt />)
      const dlg = screen.getByRole('dialog')
      expect(dlg).toHaveTextContent(c.title)
      expect(within(dlg).getByRole('button', { name: c.later })).toBeInTheDocument()
      expect(within(dlg).getByRole('button', { name: c.update })).toBeInTheDocument()
      expect(dlg).not.toHaveAttribute('lang')
      expect(romanianLeftovers(nodeText(dlg), c.chrome)).toEqual([])
    })
  }

  it('LD4 instalarea în germană: textul și „×” cu nume accesibil', () => {
    vi.useFakeTimers()
    document.documentElement.setAttribute('lang', 'de')
    h.canInstall = true
    render(<PWAPrompt />)
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveTextContent('Menuvia installieren')
    expect(within(dlg).getByRole('button', { name: 'Schließen' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Installieren' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(dlg), 'de')).toEqual([])
  })

  it('LD4 o pagină fără tabel (it) → engleză, iar cardul își declară `lang="en"`', () => {
    document.documentElement.setAttribute('lang', 'it')
    h.updateAvailable = true
    render(<PWAPrompt />)
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveTextContent('Update available')
    expect(dlg).toHaveAttribute('lang', 'en')
  })

  it('LD4 control: fără limbă declarată, textele de dinainte (cu resturi văzute)', () => {
    h.updateAvailable = true
    render(<PWAPrompt />)
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveTextContent('Actualizare disponibilă')
    expect(dlg).toHaveTextContent(
      'O versiune nouă a aplicației e gata. Poți actualiza acum sau la următoarea deschidere.',
    )
    expect(within(dlg).getByRole('button', { name: 'Mai târziu' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Actualizează' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(dlg), 'en').length).toBeGreaterThan(0)
  })
})

describe('LD5 Spinner', () => {
  it('LD5 numele implicit urmează pagina; eticheta explicită câștigă', () => {
    document.documentElement.setAttribute('lang', 'fr')
    const { rerender } = render(<Spinner />)
    expect(screen.getByRole('status', { name: 'Chargement' })).toBeInTheDocument()
    rerender(<Spinner label="Envoi" />)
    expect(screen.getByRole('status', { name: 'Envoi' })).toBeInTheDocument()
  })

  it('LD5 în Button cu `loading`, pe o pagină `it` → „Loading” cu `lang="en"`', () => {
    document.documentElement.setAttribute('lang', 'it')
    const { container } = render(<Button loading>Invia</Button>)
    const status = container.querySelector('[role="status"]')
    expect(status).toHaveAttribute('aria-label', 'Loading')
    expect(status).toHaveAttribute('lang', 'en')
  })

  it('LD5 control: fără limbă declarată → „Se încarcă”, fără `lang`', () => {
    render(<Spinner />)
    const status = screen.getByRole('status', { name: 'Se încarcă' })
    expect(status).not.toHaveAttribute('lang')
  })
})

describe('LD6 poarta de rol', () => {
  function Gate({ lang, failed }: { lang: StaffLang; failed: boolean }) {
    return (
      <UiLangScope lang={lang} enabled={['ro', 'en']}>
        <StaffDocumentLang>
          <RoleGateScreen loadFailed={failed} onRetry={() => undefined} />
        </StaffDocumentLang>
      </UiLangScope>
    )
  }

  it('LD6 în engleză, ambele ramuri', async () => {
    const view = render(<Gate lang="en" failed={false} />)
    expect(
      screen.getByText('You don’t have access to this page. Contact the restaurant manager.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to your screen' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(view.container), 'en')).toEqual([])
    view.rerender(<Gate lang="en" failed />)
    expect(
      screen.getByText('We couldn’t load your permissions. Check your connection and try again.'),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(view.container), 'en')).toEqual([])
  })

  it('LD6 control: în română, textele exacte de dinainte', () => {
    const view = render(<Gate lang="ro" failed={false} />)
    expect(
      screen.getByText('Nu ai acces la această pagină. Contactează managerul restaurantului.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mergi la ecranul tău' })).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(view.container), 'en').length).toBeGreaterThan(0)
    view.rerender(<Gate lang="ro" failed />)
    expect(
      screen.getByText('Nu am putut încărca permisiunile. Verifică conexiunea și reîncearcă.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
  })
})

describe('LD7 comanda offline respinsă, ca DATE', () => {
  it('LD7 hint + cod păstrate, `droppedReason` neschimbat', async () => {
    q.getPendingOrders.mockResolvedValue([])
    const { result } = renderHook(() => useOfflineOrderQueue())
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('offline-order-dropped', {
          detail: { reason: 'Produsul s-a epuizat', hint: 'product_sold_out', code: 'P0001' },
        }),
      )
    })
    expect(result.current.droppedReason).toBe('Produsul s-a epuizat')
    expect(result.current.dropped).toEqual({
      reason: 'Produsul s-a epuizat',
      hint: 'product_sold_out',
      code: 'P0001',
    })
    act(() => result.current.dismissDropped())
    expect(result.current.dropped).toBeNull()
    expect(result.current.droppedReason).toBeNull()
  })

  it('LD7 emițător vechi (doar `reason`) sau fără detaliu', async () => {
    q.getPendingOrders.mockResolvedValue([])
    const { result } = renderHook(() => useOfflineOrderQueue())
    await act(async () => {
      window.dispatchEvent(new CustomEvent('offline-order-dropped'))
    })
    expect(result.current.droppedReason).toBe('eroare necunoscută')
    expect(result.current.dropped?.hint).toBeNull()
  })
})

describe('LD8 spinner-ul rutei de funnel', () => {
  const EN_TITLE = 'Menuvia — Digital menu and QR ordering for restaurants'

  it('LD8 înainte de pagină: documentul și spinner-ul în engleză; refăcute la ieșire', async () => {
    localStorage.setItem('menuvia_ui_lang', 'en')
    const view = render(
      <FunnelDocumentLang>
        <PageSpinner />
      </FunnelDocumentLang>,
    )
    expect(htmlLang()).toBe('en')
    expect(document.title).toBe(EN_TITLE)
    expect(await screen.findByText('Loading…')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(view.container), 'en')).toEqual([])
    view.unmount()
    expect(htmlLang()).toBeNull()
    expect(document.title).toBe(INDEX_TITLE)
  })

  it('LD8 pagina de sub rută preia limba rutei și nu scrie documentul', () => {
    localStorage.setItem('menuvia_ui_lang', 'en')
    function PageLang() {
      return <span>{useUiLang().lang}</span>
    }
    function Route({ page }: { page: boolean }) {
      return (
        <FunnelDocumentLang>
          {page ? (
            <FunnelLangProvider>
              <PageLang />
            </FunnelLangProvider>
          ) : (
            <PageSpinner />
          )}
        </FunnelDocumentLang>
      )
    }
    const view = render(<Route page={false} />)
    view.rerender(<Route page />)
    expect(screen.getByText('en')).toBeInTheDocument()
    expect(htmlLang()).toBe('en')
    // Pagina pleacă, ruta rămâne: limba e tot a rutei (un al doilea scriitor
    // și-ar fi refăcut valoarea de dinaintea lui, adică „fără lang”).
    view.rerender(<Route page={false} />)
    expect(htmlLang()).toBe('en')
    expect(document.title).toBe(EN_TITLE)
    view.unmount()
    expect(htmlLang()).toBeNull()
    expect(document.title).toBe(INDEX_TITLE)
  })

  it('LD8 control: fără preferință, spinner-ul rutei e în română', async () => {
    const view = render(
      <FunnelDocumentLang>
        <PageSpinner />
      </FunnelDocumentLang>,
    )
    expect(htmlLang()).toBe('ro')
    expect(document.title).toBe(INDEX_TITLE)
    expect(await screen.findByText('Se încarcă…')).toBeInTheDocument()
    expect(romanianLeftovers(nodeText(view.container), 'en').length).toBeGreaterThan(0)
  })
})
