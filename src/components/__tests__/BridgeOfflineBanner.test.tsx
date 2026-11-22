// Teste pe banner-ul „Fiscalizare activă, casa nu e conectată" (audit v3,
// rangul 8). Regula pe care o păzesc: banner-ul NU are voie să apară pe o
// stare NECUNOSCUTĂ. Un fals pozitiv de alarmă fiscală, afișat la fiecare blip
// de rețea sau înainte de aplicarea migrației, antrenează staff-ul să ignore
// exact ecranul care trebuie citit.
//
// Limba (precondiția B8 a activării limbilor): bannerul e o alertă
// OPERAȚIONALĂ pe ecranul ospătarului, deci urmează limba personalului
// (namespace `common`); fila Casă de marcat spre care trimite rămâne în
// română. Testele de mai sus rulează fără provider, adică în română — textul
// de dinainte, neschimbat. Mutația care pică (ultimul test): titlul românesc
// scris direct în componentă.
import { Suspense } from 'react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BridgeOfflineBanner } from '../BridgeOfflineBanner'
import { UiLangScope } from '../../i18n/UiLangContext'
import { preloadNamespace } from '../../i18n/core'
import { commonNs } from '../../i18n/ns/common'

beforeAll(async () => {
  await Promise.all((['en', 'fr', 'de'] as const).map((l) => preloadNamespace(commonNs, l)))
})

describe('BridgeOfflineBanner', () => {
  it('stare NECUNOSCUTĂ (null) — nu randează nimic', () => {
    const { container } = render(<BridgeOfflineBanner status={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('bridge conectat — nu randează nimic', () => {
    const { container } = render(
      <BridgeOfflineBanner
        status={{ registered: true, connected: true, last_seen_at: '2026-09-05T10:00:00Z' }}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('dispozitiv înregistrat dar căzut — alertă „casa nu e conectată"', () => {
    render(
      <BridgeOfflineBanner
        status={{ registered: true, connected: false, last_seen_at: '2026-09-05T09:00:00Z' }}
      />,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/casa nu e conectată/i)).toBeInTheDocument()
    expect(screen.getByText(/nu se emite niciun bon fiscal/i)).toBeInTheDocument()
  })

  it('niciun dispozitiv înregistrat — alt mesaj, aceeași alertă', () => {
    render(
      <BridgeOfflineBanner status={{ registered: false, connected: false, last_seen_at: null }} />,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/nicio casă înregistrată/i)).toBeInTheDocument()
  })

  it('varianta compactă ascunde detaliul, dar păstrează titlul și rolul de alertă', () => {
    render(
      <BridgeOfflineBanner
        compact
        status={{ registered: true, connected: false, last_seen_at: null }}
      />,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/casa nu e conectată/i)).toBeInTheDocument()
    expect(screen.queryByText(/nu se emite niciun bon fiscal/i)).not.toBeInTheDocument()
  })

  it('butonul apare doar când există o cale spre Casa de marcat', async () => {
    const onOpenBridge = vi.fn()
    const { rerender } = render(
      <BridgeOfflineBanner status={{ registered: true, connected: false, last_seen_at: null }} />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(
      <BridgeOfflineBanner
        status={{ registered: true, connected: false, last_seen_at: null }}
        onOpenBridge={onOpenBridge}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /casa de marcat/i }))
    expect(onOpenBridge).toHaveBeenCalledTimes(1)
  })

  it('în limba personalului: titlu, detaliu și buton traduse, fără resturi românești', async () => {
    const CASES = {
      en: { title: /cash register not connected/i, button: /Cash register & tickets/ },
      fr: { title: /caisse non connectée/i, button: /Caisse & tickets/ },
      de: { title: /Kasse nicht verbunden/i, button: /Kasse & Küchenbons/ },
    } as const
    for (const [lang, c] of Object.entries(CASES) as [keyof typeof CASES, (typeof CASES)[keyof typeof CASES]][]) {
      const view = render(
        <UiLangScope lang={lang} enabled={['ro', 'en', 'fr', 'de']}>
          <Suspense fallback={null}>
            <BridgeOfflineBanner
              status={{ registered: true, connected: false, last_seen_at: null }}
              onOpenBridge={() => undefined}
            />
          </Suspense>
        </UiLangScope>,
      )
      const alert = await screen.findByRole('alert')
      expect(alert.textContent ?? '', lang).toMatch(c.title)
      expect(screen.getByRole('button', { name: c.button })).toBeInTheDocument()
      expect(alert.textContent ?? '', lang).not.toMatch(/[ăâîșț]|\b(casa|bonul|niciun|Fiscalizare)\b/i)
      view.unmount()
    }
  })
})
