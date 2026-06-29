// AiSettingsTab — configurare BYO API + cotă AI (Faza B + UI Faza F)
// Userul își alege furnizorul (OpenAI / Anthropic / Gemini / custom
// OpenAI-compatible), modelul și cheia API. Cheia se trimite o singură dată,
// se criptează server-side (ai-config) și NU se mai întoarce niciodată în clar.
import { useState, useEffect, useCallback } from 'react'
import { D } from '../lib/constants'
import { useIsMobile } from '../hooks/useIsMobile'
import {
  getAiConfig,
  saveAiConfig,
  getAiQuota,
  buyAiCredits,
  type AiProvider,
  type AiQuota,
} from '../lib/ai'

interface ProviderMeta {
  id: AiProvider
  label: string
  hint: string
  modelExamples: string[]
  needsBaseUrl?: boolean
}

// Sugestii de model per furnizor (text liber — userul poate scrie orice model
// suportat de contul lui). Evităm intenționat referințe hard-codate la modelul
// intern al platformei.
const PROVIDERS: ProviderMeta[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'Cheie de la platform.openai.com (începe cu sk-…)',
    modelExamples: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    hint: 'Cheie de la console.anthropic.com',
    modelExamples: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    hint: 'Cheie de la aistudio.google.com',
    modelExamples: ['gemini-1.5-flash', 'gemini-1.5-pro'],
  },
  {
    id: 'custom',
    label: 'Personalizat (OpenAI-compatible)',
    hint: 'Orice endpoint compatibil OpenAI (ex. self-hosted, OpenRouter)',
    modelExamples: ['model-name'],
    needsBaseUrl: true,
  },
]

const CREDIT_PACKS: { id: 'small' | 'medium' | 'large'; tokens: string; price: string }[] = [
  { id: 'small', tokens: '100.000 tokens', price: '19 lei' },
  { id: 'medium', tokens: '500.000 tokens', price: '79 lei' },
  { id: 'large', tokens: '2.000.000 tokens', price: '249 lei' },
]

export default function AiSettingsTab({ restaurantId }: { restaurantId: string }) {
  const isMobile = useIsMobile()
  const [provider, setProvider] = useState<AiProvider>('openai')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [hasKey, setHasKey] = useState(false) // există deja o cheie salvată
  const [quota, setQuota] = useState<AiQuota | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [buying, setBuying] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [cfg, q] = await Promise.all([getAiConfig(restaurantId), getAiQuota(restaurantId)])
    if (cfg) {
      setProvider(cfg.provider)
      setModel(cfg.model)
      setBaseUrl(cfg.base_url ?? '')
      setEnabled(cfg.enabled)
      setHasKey(true) // dacă există config, presupunem că are cheie (nu o citim)
    }
    setQuota(q)
    setLoading(false)
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  const meta = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0]

  async function handleSave() {
    setMsg(null)
    if (!model.trim()) {
      setMsg({ kind: 'err', text: 'Alege un model.' })
      return
    }
    if (meta.needsBaseUrl && !/^https:\/\//i.test(baseUrl.trim())) {
      setMsg({ kind: 'err', text: 'Furnizorul personalizat are nevoie de un URL https.' })
      return
    }
    if (!hasKey && !apiKey.trim()) {
      setMsg({ kind: 'err', text: 'Adaugă cheia API.' })
      return
    }
    setSaving(true)
    try {
      const res = await saveAiConfig({
        restaurant_id: restaurantId,
        provider,
        model: model.trim(),
        base_url: meta.needsBaseUrl ? baseUrl.trim() : null,
        api_key: apiKey.trim() || undefined,
        enabled,
      })
      if (res.config.key_masked) setHasKey(true)
      setApiKey('')
      setMsg({ kind: 'ok', text: 'Configurație salvată. Cheia este criptată și securizată.' })
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Eroare la salvare.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleBuy(pack: 'small' | 'medium' | 'large') {
    setBuying(pack)
    setMsg(null)
    try {
      const { url } = await buyAiCredits({ restaurant_id: restaurantId, pack })
      window.location.href = url
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Nu am putut porni plata.' })
      setBuying(null)
    }
  }

  const label = { fontSize: '0.72rem', color: D.t3, textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 6, display: 'block', fontWeight: 600 }
  const input = {
    width: '100%',
    background: D.s3,
    border: `1px solid ${D.border}`,
    borderRadius: 9,
    color: D.t1,
    padding: '11px 13px',
    fontSize: '0.9rem',
    fontFamily: 'DM Sans,sans-serif',
    outline: 'none',
    boxSizing: 'border-box' as const,
  }

  if (loading) return <div style={{ color: D.t2, padding: 20 }}>Se încarcă...</div>

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontFamily: 'Fraunces,serif', fontSize: '1.5rem', fontWeight: 600, color: D.t1, marginBottom: 6 }}>
        Asistent AI
      </h1>
      <p style={{ color: D.t2, fontSize: '0.9rem', lineHeight: 1.5, marginBottom: 24 }}>
        Conectează-ți propria cheie API ca să folosești chatbot-ul din dashboard și importul de meniu din poze.
        Cheia ta rămâne criptată pe server — nu o vedem și nu o stocăm în clar.
      </p>

      {/* Cotă */}
      {quota && (
        <div style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 14, padding: 18, marginBottom: 22 }}>
          <div style={{ fontSize: '0.72rem', color: D.t3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12, fontWeight: 600 }}>
            Consum luna aceasta
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ color: D.t1, fontSize: '1.1rem', fontWeight: 600 }}>
              {quota.used_tokens.toLocaleString('ro-RO')} <span style={{ color: D.t3, fontSize: '0.85rem', fontWeight: 400 }}>/ {quota.included_tokens.toLocaleString('ro-RO')} incluse</span>
            </span>
            {quota.credit_balance > 0 && (
              <span style={{ color: D.gold, fontSize: '0.82rem' }}>
                + {quota.credit_balance.toLocaleString('ro-RO')} credite
              </span>
            )}
          </div>
          <div style={{ height: 6, background: D.s3, borderRadius: 3, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                borderRadius: 3,
                width: `${Math.min(100, Math.round((quota.used_tokens / Math.max(1, quota.included_tokens)) * 100))}%`,
                background: quota.included_remaining === 0 ? D.amber : D.gold,
                transition: 'width .4s',
              }}
            />
          </div>
          {quota.included_remaining === 0 && quota.credit_balance === 0 && (
            <p style={{ color: D.amber, fontSize: '0.8rem', marginTop: 10, marginBottom: 0 }}>
              Ai consumat cota inclusă. Cumpără credite mai jos ca să continui.
            </p>
          )}
        </div>
      )}

      {/* Config formular */}
      <div style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 14, padding: 18, marginBottom: 22 }}>
        <label style={label}>Furnizor</label>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr', gap: 8, marginBottom: 16 }}>
          {PROVIDERS.map((p) => {
            const active = provider === p.id
            return (
              <button
                key={p.id}
                onClick={() => { setProvider(p.id); if (!model || PROVIDERS.some((x) => x.modelExamples.includes(model))) setModel('') }}
                className="pressable"
                style={{
                  textAlign: 'left',
                  padding: '11px 13px',
                  borderRadius: 10,
                  border: `1px solid ${active ? D.gold + '88' : D.border}`,
                  background: active ? D.goldA : D.s3,
                  color: active ? D.goldL : D.t2,
                  cursor: 'pointer',
                  fontFamily: 'DM Sans,sans-serif',
                  fontSize: '0.85rem',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Model</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={`ex. ${meta.modelExamples.join(', ')}`}
            list="ai-model-suggestions"
            style={input}
          />
          <datalist id="ai-model-suggestions">
            {meta.modelExamples.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>

        {meta.needsBaseUrl && (
          <div style={{ marginBottom: 16 }}>
            <label style={label}>URL endpoint (https)</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.exemplu.ro/v1"
              style={input}
            />
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Cheie API {hasKey && <span style={{ color: D.green, textTransform: 'none', letterSpacing: 0 }}>· salvată ✓</span>}</label>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            type="password"
            autoComplete="off"
            placeholder={hasKey ? '•••••••• (lasă gol pentru a păstra cheia)' : 'Lipește cheia aici'}
            style={input}
          />
          <p style={{ color: D.t3, fontSize: '0.75rem', marginTop: 6, marginBottom: 0 }}>{meta.hint}</p>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 4 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#C8963C' }} />
          <span style={{ color: D.t1, fontSize: '0.88rem' }}>Activează asistentul AI pentru acest restaurant</span>
        </label>
      </div>

      {msg && (
        <div
          style={{
            background: msg.kind === 'ok' ? D.greenA : D.redA,
            border: `1px solid ${msg.kind === 'ok' ? D.green : D.red}44`,
            color: msg.kind === 'ok' ? D.green : D.red,
            borderRadius: 9,
            padding: '11px 14px',
            fontSize: '0.85rem',
            marginBottom: 16,
          }}
        >
          {msg.text}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="pressable"
        style={{
          background: D.gold,
          color: '#000',
          border: 'none',
          borderRadius: 10,
          padding: '13px 24px',
          fontFamily: 'DM Sans,sans-serif',
          fontSize: '0.9rem',
          fontWeight: 700,
          cursor: saving ? 'default' : 'pointer',
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? 'Se salvează...' : 'Salvează configurația'}
      </button>

      {/* Top-up credite (Faza F) */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontFamily: 'Fraunces,serif', fontSize: '1.1rem', fontWeight: 600, color: D.t1, marginBottom: 6 }}>
          Credite suplimentare
        </h2>
        <p style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 16 }}>
          Ai depășit cota inclusă? Cumpără tokens suplimentari care nu expiră.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 12 }}>
          {CREDIT_PACKS.map((pack) => (
            <div key={pack.id} style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ color: D.t1, fontSize: '0.95rem', fontWeight: 600, marginBottom: 4 }}>{pack.tokens}</div>
              <div style={{ fontFamily: 'Fraunces,serif', color: D.gold, fontSize: '1.3rem', fontWeight: 700, marginBottom: 12 }}>{pack.price}</div>
              <button
                onClick={() => handleBuy(pack.id)}
                disabled={buying !== null}
                className="pressable"
                style={{
                  width: '100%',
                  background: 'transparent',
                  color: D.gold,
                  border: `1px solid ${D.gold}55`,
                  borderRadius: 8,
                  padding: '9px 0',
                  fontFamily: 'DM Sans,sans-serif',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: buying ? 'default' : 'pointer',
                  opacity: buying && buying !== pack.id ? 0.5 : 1,
                }}
              >
                {buying === pack.id ? 'Se deschide...' : 'Cumpără'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
