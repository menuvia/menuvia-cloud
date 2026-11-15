// AiSettingsTab — configurare BYO API + cotă AI (Faza B + UI Faza F)
// Userul își alege furnizorul (OpenAI / Anthropic / Gemini / custom
// OpenAI-compatible), modelul și cheia API. Cheia se trimite o singură dată,
// se criptează server-side (ai-config) și NU se mai întoarce niciodată în clar.
// Limba (lotul L6b): textele vin din `aiSettings` („Reîncearcă” din `common`).
// Mesajul de sub formular e ținut ca DATĂ (`AiMsg`: cheia + cauza) și se
// traduce la randare; erorile funcțiilor AI: în română textul serverului, ca
// înainte (`describeStaffError` = `toUserMessage`), în altă limbă după `code`.
import { useState, useEffect } from 'react'
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
import { Button } from './ui/Button'
import { useT } from '../i18n/useT'
import { describeStaffError } from '../i18n/staffErrors'
import { staffLocale } from '../i18n/format'
import { aiSettingsNs } from '../i18n/ns/aiSettings'
import { commonNs } from '../i18n/ns/common'
import type { Translator } from '../i18n/core'
import type aiSettingsRo from '../i18n/ns/aiSettings/ro'
import type commonRo from '../i18n/ns/common/ro'

interface ProviderMeta {
  id: AiProvider
  labelKey: 'provider_openai' | 'provider_anthropic' | 'provider_gemini' | 'provider_custom'
  hintKey: 'hint_openai' | 'hint_anthropic' | 'hint_gemini' | 'hint_custom'
  modelExamples: string[]
  needsBaseUrl?: boolean
}

// Sugestii de model per furnizor (text liber — userul poate scrie orice model
// suportat de contul lui). Evităm intenționat referințe hard-codate la modelul
// intern al platformei.
const PROVIDERS: ProviderMeta[] = [
  {
    id: 'openai',
    labelKey: 'provider_openai',
    hintKey: 'hint_openai',
    modelExamples: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'anthropic',
    labelKey: 'provider_anthropic',
    hintKey: 'hint_anthropic',
    modelExamples: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
  },
  {
    id: 'gemini',
    labelKey: 'provider_gemini',
    hintKey: 'hint_gemini',
    modelExamples: ['gemini-1.5-flash', 'gemini-1.5-pro'],
  },
  {
    id: 'custom',
    labelKey: 'provider_custom',
    hintKey: 'hint_custom',
    modelExamples: ['model-name'],
    needsBaseUrl: true,
  },
]

// Model implicit per furnizor când userul nu completează nimic (flux simplu,
// cheie gestionată de platformă). Oglindește `DEFAULT_MODEL` din ai-proxy.js —
// backend-ul cere un model ne-gol, așa că trimitem unul rezonabil.
const DEFAULT_MODEL: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-1.5-flash',
  custom: '',
}

// Prețurile sunt BANI (rămân ca azi, în lei); numărul de tokens se formatează
// în limba personalului (în română exact „100.000 tokens”, ca înainte).
const CREDIT_PACKS: { id: 'small' | 'medium' | 'large'; tokens: number; price: string }[] = [
  { id: 'small', tokens: 100_000, price: '19 lei' },
  { id: 'medium', tokens: 500_000, price: '79 lei' },
  { id: 'large', tokens: 2_000_000, price: '249 lei' },
]

type AiMsgKey = 'err_customUrl' | 'err_customKey' | 'saved_byo' | 'saved_platform' | 'err_save' | 'err_buy'

// Mesajul de sub formular, ca DATĂ: cheia (textul propriu sau rezerva) și,
// pentru un eșec al serverului, cauza.
type AiMsg = { kind: 'ok' | 'err'; key: AiMsgKey; cause?: unknown }

// `code`-urile contractului `{ error, code }` (netlify/functions/lib/aiErrors.js)
// cu text propriu în celelalte limbi. În română serverul își trimite textul.
const AI_ERROR_KEYS = {
  network: 'err_network',
  auth_missing: 'err_auth',
  auth_invalid: 'err_auth',
  forbidden: 'err_forbidden',
  rate_limited: 'err_rate_limited',
  server_config: 'err_unavailable',
  service_unavailable: 'err_unavailable',
  server_error: 'err_unavailable',
  model_missing: 'err_model_missing',
  base_url_required: 'err_customUrl',
  base_url_rejected: 'err_base_url',
  api_key_invalid: 'err_api_key_invalid',
  api_key_too_long: 'err_api_key_invalid',
  api_key_required: 'err_api_key_required',
  checkout_failed: 'err_checkout_failed',
} as const

function codeOf(err: unknown): string | null {
  if (err == null || typeof err !== 'object') return null
  const c = (err as { code?: unknown }).code
  return typeof c === 'string' && c ? c : null
}

function aiMsgText(m: AiMsg, tr: Translator<typeof aiSettingsRo>, tc: Translator<typeof commonRo>): string {
  if (m.cause === undefined) return tr.t(m.key)
  const code = codeOf(m.cause)
  if (tc.lang !== 'ro' && code && Object.prototype.hasOwnProperty.call(AI_ERROR_KEYS, code)) {
    return tr.t(AI_ERROR_KEYS[code as keyof typeof AI_ERROR_KEYS])
  }
  return describeStaffError(m.cause, tc, { fallback: tr.t(m.key) })
}

// Starea citirii configurației salvate (tiparul LoyaltySettingsCard). Formularul
// și „Salvează" există DOAR pe 'ready': pe 'error' nu știm ce e salvat, iar
// valorile implicite (OpenAI, activ, fără cheie) scrise peste rândul real ar
// șterge cheia BYO (ai-config.js o golește când se schimbă furnizorul).
type LoadState = 'loading' | 'ready' | 'error'

export default function AiSettingsTab({
  restaurantId,
  readOnly = false,
}: {
  restaurantId: string
  // Fondatorul în vizită (founder view): ai-proxy și plata creditelor verifică
  // membership-ul REAL al apelantului, deci „Salvează" și „Cumpără" i-ar da doar
  // erori. Vede configurația, nu o schimbă.
  readOnly?: boolean
}) {
  const tr = useT(aiSettingsNs)
  const tc = useT(commonNs)
  // Numerele (tokens, credite): în română `toLocaleString('ro-RO')`, ca înainte.
  const locale = staffLocale(tr.lang)
  const num = (n: number): string => n.toLocaleString(locale)
  const isMobile = useIsMobile()
  const [provider, setProvider] = useState<AiProvider>('openai')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [hasKey, setHasKey] = useState(false) // există deja o cheie salvată
  const [showAdvanced, setShowAdvanced] = useState(false) // secțiunea „Avansat (opțional)"
  const [quota, setQuota] = useState<AiQuota | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<AiMsg | null>(null)
  const [buying, setBuying] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadState('loading')
    // O cheie tastată pentru restaurantul A nu are voie să plece la B, iar
    // mesajul lui A („Configurație salvată”, o eroare de plată) nu are ce căuta
    // sub B sau după un „Reîncearcă” reușit (recenzia CodeRabbit pe #353).
    setApiKey('')
    setMsg(null)
    async function load(): Promise<void> {
      const [cfgRes, q] = await Promise.all([
        // Respingerea (eroare de citire SAU de transport) devine stare, nu
        // „fără rând": doar un răspuns reușit deblochează formularul.
        getAiConfig(restaurantId).then(
          (cfg) => ({ ok: true as const, cfg }),
          () => ({ ok: false as const }),
        ),
        // Cota e independentă: o citire eșuată a config-ului nu ascunde
        // consumul, iar o cotă indisponibilă nu blochează config-ul.
        getAiQuota(restaurantId).catch(() => null),
      ])
      // Răspuns întârziat pentru restaurantul de dinainte (selectorul din
      // DashboardPage schimbă restaurantul fără să demonteze tab-ul).
      if (cancelled) return
      setQuota(q)
      if (!cfgRes.ok) {
        setLoadState('error')
        return
      }
      const cfg = cfgRes.cfg
      if (cfg) {
        setProvider(cfg.provider)
        setModel(cfg.model)
        setBaseUrl(cfg.base_url ?? '')
        setEnabled(cfg.enabled)
        setHasKey(true) // dacă există config, presupunem că are cheie (nu o citim)
      } else {
        // Fără rând salvat = starea implicită REALĂ din ai-proxy: asistentul e
        // ACTIV pe cheia platformei. Toggle-ul reflectă asta, altfel ar apărea
        // debifat deși AI-ul funcționează. Resetul e COMPLET: altfel furnizorul,
        // modelul și „salvată ✓" ale restaurantului anterior rămâneau pe ecran
        // și plecau la „Salvează" pentru acesta.
        setProvider('openai')
        setModel('')
        setBaseUrl('')
        setHasKey(false)
        setEnabled(true)
      }
      setLoadState('ready')
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [restaurantId, reloadKey])

  const meta = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0]

  async function handleSave() {
    setMsg(null)
    // Furnizorul personalizat rămâne strict: are nevoie de propriul endpoint https.
    if (meta.needsBaseUrl && !/^https:\/\//i.test(baseUrl.trim())) {
      setMsg({ kind: 'err', key: 'err_customUrl' })
      return
    }
    // Cheia proprie e obligatorie DOAR pentru furnizorul personalizat (nu avem
    // cheie de platformă pentru un endpoint arbitrar). Pentru ceilalți furnizori
    // platforma acoperă cheia — salvarea merge fără să introduci nimic.
    if (meta.needsBaseUrl && !hasKey && !apiKey.trim()) {
      setMsg({ kind: 'err', key: 'err_customKey' })
      return
    }
    // Dacă userul n-a atins „Avansat", trimitem provider-ul implicit ('openai')
    // + model default (server-side) și fără cheie — platforma acoperă restul.
    setSaving(true)
    try {
      const res = await saveAiConfig({
        restaurant_id: restaurantId,
        provider,
        // Model completat de user, altfel default-ul furnizorului (backend-ul
        // cere un model ne-gol; la runtime alege oricum DEFAULT_MODEL).
        model: model.trim() || DEFAULT_MODEL[provider],
        base_url: meta.needsBaseUrl ? baseUrl.trim() : null,
        api_key: apiKey.trim() || undefined,
        enabled,
      })
      if (res.config.key_masked) setHasKey(true)
      setApiKey('')
      setMsg({ kind: 'ok', key: res.config.key_masked ? 'saved_byo' : 'saved_platform' })
    } catch (e) {
      setMsg({ kind: 'err', key: 'err_save', cause: e })
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
      setMsg({ kind: 'err', key: 'err_buy', cause: e })
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
    boxSizing: 'border-box' as const,
  }

  if (loadState === 'loading') return <div style={{ color: D.t2, padding: 20 }}>{tr.t('loading')}</div>

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ color: D.t2, fontSize: '0.9rem', lineHeight: 1.5, marginBottom: 24 }}>
        {tr.t('intro')}
      </p>

      {/* Cotă */}
      {quota && (
        <div style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 14, padding: 18, marginBottom: 22 }}>
          <div style={{ fontSize: '0.72rem', color: D.t3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12, fontWeight: 600 }}>
            {tr.t('quota_title')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ color: D.t1, fontSize: '1.1rem', fontWeight: 600 }}>
              {num(quota.used_tokens)} <span style={{ color: D.t2, fontSize: '0.85rem', fontWeight: 400 }}>{tr.t('quota_included', { n: num(quota.included_tokens) })}</span>
            </span>
            {quota.credit_balance > 0 && (
              <span style={{ color: D.gold, fontSize: '0.82rem' }}>
                {tr.t('quota_credits', { n: num(quota.credit_balance) })}
              </span>
            )}
          </div>
          <div style={{ height: 6, background: D.s3, borderRadius: 3, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                borderRadius: 3,
                width: `${Math.min(100, Math.round((quota.used_tokens / Math.max(1, quota.included_tokens)) * 100))}%`,
                // Amber DOAR când chiar nu mai are ce consuma (cotă inclusă 0 ȘI
                // fără credite) — aliniat cu textul de avertizare de mai jos.
                background: quota.included_remaining === 0 && quota.credit_balance === 0 ? D.amber : D.gold,
                transition: 'width .4s',
              }}
            />
          </div>
          {quota.included_remaining === 0 && quota.credit_balance === 0 && (
            <p style={{ color: D.amber, fontSize: '0.8rem', marginTop: 10, marginBottom: 0 }}>
              {tr.t('quota_exhausted')}
            </p>
          )}
        </div>
      )}

      {/* Config formular — DOAR pe 'ready'. Pe 'error' formularul implicit ar
          minți (bifa „Activează" pentru un local care a dezactivat AI-ul) și un
          „Salvează" ar suprascrie rândul real, cu tot cu cheia BYO. */}
      {loadState === 'error' ? (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            background: D.redA,
            border: `1px solid ${D.red}`,
            borderRadius: 14,
            padding: 18,
            marginBottom: 22,
            fontSize: '0.85rem',
            color: D.t1,
          }}
        >
          <span>{tr.t('load_error')}</span>
          <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            {tc.t('retry')}
          </Button>
        </div>
      ) : (
      <div style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 14, padding: 18, marginBottom: 22 }}>
        {/* Toggle principal — singurul lucru necesar pentru non-tehnici */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 8 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 18, height: 18, accentColor: D.gold }} />
          <span style={{ color: D.t1, fontSize: '0.88rem', fontWeight: 600 }}>{tr.t('enable')}</span>
        </label>
        <p style={{ color: D.t2, fontSize: '0.8rem', lineHeight: 1.5, margin: '0 0 4px 28px' }}>
          {tr.t('enable_desc')}
          {quota && ` ${tr.t('enable_quota', { n: num(quota.included_tokens) })}`}
        </p>

        {/* Avansat (opțional) — pliat implicit; câmpurile BYO rămân neatinse */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="pressable"
          style={{
            background: 'transparent',
            border: 'none',
            color: D.t3,
            cursor: 'pointer',
            fontFamily: 'DM Sans,sans-serif',
            fontSize: '0.8rem',
            fontWeight: 600,
            padding: '10px 0 0 28px',
            display: 'block',
          }}
        >
          {/* Glifa e pur decorativă — starea reală o comunică aria-expanded. */}
          <span aria-hidden="true">{showAdvanced ? '▾' : '▸'}</span> {tr.t('advanced')}
        </button>

        {showAdvanced && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${D.border}` }}>
            <p style={{ color: D.t2, fontSize: '0.8rem', lineHeight: 1.5, marginTop: 0, marginBottom: 16 }}>
              {tr.t('advanced_desc')}
            </p>

            <label style={label}>{tr.t('provider')}</label>
            {/* O coloană pe mobil — eticheta „Personalizat (OpenAI-compatible)" nu încape pe două. */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8, marginBottom: 16 }}>
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
                      minHeight: 44, // țintă touch confortabilă
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
                    {tr.t(p.labelKey)}
                  </button>
                )
              })}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={label}>{tr.t('model')}</label>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={tr.t('model_placeholder', { examples: meta.modelExamples.join(', ') })}
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
                <label style={label}>{tr.t('baseUrl')}</label>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={tr.t('baseUrl_placeholder')}
                  style={input}
                />
              </div>
            )}

            <div style={{ marginBottom: 4 }}>
              <label style={label}>{tr.t('apiKey')} {hasKey && <span style={{ color: D.green, textTransform: 'none', letterSpacing: 0 }}>{tr.t('apiKey_saved')}</span>}</label>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type="password"
                autoComplete="off"
                placeholder={hasKey ? tr.t('apiKey_placeholderSaved') : tr.t('apiKey_placeholderEmpty')}
                style={input}
              />
              <p style={{ color: D.t2, fontSize: '0.75rem', marginTop: 6, marginBottom: 0 }}>{tr.t(meta.hintKey)}</p>
            </div>
          </div>
        )}
      </div>
      )}

      {msg && (
        <div
          role="alert"
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
          {aiMsgText(msg, tr, tc)}
        </div>
      )}

      {/* „Salvează" nu există în afara lui 'ready' (vezi LoadState). */}
      {loadState === 'ready' && (readOnly ? (
        <p style={{ color: D.t2, fontSize: '0.82rem', lineHeight: 1.5 }}>
          {tr.t('readonly_note')}
        </p>
      ) : (
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
        {saving ? tr.t('saving') : tr.t('save')}
      </button>
      ))}

      {/* Top-up credite (Faza F) */}
      {!readOnly && (
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontFamily: 'Fraunces,serif', fontSize: '1.1rem', fontWeight: 600, color: D.t1, marginBottom: 6 }}>
          {tr.t('credits_title')}
        </h2>
        <p style={{ color: D.t2, fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 16 }}>
          {tr.t('credits_desc')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 12 }}>
          {CREDIT_PACKS.map((pack) => (
            <div key={pack.id} style={{ background: D.s2, border: `1px solid ${D.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ color: D.t1, fontSize: '0.95rem', fontWeight: 600, marginBottom: 4 }}>{tr.t('pack_tokens', { n: num(pack.tokens) })}</div>
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
                  minHeight: 44, // țintă touch confortabilă
                  fontFamily: 'DM Sans,sans-serif',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: buying ? 'default' : 'pointer',
                  opacity: buying && buying !== pack.id ? 0.5 : 1,
                }}
              >
                {buying === pack.id ? tr.t('opening') : tr.t('buy')}
              </button>
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}
