// Cromul comun urmează limba PAGINII (`<html lang>`, lotul L1). Fiecare test
// are controlul lui în română: fără `lang` (ca în panou), textele sunt exact
// cele de dinainte.
//   CL1  bannerul de cookies: în germană când pagina e în germană și se
//        re-randează când oaspetele schimbă limba (fr), fără remontare.
//        Mutația care pică: limba citită o singură dată la montare
//        (`useState(documentChromeLang)`) — bannerul rămâne în germană.
//   CL2  ecranul de eroare rămâne în limba paginii căzute, deși demontarea ei
//        reface `<html lang>` la gol, și după o re-randare a părintelui.
//        Mutația care pică: limba citită în `render()`, nu la eroare.
//   CL3  butoanele implicite din Confirm și eticheta de închidere a notificării.
//   CL4  fallback-ul de încărcare și „Reîncearcă” implicit.
//   CL5  (recenzia CodeRabbit pe #357) pe o pagină fără tabel (`it`), etichetele
//        căzute pe engleză își declară `lang="en"`, iar textul paginii (mesajul
//        notificării, titlul din Confirm) rămâne în limba paginii. Control: pe
//        o pagină `de` nimic nu-și declară limba (moștenește). Mutația care
//        pică: `lang` pus pe tot dialogul (titlul italian marcat engleză) sau
//        deloc.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import CookieBanner from '../CookieBanner'
import { ErrorBoundary, PageSpinner, QueryError } from '../PageLoader'
import { ConfirmRoot } from '../ui/ConfirmDialog'
import { confirm } from '../ui/confirm'
import { ToastProvider } from '../ui/Toast'
import { useToast } from '../ui/useToast'
import { useDocumentLang } from '../../hooks/useDocumentLang'

function setLang(lang: string | null) {
  act(() => {
    if (lang == null) document.documentElement.removeAttribute('lang')
    else document.documentElement.setAttribute('lang', lang)
  })
}

afterEach(() => {
  document.documentElement.removeAttribute('lang')
  localStorage.clear()
  vi.restoreAllMocks()
})

function openBanner() {
  act(() => {
    window.dispatchEvent(new Event('menuvia:open-cookie-settings'))
  })
}

describe('cromul comun — bannerul de cookies', () => {
  it('CL1 control: fără limbă declarată, bannerul e în română', () => {
    render(<CookieBanner />)
    openBanner()
    expect(screen.getByRole('button', { name: 'Acceptă toate' })).toBeInTheDocument()
    expect(screen.getByText('Strict necesare')).toBeInTheDocument()
  })

  it('CL1 urmează `<html lang>` și se schimbă odată cu el', async () => {
    setLang('de')
    render(<CookieBanner />)
    openBanner()
    expect(screen.getByRole('button', { name: 'Alle akzeptieren' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Details (auf Rumänisch)' })).toHaveAttribute('href', '/cookies')
    expect(screen.getByRole('dialog')).toHaveAttribute('lang', 'de')
    setLang('fr')
    expect(await screen.findByRole('button', { name: 'Tout accepter' })).toBeInTheDocument()
    // O limbă fără tabel (italiana) cade pe engleză, nu pe română.
    setLang('it')
    expect(await screen.findByRole('button', { name: 'Accept all' })).toBeInTheDocument()
  })
})

function GermanPage({ boom }: { boom: boolean }) {
  useDocumentLang('de')
  if (boom) throw new Error('Cannot read properties of undefined')
  return <div>meniu</div>
}

function Shell({ boom, tick }: { boom: boolean; tick: number }) {
  // `tick` schimbă părintele, deci granița se re-randează după eroare.
  return (
    <div data-tick={tick}>
      <ErrorBoundary>
        <GermanPage boom={boom} />
      </ErrorBoundary>
    </div>
  )
}

describe('cromul comun — ecranul de eroare', () => {
  it('CL2 rămâne în limba paginii căzute, și după o re-randare', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = render(<Shell boom={false} tick={0} />)
    expect(document.documentElement.getAttribute('lang')).toBe('de')
    view.rerender(<Shell boom tick={0} />)
    // Pagina s-a demontat și și-a refăcut limba (`<html>` fără `lang`)…
    expect(document.documentElement.getAttribute('lang')).toBeNull()
    // …dar ecranul de eroare e tot în germană.
    expect(screen.getByText('Etwas ist schiefgelaufen')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Seite neu laden' })).toBeInTheDocument()
    view.rerender(<Shell boom tick={1} />)
    expect(screen.getByText('Etwas ist schiefgelaufen')).toBeInTheDocument()
    expect(screen.getByText(/Ein unerwarteter Fehler/)).toBeInTheDocument()
  })

  it('CL2 control: în română, textele de dinainte', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    function Boom(): never {
      throw new Error('Cannot read properties of undefined')
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Ceva nu a mers bine')).toBeInTheDocument()
    expect(
      screen.getByText('A apărut o eroare neașteptată. Reîncarcă pagina; dacă se repetă, scrie-ne.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reîncarcă pagina' })).toBeInTheDocument()
  })
})

function ToastButton() {
  const toast = useToast()
  return (
    <button type="button" onClick={() => toast.info('salut', -1)}>
      arată
    </button>
  )
}

describe('cromul comun — Confirm și notificări', () => {
  it('CL3 butoanele implicite din Confirm urmează limba (control: ro)', async () => {
    render(<ConfirmRoot />)
    act(() => {
      void confirm({ title: 'Întrebare' })
    })
    let dialog = await screen.findByRole('dialog', { name: 'Întrebare' })
    expect(within(dialog).getByRole('button', { name: 'Anulează' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Confirmă' })).toBeInTheDocument()
    act(() => within(dialog).getByRole('button', { name: 'Anulează' }).click())

    setLang('de')
    act(() => {
      void confirm({ title: 'Frage' })
    })
    dialog = await screen.findByRole('dialog', { name: 'Frage' })
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Bestätigen' })).toBeInTheDocument()
  })

  it('CL3 eticheta de închidere a notificării urmează limba', () => {
    setLang('fr')
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    )
    act(() => screen.getByRole('button', { name: 'arată' }).click())
    expect(screen.getByRole('button', { name: 'Fermer la notification' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument()
  })
})

describe('cromul comun — încărcarea', () => {
  it('CL4 fallback-ul de încărcare și „Reîncearcă” implicit (control: ro)', () => {
    const view = render(
      <>
        <PageSpinner />
        <QueryError message="x" onRetry={() => undefined} />
      </>,
    )
    expect(screen.getByText('Se încarcă…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
    view.unmount()
    setLang('en')
    render(
      <>
        <PageSpinner />
        <QueryError message="x" onRetry={() => undefined} />
      </>,
    )
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('cromul comun — limba declarată pe etichetele căzute pe engleză', () => {
  it('CL5 pagină `it`: etichetele `en` își declară limba, textul paginii nu', async () => {
    setLang('it')
    render(
      <>
        <ConfirmRoot />
        <ToastProvider>
          <ToastButton />
        </ToastProvider>
      </>,
    )
    act(() => screen.getByRole('button', { name: 'arată' }).click())
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(region).toHaveAttribute('lang', 'en')
    expect(within(region).getByText('salut')).toHaveAttribute('lang', 'it')
    act(() => {
      void confirm({ title: 'Domanda' })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Domanda' })
    expect(dialog).not.toHaveAttribute('lang')
    expect(within(dialog).getByText('Cancel')).toHaveAttribute('lang', 'en')
    expect(within(dialog).getByText('Confirm')).toHaveAttribute('lang', 'en')
  })

  it('CL5 control: pagină `de`, nimic nu-și declară limba', () => {
    setLang('de')
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    )
    act(() => screen.getByRole('button', { name: 'arată' }).click())
    const region = screen.getByRole('region', { name: 'Benachrichtigungen' })
    expect(region).not.toHaveAttribute('lang')
    expect(within(region).getByText('salut')).not.toHaveAttribute('lang')
  })
})
