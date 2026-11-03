// ─────────────────────────────────────────────────────────────
// PlanUpsellCard — upsell-ul UNIC al panoului (lotul P, nov 2026).
//
// Decizia fondatorului: planurile inferioare nu văd nimic din cele superioare,
// cu UN SINGUR upsell clar. Cardul stă doar pe Acasă, în zona de abonament
// (lângă „Abonament & facturare"), și îl vede doar PROPRIETARUL — managerul
// n-are ce cumpăra. Ținta vine din `planUpsellTarget` (lib/planSurface.ts):
//   'ordering' → Planul 1 trece la „Meniu + Comenzi";
//   'payments' → Planul 2 trece la „Plata la masă" (Fiscalizarea).
// Numele planurilor vin DOAR din PLAN_LABELS (direct sau prin PLAN_NAMES, care
// e derivat din el — regula 4).
// ─────────────────────────────────────────────────────────────
import { D, PLAN_LABELS } from '../../lib/constants'
import { PLAN_NAMES } from '../../lib/features'
import type { PlanUpsellTarget } from '../../lib/planSurface'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Icon } from '../ui/Icon'

interface UpsellCopy {
  title: string
  lead: string
  benefits: readonly [string, string, string]
}

const COPY: Record<PlanUpsellTarget, UpsellCopy> = {
  ordering: {
    title: PLAN_NAMES.growth,
    lead: 'Clienții comandă singuri, iar bucătăria primește comanda pe loc.',
    benefits: [
      'Comenzi de la masă, prin QR',
      'Ecran de bucătărie pentru comenzile noi',
      'Comenzi pentru ridicare',
    ],
  },
  payments: {
    title: 'Plata la masă',
    lead: `Pe planul ${PLAN_LABELS.pro}.`,
    benefits: [
      'Oaspetele plătește din telefon',
      'Bonul fiscal se emite automat',
      'Încasările și TVA-ul se raportează singure',
    ],
  },
}

export function PlanUpsellCard({
  target,
  onSeePlan,
}: {
  target: PlanUpsellTarget
  onSeePlan: () => void
}) {
  const copy = COPY[target]
  return (
    <section aria-label={`Ofertă: ${copy.title}`}>
      <Card variant="raised" style={{ border: `1px solid ${D.goldBorder}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px', minWidth: 0 }}>
            <h2
              style={{
                color: D.t1,
                fontSize: '0.98rem',
                fontWeight: 700,
                margin: 0,
                fontFamily: 'DM Sans,sans-serif',
              }}
            >
              {copy.title}
            </h2>
            <div style={{ color: D.t2, fontSize: '0.78rem', marginTop: 4, lineHeight: 1.5 }}>
              {copy.lead}
            </div>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '10px 0 0',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {copy.benefits.map((b) => (
                <li
                  key={b}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: D.t1,
                    fontSize: '0.82rem',
                  }}
                >
                  <Icon name="check" size={14} color={D.green} />
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <Button variant="primary" onClick={onSeePlan} style={{ alignSelf: 'center' }}>
            Vezi planul
            <Icon name="chevronRight" size={16} />
          </Button>
        </div>
      </Card>
    </section>
  )
}
