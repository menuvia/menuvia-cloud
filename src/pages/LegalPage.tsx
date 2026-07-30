// src/pages/LegalPage.tsx
// ─────────────────────────────────────────────────────────────────
// Pagini legale generice (Termeni, Confidențialitate, Cookies, DPA).
//
// IMPORTANT: conținutul actual este DRAFT. Înlocuiește cu documentul
// finalizat de avocat înainte de primul client plătitor.
//
// Vezi: menuvia-pack/02-DRAFT-TERMENI.md
//       menuvia-pack/03-DRAFT-CONFIDENTIALITATE.md
//       menuvia-pack/04-DRAFT-COOKIES.md
//       menuvia-pack/05-DRAFT-DPA.md
// ─────────────────────────────────────────────────────────────────
import { useEffect } from 'react'
import { D } from '../lib/constants'
import LegalFooter from '../components/LegalFooter'
import Icon from '../components/ui/Icon'

export type LegalDoc = 'terms' | 'privacy' | 'cookies' | 'dpa'

const TITLES: Record<LegalDoc, string> = {
  terms: 'Termeni și Condiții',
  privacy: 'Politica de Confidențialitate',
  cookies: 'Politica de Cookies',
  dpa: 'Acord de Prelucrare a Datelor (DPA)',
}

export default function LegalPage({ doc }: { doc: LegalDoc }) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = `${TITLES[doc]} — Menuvia`
    return () => {
      document.title = prevTitle
    }
  }, [doc])

  return (
    <div style={{ minHeight: '100vh', background: D.bg, fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '60px 24px' }}>
        <a
          href="/"
          style={{
            color: D.gold,
            textDecoration: 'none',
            fontSize: 13,
            marginBottom: 24,
            display: 'inline-block',
          }}
        >
          ← Înapoi la pagina principală
        </a>

        <h1
          style={{
            fontFamily: 'Fraunces, serif',
            fontSize: 36,
            color: D.t1,
            fontWeight: 700,
            marginBottom: 16,
            marginTop: 24,
          }}
        >
          {TITLES[doc]}
        </h1>

        <div
          style={{
            background: 'rgba(200, 150, 60, 0.08)',
            border: '1px solid rgba(200, 150, 60, 0.3)',
            borderRadius: 10,
            padding: 16,
            marginBottom: 32,
            fontSize: 13,
            color: D.t2,
            lineHeight: 1.6,
          }}
        >
          <strong
            style={{
              color: D.gold,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="alert" size={15} color={D.gold} />
            Versiune în pregătire.
          </strong>{' '}
          Documentul în formă finală va fi disponibil aici după revizuirea de către consultant
          juridic specializat. Până atunci, pentru orice întrebare scrieți-ne la{' '}
          <a href="mailto:contact@menuvia.ro" style={{ color: D.gold }}>
            contact@menuvia.ro
          </a>
          .
        </div>

        <div style={{ color: D.t2, lineHeight: 1.7, fontSize: 15 }}>
          <p>
            Această pagină va conține <strong style={{ color: D.t1 }}>{TITLES[doc]}</strong>{' '}
            aplicabile utilizării platformei Menuvia.
          </p>

          {doc === 'terms' && (
            <p>
              Termenii vor reglementa drepturile și obligațiile contractuale între MENUVIA SRL și
              clienții B2B (patroni de localuri), inclusiv: serviciile furnizate, tarifele, durata
              contractului, limitarea răspunderii, SLA, drepturile de proprietate intelectuală, și
              clauzele de încetare.
            </p>
          )}

          {doc === 'privacy' && (
            <p>
              Politica de Confidențialitate va detalia, conform GDPR Art. 13, ce date colectăm, cum
              le folosim, cu cine le împărtășim, perioada de retenție, și drepturile dumneavoastră
              ca persoană vizată — inclusiv dreptul de acces, ștergere și portabilitate.
            </p>
          )}

          {doc === 'cookies' && (
            <p>
              Politica de Cookies va enumera categoriile de cookies folosite (strict necesare,
              performanță, funcționale), durata fiecăruia, scopurile prelucrării, și modul în care
              vă puteți retrage consimțământul oricând prin banner-ul din partea de jos a paginii.
            </p>
          )}

          {doc === 'dpa' && (
            <p>
              Acordul de Prelucrare a Datelor (Data Processing Agreement) reglementează relația de
              procesare GDPR Art. 28 între Client (operator) și Menuvia (împuternicit), inclusiv
              măsurile tehnice de securitate, subprocesatorii, și procedura de notificare a
              incidentelor.
            </p>
          )}

          <p style={{ marginTop: 32 }}>
            <strong style={{ color: D.t1 }}>Operator de date:</strong> MENUVIA SRL
            <br />
            <strong style={{ color: D.t1 }}>Contact GDPR:</strong>{' '}
            <a href="mailto:privacy@menuvia.ro" style={{ color: D.gold }}>
              privacy@menuvia.ro
            </a>
            <br />
            <strong style={{ color: D.t1 }}>Autoritate supraveghere:</strong>{' '}
            <a
              href="https://www.dataprotection.ro"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: D.gold }}
            >
              ANSPDCP
            </a>
          </p>
        </div>
      </div>
      <LegalFooter />
    </div>
  )
}
