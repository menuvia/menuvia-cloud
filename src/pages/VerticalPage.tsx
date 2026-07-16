// =============================================================
// VerticalPage — landing-uri pe verticale (/hoteluri, /terase, /cafenele)
//
// EXPANSION E1: aceeași platformă, poziționată pe limbajul fiecărui tip de
// local. O singură componentă cu config per verticală — secțiunile (hero,
// beneficii, pași, FAQ, CTA) sunt comune; DOAR copy-ul și iconițele diferă.
//
// Regulile de copy (ca Landing/Comparatie): onest — fiscalizarea e „pilot",
// nu promitem „fără card"; funcțiile menționate EXISTĂ (7 limbi, happy hour
// server-side, tips la „cere nota", pickup, review funnel, import AI).
// Stil: paleta MKT + MarketingHeader/Footer, ca restul paginilor de marketing.
// =============================================================
import { useEffect } from 'react'
import { MKT } from '../lib/marketing'
import { RevealItem } from '../components/marketing/Reveal'
import MarketingHeader from '../components/marketing/MarketingHeader'
import MarketingFooter from '../components/marketing/MarketingFooter'
import { Icon } from '../components/ui/Icon'
import type { IconName } from '../components/ui/Icon'

export type VerticalKey = 'hoteluri' | 'terase' | 'cafenele'

interface VerticalConfig {
  /** <title> + meta share — restaurat la unmount. */
  pageTitle: string
  badge: string
  title: string
  subtitle: string
  benefits: { icon: IconName; t: string; d: string }[]
  steps: { t: string; d: string }[]
  faq: { q: string; a: string }[]
  ctaTitle: string
  ctaSub: string
}

const VERTICALS: Record<VerticalKey, VerticalConfig> = {
  hoteluri: {
    pageTitle: 'Menuvia pentru hoteluri & pensiuni — room service prin QR',
    badge: 'Pentru hoteluri & pensiuni',
    title: 'Room service prin QR, direct din cameră',
    subtitle:
      'Pui câte un cod QR în fiecare cameră: oaspetele scanează, vede meniul în limba lui și comandă din telefon. Comanda ajunge în timp real la bucătărie sau la recepție — fără telefoane pierdute, fără aplicație de descărcat.',
    benefits: [
      {
        icon: 'qr',
        t: 'Un QR pe fiecare cameră',
        d: 'Camera funcționează ca o „masă" cu numele ei — știi mereu de unde vine comanda, iar oaspetele nu sună la recepție pentru un sandviș.',
      },
      {
        icon: 'utensils',
        t: 'Comanda ajunge direct în bucătărie',
        d: 'Ecran live pentru bucătărie și personal, cu statusuri (primită → în lucru → livrată). Nimic notat pe hârtie, nimic uitat.',
      },
      {
        icon: 'sparkle',
        t: 'Meniu în 7 limbi',
        d: 'Română, engleză, germană, franceză, italiană, maghiară, spaniolă — turistul comandă în limba lui, tu scrii meniul o singură dată.',
      },
      {
        icon: 'bell',
        t: 'Apel la personal dintr-un tap',
        d: 'Oaspetele cheamă personalul sau cere nota din telefon, iar cererea apare instant pe ecranul echipei.',
      },
    ],
    steps: [
      {
        t: 'Creezi meniul de room service',
        d: 'Îl scrii sau îl imporți din poze cu AI — cu prețuri, poze și traduceri.',
      },
      {
        t: 'Generezi câte un QR pe cameră',
        d: 'Din dashboard, câte o „masă" pentru fiecare cameră — printezi și lipești.',
      },
      {
        t: 'Oaspetele comandă, echipa vede live',
        d: 'Comenzile curg pe ecranul bucătăriei/recepției, cu numele camerei pe fiecare.',
      },
    ],
    faq: [
      {
        q: 'Avem nevoie de echipament nou?',
        a: 'Nu. Menuvia rulează în browser — pe telefoanele oaspeților și pe orice telefon, tabletă sau laptop are echipa ta. Zero hardware de cumpărat.',
      },
      {
        q: 'Funcționează și pentru restaurantul sau terasa hotelului?',
        a: 'Da — același cont, aceleași meniuri, doar adaugi mesele. Camerele și mesele stau în zone separate ca să nu se amestece comenzile.',
      },
      {
        q: 'Cum plătesc oaspeții?',
        a: 'Ca până acum: la recepție, la personal sau pe nota de cameră. Pe planurile mari există și plata online cu cardul (în lei), direct din telefon.',
      },
    ],
    ctaTitle: 'Oferă room service modern din prima zi',
    ctaSub: '30 de zile gratuit, anulezi oricând. Pornești singur, în câteva minute.',
  },
  terase: {
    pageTitle: 'Menuvia pentru terase — comenzi de la masă, fără alergătură',
    badge: 'Pentru terase & beach bar-uri',
    title: 'Sezonul e scurt. Nu-l pierde alergând între mese.',
    subtitle:
      'QR pe fiecare masă: clientul comandă singur din telefon, barul și bucătăria văd comanda instant. Cu personal sezonier puțin, fiecare drum economisit înseamnă mese servite mai repede.',
    benefits: [
      {
        icon: 'qr',
        t: 'Pornești rapid, fără instalare',
        d: 'Meniu + coduri QR gata în aceeași zi. Fără tabletă nouă, fără POS nou — totul rulează în browser.',
      },
      {
        icon: 'users',
        t: 'Ospătarii fac mai puține drumuri',
        d: 'Clientul comandă și cere nota din telefon — chiar cu bacșiș propus. Ospătarul duce doar produsele, nu și pixul.',
      },
      {
        icon: 'percent',
        t: 'Happy hour automat',
        d: 'Setezi intervalul și reducerea, iar prețurile reduse se aplică automat la comandă — pe categorii sau produse, cu plafon.',
      },
      {
        icon: 'clock',
        t: 'Comenzile nu se pierd la orele de vârf',
        d: 'Fiecare comandă apare pe ecranul barului/bucătăriei cu masa și ora ei, în ordine — nu în memoria unui ospătar ocupat.',
      },
    ],
    steps: [
      {
        t: 'Îți încarci meniul',
        d: 'Cu poze și categorii — sau îl imporți din poze cu AI, în câteva minute.',
      },
      {
        t: 'Printezi QR-urile pe mese',
        d: 'Câte un cod pentru fiecare masă, generat din dashboard.',
      },
      {
        t: 'Clienții comandă singuri',
        d: 'Tu vezi totul live: comenzi, apeluri de ospătar, cereri de notă.',
      },
    ],
    faq: [
      {
        q: 'Ce fac în extrasezon?',
        a: 'Planul se schimbă sau se anulează oricând, din cont — fără contracte pe termen lung. Meniul rămâne salvat pentru sezonul următor.',
      },
      {
        q: 'Dar clienții care nu vor să scaneze?',
        a: 'Comanda clasică rămâne: ospătarul poate lua comanda din propriul telefon, în același sistem — totul ajunge pe același ecran.',
      },
      {
        q: 'Bonul fiscal?',
        a: 'Casa ta de marcat rămâne casa ta. Puntea de fiscalizare (FiscalNet) e în pilot — bonul iese pe echipamentul existent, nu pe unul nou.',
      },
    ],
    ctaTitle: 'Pregătește terasa înainte de sezon',
    ctaSub: '30 de zile gratuit, anulezi oricând. Configurezi totul într-o după-amiază.',
  },
  cafenele: {
    pageTitle: 'Menuvia pentru cafenele — meniu premium + pre-comandă pentru ridicare',
    badge: 'Pentru cafenele & bistro-uri',
    title: 'Meniul tău, frumos ca localul. Comenzi fără coadă.',
    subtitle:
      'Meniu digital cu teme premium care arată ca brandul tău, plus pre-comandă pentru ridicare: clientul comandă din drum și ridică fără să aștepte. Recenziile Google vin singure, după comandă.',
    benefits: [
      {
        icon: 'image',
        t: 'Teme premium, meniul ca un catalog',
        d: '8 teme cu fonturi și culori alese cu grijă, layout foto sau flipbook — meniul arată ca un lookbook, nu ca un PDF scanat.',
      },
      {
        icon: 'clock',
        t: 'Pre-comandă pentru ridicare',
        d: 'Clientul comandă înainte să ajungă și alege ora de ridicare — cafeaua îl așteaptă caldă, nu invers.',
      },
      {
        icon: 'star',
        t: 'Recenzii Google după comandă',
        d: 'Clienții mulțumiți sunt invitați să lase o recenzie pe Google; feedback-ul mai puțin bun vine la tine, privat.',
      },
      {
        icon: 'leaf',
        t: 'Alergeni și valori nutriționale cu AI',
        d: 'Completezi alergenii și macro-urile cu un click — informația pe care clienții o cer tot mai des, fără muncă manuală.',
      },
    ],
    steps: [
      {
        t: 'Îți construiești meniul',
        d: 'Manual sau importat din poze cu AI — cu poze, alergeni, traduceri.',
      },
      {
        t: 'Alegi tema care se potrivește brandului',
        d: 'Culori, fonturi, layout — previzualizare live, fără designer.',
      },
      {
        t: 'Publici linkul și codul QR',
        d: 'Pe geam, pe mese, pe Instagram — clienții văd meniul și comandă.',
      },
    ],
    faq: [
      {
        q: 'Avem doar 6 mese — merită?',
        a: 'Planul de meniu digital e gândit exact pentru asta: meniul frumos cu QR costă puțin, iar comenzile și pickup-ul se adaugă doar când ai nevoie.',
      },
      {
        q: 'Pot schimba prețurile des?',
        a: 'Da, din telefon, cu efect imediat — fără să reprintezi nimic. QR-ul rămâne același.',
      },
      {
        q: 'Se potrivește cu brandul nostru?',
        a: 'Alegi tema, culoarea de accent și elementele afișate (copertă, tagline, social). Logo-ul și pozele tale dau tonul.',
      },
    ],
    ctaTitle: 'Fă-ți meniul de care să fii mândru',
    ctaSub: '30 de zile gratuit, anulezi oricând. Îl configurezi la o cafea.',
  },
}

interface Props {
  vertical: VerticalKey
  navigate: (path: string) => void
}

export default function VerticalPage({ vertical, navigate }: Props) {
  const cfg = VERTICALS[vertical]

  // Titlu de pagină pentru SEO/share — restaurat la unmount (SPA: altfel
  // titlul verticalei rămâne pe rutele următoare).
  useEffect(() => {
    const prev = document.title
    document.title = cfg.pageTitle
    return () => {
      document.title = prev
    }
  }, [cfg.pageTitle])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: MKT.bg,
        color: MKT.text,
        fontFamily: 'DM Sans, sans-serif',
      }}
    >
      <MarketingHeader
        onBack={() => navigate('/')}
        cta={{ label: 'Începe gratuit', onClick: () => navigate('/auth?lang=ro') }}
      />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section style={{ padding: '64px 20px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div
            style={{
              display: 'inline-block',
              background: MKT.accentSoft,
              color: MKT.accentInk,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '6px 12px',
              borderRadius: 999,
              marginBottom: 20,
            }}
          >
            {cfg.badge}
          </div>
          <h1
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(30px, 6vw, 52px)',
              lineHeight: 1.08,
              fontWeight: 600,
              margin: '0 0 18px',
              letterSpacing: '-0.02em',
            }}
          >
            {cfg.title}
          </h1>
          <p
            style={{
              fontSize: 'clamp(16px, 2.4vw, 19px)',
              lineHeight: 1.55,
              color: MKT.text2,
              margin: '0 auto 28px',
              maxWidth: 640,
            }}
          >
            {cfg.subtitle}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => navigate('/auth?lang=ro')}
              className="pressable"
              style={{
                background: MKT.accent,
                color: MKT.onAccent,
                border: 'none',
                borderRadius: 12,
                padding: '14px 26px',
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Începe gratuit 30 de zile
            </button>
            <button
              onClick={() => navigate('/demo')}
              className="pressable"
              style={{
                background: 'transparent',
                color: MKT.text,
                border: `1px solid ${MKT.border}`,
                borderRadius: 12,
                padding: '14px 26px',
                fontSize: 16,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              Vezi demo live
            </button>
          </div>
        </div>
      </section>

      {/* ── Beneficii ────────────────────────────────────────── */}
      <section style={{ padding: '24px 20px 56px' }}>
        <div
          style={{
            maxWidth: 920,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
            gap: 16,
          }}
        >
          {cfg.benefits.map((b, i) => (
            <RevealItem key={b.t} delay={i * 60}>
              <div
                style={{
                  background: MKT.surface,
                  border: `1px solid ${MKT.border}`,
                  borderRadius: 14,
                  padding: '20px 18px',
                  height: '100%',
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    width: 44,
                    height: 44,
                    borderRadius: 11,
                    background: MKT.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 12,
                  }}
                >
                  <Icon name={b.icon} size={22} color={MKT.accentInk} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{b.t}</div>
                <div style={{ fontSize: 14, color: MKT.text2, lineHeight: 1.55 }}>{b.d}</div>
              </div>
            </RevealItem>
          ))}
        </div>
      </section>

      {/* ── Cum funcționează ─────────────────────────────────── */}
      <section style={{ padding: '48px 20px', background: MKT.surface2 }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(24px, 4vw, 34px)',
              fontWeight: 600,
              margin: '0 0 28px',
              textAlign: 'center',
              letterSpacing: '-0.01em',
            }}
          >
            Cum funcționează
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {cfg.steps.map((s, i) => (
              <RevealItem key={s.t} delay={i * 60}>
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    alignItems: 'flex-start',
                    background: MKT.surface,
                    border: `1px solid ${MKT.border}`,
                    borderRadius: 14,
                    padding: '18px 16px',
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      background: MKT.accentSoft,
                      color: MKT.accentInk,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: 15,
                      fontFamily: 'Fraunces, serif',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{s.t}</div>
                    <div style={{ fontSize: 14, color: MKT.text2, lineHeight: 1.5 }}>{s.d}</div>
                  </div>
                </div>
              </RevealItem>
            ))}
          </div>
        </div>
      </section>

      {/* ── Întrebări frecvente ──────────────────────────────── */}
      <section style={{ padding: '48px 20px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(22px, 3.4vw, 30px)',
              fontWeight: 600,
              margin: '0 0 24px',
              textAlign: 'center',
            }}
          >
            Întrebări frecvente
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {cfg.faq.map((f) => (
              <div
                key={f.q}
                style={{
                  background: MKT.surface,
                  border: `1px solid ${MKT.border}`,
                  borderRadius: 14,
                  padding: '16px 18px',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{f.q}</div>
                <div style={{ fontSize: 14, color: MKT.text2, lineHeight: 1.55 }}>{f.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ────────────────────────────────────────── */}
      <section style={{ padding: '40px 20px 64px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2
            style={{
              fontFamily: 'Fraunces, serif',
              fontSize: 'clamp(24px, 4vw, 34px)',
              fontWeight: 600,
              margin: '0 0 14px',
            }}
          >
            {cfg.ctaTitle}
          </h2>
          <p style={{ fontSize: 16, color: MKT.text2, margin: '0 0 24px', lineHeight: 1.55 }}>
            {cfg.ctaSub}
          </p>
          <button
            onClick={() => navigate('/auth?lang=ro')}
            className="pressable"
            style={{
              background: MKT.accent,
              color: MKT.onAccent,
              border: 'none',
              borderRadius: 12,
              padding: '15px 30px',
              fontSize: 16,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            Începe gratuit
          </button>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
