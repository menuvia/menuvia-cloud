// ─────────────────────────────────────────────────────────────
// marketing.ts — paleta caldă de marketing (landing + pricing),
// distinctă de `D` (dashboard, lib/constants.ts). Doar constante și
// funcții pure — componentele React stau separat (regula
// react-refresh/only-export-components).
// ─────────────────────────────────────────────────────────────

// ── Marketing palette (landing + pricing) — cald, premium, NU dashboard ──
export const MKT = {
  bg: '#FAF9F6', // off-white warm — NOT pure white, easier on eyes
  surface: '#FFFFFF', // cards pure white
  surface2: '#F5F1EA', // subtle differentiation for sections
  text: '#1A1208', // near-black warm
  text2: '#5C4A2A', // body text
  // AA: #9A8C7A pe bg/surface = ~3.1:1 (sub 4.5). Întunecat la ~5.9:1.
  text3: '#6E5F4A',
  border: '#E8E0D2', // subtle warm border
  accent: '#C8963C', // gold — RESERVED for primary CTA only
  // Text închis pe auriu: alb pe #C8963C = 2.66:1 (pică AA). Aurul brand rămâne
  // viu, dar textul de pe butoanele aurii e închis (~8:1, look premium).
  onAccent: '#241A0A',
  accentSoft: '#FAF3E5', // accent background (for badges)
  success: '#2D8659',
  successSoft: '#E8F2EC',
}

// VITE_WHATSAPP_NUMBER e numărul fondatorului (format internațional fără +,
// ex: 40751234567). Lipsa env var → întoarce null → CTA-urile WhatsApp sunt
// ascunse complet (fail-safe pentru preview/staging unde nu vrem să trimitem
// trafic real către un număr de prod).
export function whatsappUrl(prefilledText: string): string | null {
  const number = import.meta.env.VITE_WHATSAPP_NUMBER
  if (!number || typeof number !== 'string' || !number.trim()) return null
  return `https://wa.me/${number.trim()}?text=${encodeURIComponent(prefilledText)}`
}
