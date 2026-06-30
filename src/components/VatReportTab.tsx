// ─────────────────────────────────────────────────────────────
// VatReportTab — Raport TVA pentru contabil
//
// Filter pe interval de date, grupare per cota TVA + zi.
// Export CSV care poate fi deschis direct în Excel.
// ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { D } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { InlineSpinner } from './PageLoader'

interface VatRow {
  restaurant_id: string
  report_date: string
  vat_group: number
  vat_rate_percent: number
  vat_label: string
  orders_count: number
  gross_total: number
  vat_amount: number
  net_total: number
}

interface Props {
  restaurantId: string
}

export default function VatReportTab({ restaurantId }: Props) {
  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [from, setFrom] = useState<string>(firstOfMonth.toISOString().slice(0, 10))
  const [to, setTo] = useState<string>(today.toISOString().slice(0, 10))
  const [rows, setRows] = useState<VatRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const { data, error: e } = await supabase
        .from('vat_report_daily')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('report_date', from)
        .lte('report_date', to)
        .order('report_date', { ascending: false })
        .order('vat_group')

      if (e) throw e
      setRows((data ?? []) as VatRow[])
    } catch (err) {
      setError((err as Error).message)
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [restaurantId, from, to]) // eslint-disable-line

  // Aggregations
  const byVatGroup = new Map<
    number,
    { gross: number; vat: number; net: number; rate: number; label: string }
  >()
  let totalGross = 0,
    totalVat = 0,
    totalNet = 0
  for (const r of rows) {
    const existing = byVatGroup.get(r.vat_group) ?? {
      gross: 0,
      vat: 0,
      net: 0,
      rate: r.vat_rate_percent,
      label: r.vat_label,
    }
    existing.gross += Number(r.gross_total)
    existing.vat += Number(r.vat_amount)
    existing.net += Number(r.net_total)
    byVatGroup.set(r.vat_group, existing)
    totalGross += Number(r.gross_total)
    totalVat += Number(r.vat_amount)
    totalNet += Number(r.net_total)
  }

  function exportCsv() {
    // CSV with header + rows + totals
    const sep = ';' // semicolon for Romanian Excel
    // Sanitizare per-celulă: (1) neutralizează formula injection — un câmp
    // free-text (ex. vat_label din editor) care începe cu = + - @ sau tab/CR
    // e prefixat cu ' ca Excel/Sheets să nu-l execute ca formulă;
    // (2) escaping de separator/ghilimele/newline prin încadrare în ghilimele.
    const csvCell = (val: string | number): string => {
      let s = String(val ?? '')
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
      if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    const row = (cells: (string | number)[]): string => cells.map(csvCell).join(sep)
    const lines: string[] = []
    lines.push(
      row([
        'Data',
        'Cota TVA',
        'Etichetă',
        'Comenzi',
        'Total brut (lei)',
        'TVA (lei)',
        'Total net (lei)',
      ]),
    )

    for (const r of rows) {
      lines.push(
        row([
          r.report_date,
          `${r.vat_rate_percent}%`,
          r.vat_label,
          String(r.orders_count),
          Number(r.gross_total).toFixed(2).replace('.', ','),
          Number(r.vat_amount).toFixed(2).replace('.', ','),
          Number(r.net_total).toFixed(2).replace('.', ','),
        ]),
      )
    }

    // Aggregated totals
    lines.push('')
    lines.push(row(['TOTAL PER COTA TVA', '', '', '', '', '', '']))
    for (const agg of [...byVatGroup.values()].sort((a, b) => a.rate - b.rate)) {
      lines.push(
        row([
          '',
          `${agg.rate}%`,
          agg.label,
          '',
          agg.gross.toFixed(2).replace('.', ','),
          agg.vat.toFixed(2).replace('.', ','),
          agg.net.toFixed(2).replace('.', ','),
        ]),
      )
    }
    lines.push('')
    lines.push(
      row([
        'GRAND TOTAL',
        '',
        '',
        '',
        totalGross.toFixed(2).replace('.', ','),
        totalVat.toFixed(2).replace('.', ','),
        totalNet.toFixed(2).replace('.', ','),
      ]),
    )

    const csv = lines.join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `raport-tva-${from}-${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Header */}
      <div>
        <h2
          style={{
            fontFamily: 'Fraunces,serif',
            fontSize: '1.6rem',
            color: D.t1,
            letterSpacing: '-0.02em',
            margin: 0,
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          Raport TVA
        </h2>
        <div style={{ fontSize: '0.85rem', color: D.t3, lineHeight: 1.5 }}>
          Vânzări grupate pe cota TVA și zi. Export CSV pentru contabil.
        </div>
      </div>

      {/* Date range filters */}
      <div
        style={{
          background: D.s2,
          border: `1px solid ${D.border}`,
          borderRadius: 12,
          padding: 16,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '0.74rem',
              color: D.t2,
              marginBottom: 5,
              fontWeight: 500,
            }}
          >
            De la
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{
              padding: '8px 12px',
              background: D.s3,
              border: `1px solid ${D.border}`,
              borderRadius: 7,
              color: D.t1,
              fontSize: '0.85rem',
              fontFamily: 'DM Sans, sans-serif',
            }}
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              fontSize: '0.74rem',
              color: D.t2,
              marginBottom: 5,
              fontWeight: 500,
            }}
          >
            Până la
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{
              padding: '8px 12px',
              background: D.s3,
              border: `1px solid ${D.border}`,
              borderRadius: 7,
              color: D.t1,
              fontSize: '0.85rem',
              fontFamily: 'DM Sans, sans-serif',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {/* Quick range presets */}
          <button
            onClick={() => {
              const t = new Date()
              const f = new Date(t.getFullYear(), t.getMonth(), 1)
              setFrom(f.toISOString().slice(0, 10))
              setTo(t.toISOString().slice(0, 10))
            }}
            style={presetBtn}
          >
            Luna asta
          </button>
          <button
            onClick={() => {
              const t = new Date()
              const f = new Date(t.getFullYear(), t.getMonth() - 1, 1)
              const l = new Date(t.getFullYear(), t.getMonth(), 0)
              setFrom(f.toISOString().slice(0, 10))
              setTo(l.toISOString().slice(0, 10))
            }}
            style={presetBtn}
          >
            Luna trecută
          </button>
          <button
            onClick={() => {
              const t = new Date()
              const f = new Date(t.getFullYear(), 0, 1)
              setFrom(f.toISOString().slice(0, 10))
              setTo(t.toISOString().slice(0, 10))
            }}
            style={presetBtn}
          >
            Anul ăsta
          </button>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            style={{
              padding: '8px 16px',
              background: rows.length === 0 ? D.s3 : D.gold,
              color: rows.length === 0 ? D.t3 : '#000',
              border: 'none',
              borderRadius: 7,
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
              fontFamily: 'DM Sans, sans-serif',
              opacity: rows.length === 0 ? 0.6 : 1,
            }}
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <InlineSpinner label="Se calculează raportul..." />
      ) : error ? (
        <div
          style={{
            padding: 16,
            background: 'rgba(192,57,43,0.1)',
            borderRadius: 10,
            color: '#c0392b',
            fontSize: '0.85rem',
          }}
        >
          Eroare: {error}
        </div>
      ) : rows.length === 0 ? (
        <div
          style={{
            background: D.s2,
            border: `1px dashed ${D.border}`,
            borderRadius: 12,
            padding: 32,
            textAlign: 'center',
            color: D.t3,
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>📊</div>
          <div style={{ fontSize: '0.88rem', marginBottom: 4 }}>
            Nu există vânzări în intervalul selectat
          </div>
          <div style={{ fontSize: '0.75rem' }}>
            Schimbă datele sau înregistrează prima comandă plătită
          </div>
        </div>
      ) : (
        <>
          {/* Aggregated summary cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 10,
            }}
          >
            {[...byVatGroup.values()]
              .sort((a, b) => a.rate - b.rate)
              .map((agg) => (
                <div
                  key={agg.label}
                  style={{
                    background: D.s2,
                    border: `1px solid ${D.border}`,
                    borderRadius: 12,
                    padding: '14px 16px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: D.t3,
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      marginBottom: 4,
                    }}
                  >
                    {agg.rate}% {agg.label}
                  </div>
                  <div
                    style={{
                      fontFamily: 'Fraunces,serif',
                      fontSize: '1.3rem',
                      fontWeight: 700,
                      color: D.t1,
                      letterSpacing: '-0.02em',
                      marginBottom: 4,
                    }}
                  >
                    {agg.gross.toFixed(2)} lei
                  </div>
                  <div style={{ fontSize: '0.72rem', color: D.t3, lineHeight: 1.5 }}>
                    TVA: <strong style={{ color: D.gold }}>{agg.vat.toFixed(2)}</strong>
                    <br />
                    Net: {agg.net.toFixed(2)}
                  </div>
                </div>
              ))}
            <div
              style={{
                background: D.goldA,
                border: `1px solid ${D.gold}55`,
                borderRadius: 12,
                padding: '14px 16px',
              }}
            >
              <div
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: D.gold,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  marginBottom: 4,
                }}
              >
                TOTAL
              </div>
              <div
                style={{
                  fontFamily: 'Fraunces,serif',
                  fontSize: '1.3rem',
                  fontWeight: 700,
                  color: D.t1,
                  letterSpacing: '-0.02em',
                  marginBottom: 4,
                }}
              >
                {totalGross.toFixed(2)} lei
              </div>
              <div style={{ fontSize: '0.72rem', color: D.t2, lineHeight: 1.5 }}>
                TVA: <strong style={{ color: D.gold }}>{totalVat.toFixed(2)}</strong>
                <br />
                Net: {totalNet.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Detailed table */}
          <div
            style={{
              background: D.s2,
              border: `1px solid ${D.border}`,
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                fontSize: '0.8rem',
                fontWeight: 700,
                color: D.t2,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                borderBottom: `1px solid ${D.border}`,
              }}
            >
              Detalii zilnice
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: D.s3 }}>
                    {['Data', 'Cota', 'Etichetă', 'Comenzi', 'Brut', 'TVA', 'Net'].map((h) => (
                      <th
                        key={h}
                        style={{
                          padding: '10px 14px',
                          textAlign: 'left',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          color: D.t3,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          borderBottom: `1px solid ${D.border}`,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      style={{
                        borderBottom: i < rows.length - 1 ? `1px solid ${D.border}` : 'none',
                      }}
                    >
                      <td style={{ padding: '10px 14px', color: D.t1, fontWeight: 500 }}>
                        {new Date(r.report_date).toLocaleDateString('ro-RO', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td style={{ padding: '10px 14px', color: D.t2 }}>{r.vat_rate_percent}%</td>
                      <td style={{ padding: '10px 14px', color: D.t2, fontSize: '0.78rem' }}>
                        {r.vat_label}
                      </td>
                      <td style={{ padding: '10px 14px', color: D.t2 }}>{r.orders_count}</td>
                      <td style={{ padding: '10px 14px', color: D.t1, fontWeight: 600 }}>
                        {Number(r.gross_total).toFixed(2)}
                      </td>
                      <td style={{ padding: '10px 14px', color: D.gold, fontWeight: 600 }}>
                        {Number(r.vat_amount).toFixed(2)}
                      </td>
                      <td style={{ padding: '10px 14px', color: D.t2 }}>
                        {Number(r.net_total).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div
            style={{
              fontSize: '0.74rem',
              color: D.t3,
              padding: '10px 14px',
              background: D.s2,
              borderRadius: 8,
              lineHeight: 1.6,
            }}
          >
            💡 <strong>Ce face contabilul cu acest raport:</strong> introduce sumele în softul de
            contabilitate (SAGA, ContaPC, NextUp), grupate pe cota TVA. CSV-ul exportat se deschide
            direct în Excel sau Google Sheets.
          </div>
        </>
      )}
    </div>
  )
}

const presetBtn: React.CSSProperties = {
  padding: '8px 14px',
  background: D.s3,
  color: D.t2,
  border: `1px solid ${D.border}`,
  borderRadius: 7,
  fontSize: '0.78rem',
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'DM Sans, sans-serif',
}
