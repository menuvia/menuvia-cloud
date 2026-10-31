// src/components/afiliat/EnrollSection.tsx
// „Înscrie un restaurant” — prima secțiune a panoului de vânzări (pachetul 8b-2):
// codul agentului mare (îl dictezi la masă), linkul cu „Copiază linkul”, codul QR
// care se deschide pe TOT ecranul la tap (îl arăți patronului de pe telefon) și
// „Arată demo” (ruta publică /demo, care există deja).
//
// Codul e `referral_code` (mig 301: 7 caractere dictabile); patronul îl scrie la
// înscriere, la „Am un cod de agent” (components/auth/AgentCodeSection.tsx), sau
// deschide linkul — atribuirea se face la crearea contului (mig 301).
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { D } from '../../lib/constants'
import { referralUrl } from '../../lib/affiliate'
import { FocusTrap } from '../ui/FocusTrap'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import type { ToastApi } from '../ui/useToast'

// Culorile IMAGINII QR (aceleași ca în vechiul tab „Unelte”), nu tokeni de temă:
// codul trebuie să rămână închis-pe-deschis în orice temă ca să poată fi scanat,
// iar ecranul plin folosește aceleași culori ca imaginea.
const QR_DARK = '#1A1208'
const QR_LIGHT = '#F8F3EB'

const primaryBtn = {
  background: D.gold,
  color: D.onGold,
  border: 'none',
  borderRadius: 9,
  padding: '10px 16px',
  minHeight: 44,
  fontSize: '0.85rem',
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: D.fontBody,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
} as const

const ghostBtn = {
  ...primaryBtn,
  background: 'transparent',
  color: D.t1,
  border: `1px solid ${D.border}`,
} as const

function QrFullscreen({ src, code, onClose }: { src: string; code: string; onClose: () => void }) {
  useBodyScrollLock(true)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Codul QR al linkului tău"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: QR_LIGHT,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <FocusTrap />
      <img
        src={src}
        alt="Cod QR cu linkul tău de recomandare"
        style={{ width: 'min(88vw, 72vh)', height: 'min(88vw, 72vh)' }}
      />
      <div
        style={{
          color: QR_DARK,
          fontSize: '1.6rem',
          fontWeight: 700,
          letterSpacing: '0.12em',
          fontFamily: D.fontMono,
        }}
      >
        {code}
      </div>
      <button
        type="button"
        onClick={onClose}
        style={{ ...primaryBtn, background: QR_DARK, color: QR_LIGHT }}
      >
        Închide
      </button>
    </div>
  )
}

export default function EnrollSection({
  code,
  clientsCount,
  toast,
}: {
  code: string
  clientsCount: number
  toast: ToastApi
}) {
  const url = referralUrl(code)
  const [qr, setQr] = useState<string | null>(null)
  const [qrFailed, setQrFailed] = useState<boolean>(false)
  const [fullscreen, setFullscreen] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(url, {
      width: 600,
      margin: 1,
      color: { dark: QR_DARK, light: QR_LIGHT },
    }).then(
      (dataUrl) => {
        if (!cancelled) setQr(dataUrl)
      },
      () => {
        // Fără QR rămân codul și linkul; butonul spune că imaginea lipsește.
        if (!cancelled) setQrFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [url])

  const copy = () => {
    // navigator.clipboard e undefined pe context non-secure → guard ca să nu arunce sincron.
    if (!navigator.clipboard) {
      toast.error(
        'Copierea nu e disponibilă în acest browser. Selectează linkul și copiază-l manual.',
      )
      return
    }
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link copiat'),
      () => toast.error('Nu s-a putut copia linkul. Selectează-l și copiază-l manual.'),
    )
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const share = () => {
    navigator
      .share({ title: 'Menuvia', text: 'Încearcă Menuvia pentru restaurantul tău', url })
      .catch(() => {
        /* omul a închis fereastra de partajare: nimic de raportat */
      })
  }

  const downloadQr = () => {
    if (!qr) return
    const a = document.createElement('a')
    a.href = qr
    a.download = `menuvia-agent-${code}.png`
    a.click()
  }

  return (
    <section
      aria-labelledby="enroll-title"
      style={{
        background: D.s2,
        border: `1px solid ${D.gold}44`,
        borderRadius: 14,
        padding: '18px 20px',
      }}
    >
      <h2 id="enroll-title" style={{ margin: '0 0 4px', fontSize: '1.05rem', color: D.t1 }}>
        Înscrie un restaurant
      </h2>
      <p style={{ margin: '0 0 14px', color: D.t2, fontSize: '0.8rem', lineHeight: 1.5 }}>
        {clientsCount === 0 ? 'Începe de aici: patronul' : 'Patronul'} își face contul din linkul
        tău sau, la înscriere, apasă „Am un cod de agent” și scrie codul de mai jos. Așa
        restaurantul îți rămâne atribuit ție.
      </p>

      <div
        style={{
          fontSize: '0.7rem',
          color: D.t2,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        Codul tău de agent
      </div>
      <div
        data-testid="agent-code"
        style={{
          fontFamily: D.fontMono,
          fontSize: 'clamp(1.8rem, 9vw, 2.6rem)',
          fontWeight: 700,
          color: D.gold,
          letterSpacing: '0.12em',
          margin: '4px 0 12px',
          overflowWrap: 'anywhere',
        }}
      >
        {code}
      </div>

      <div
        style={{
          background: D.s1,
          border: `1px solid ${D.border}`,
          borderRadius: 9,
          padding: '10px 12px',
          color: D.t1,
          fontSize: '0.82rem',
          wordBreak: 'break-all',
          marginBottom: 12,
        }}
      >
        {url}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" style={primaryBtn} onClick={copy}>
          Copiază linkul
        </button>
        {canShare ? (
          <button type="button" style={ghostBtn} onClick={share}>
            Trimite
          </button>
        ) : null}
        <button
          type="button"
          style={{ ...ghostBtn, ...(qr ? null : { opacity: 0.55, cursor: 'not-allowed' }) }}
          disabled={!qr}
          onClick={() => setFullscreen(true)}
        >
          {qr
            ? 'Arată codul QR'
            : qrFailed
              ? 'Codul QR nu s-a putut genera'
              : 'Se generează codul QR…'}
        </button>
        <a href="/demo" style={ghostBtn}>
          Arată demo
        </a>
      </div>

      {qr ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            marginTop: 14,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            aria-label="Deschide codul QR pe tot ecranul"
            onClick={() => setFullscreen(true)}
            style={{
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              borderRadius: 10,
            }}
          >
            <img
              src={qr}
              alt=""
              style={{ width: 120, height: 120, borderRadius: 10, display: 'block' }}
            />
          </button>
          <div style={{ color: D.t2, fontSize: '0.76rem', lineHeight: 1.5, flex: '1 1 160px' }}>
            Atinge codul QR ca să-l arăți pe tot ecranul. Pentru flyere îl poți{' '}
            <button
              type="button"
              onClick={downloadQr}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: D.gold,
                cursor: 'pointer',
                fontSize: 'inherit',
                fontFamily: 'inherit',
                textDecoration: 'underline',
              }}
            >
              descărca (PNG)
            </button>
            .
          </div>
        </div>
      ) : null}

      {fullscreen && qr ? (
        <QrFullscreen src={qr} code={code} onClose={() => setFullscreen(false)} />
      ) : null}
    </section>
  )
}
