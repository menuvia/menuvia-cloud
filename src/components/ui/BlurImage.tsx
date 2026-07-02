import { useState, type CSSProperties } from 'react'

// ─────────────────────────────────────────────────────────────
// BlurImage — imagine cu blur-up: pornește blurată, devine clară la `onLoad`
// (clasa `.blur-up` + `.is-loaded` din global.css). Opțional afișează un
// placeholder skeleton (clasa `.skeleton` din skeleton.css) sub imagine cât
// timp se încarcă, ca să nu rămână un gol alb pe rețea lentă.
//
// La eroare de încărcare (404 / imagine ștearsă din storage / rețea) NU lăsăm
// iconița „broken image" a browserului: randăm un fallback neutru cu inițiala
// din `alt` (aceeași idee ca monograma din ProductCard/ProductGridCard pentru
// produse fără imagine).
//
// Extras din PublicMenuPage (era hand-rolled) ca primitivă reutilizabilă pe
// toate suprafețele de meniu (carduri, hero, sheet-uri). Doar transform/opacity
// → respectă reduced-motion prin global.css.
// ─────────────────────────────────────────────────────────────
export function BlurImage({
  src,
  alt,
  style,
  className,
  aspectRatio,
  skeleton = false,
  loading = 'lazy',
}: {
  src: string
  alt: string
  style?: CSSProperties
  className?: string
  /** ex. '1 / 1', '16 / 9' — previne CLS și forțează crop consistent */
  aspectRatio?: string
  /** afișează un fundal skeleton cât timp imaginea se încarcă */
  skeleton?: boolean
  loading?: 'lazy' | 'eager'
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // Fallback pe imagine eșuată: fundal neutru + inițiala din alt (monogramă).
  // Nu avem tema aici (componenta e generică), deci folosim un gri translucid
  // care funcționează și pe fundal light, și pe dark; textul moștenește culoarea.
  const initial = (alt.trim().charAt(0) || '•').toUpperCase()
  const fallback = (
    <div
      role="img"
      aria-label={alt}
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: 'rgba(127, 127, 127, 0.12)',
        ...(aspectRatio ? { aspectRatio } : null),
        ...style,
      }}
    >
      <span aria-hidden style={{ fontSize: 28, fontWeight: 600, opacity: 0.4, lineHeight: 1 }}>
        {initial}
      </span>
    </div>
  )

  const img = (
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      className={className ? `blur-up ${className}` : 'blur-up'}
      // Imaginile din cache pot fi deja `complete` la montare (fără event
      // `load`) — ref callback-ul le marchează imediat ca încărcate. `complete`
      // e true ȘI pentru imagini sparte → cerem `naturalWidth > 0` ca să nu
      // ascundem skeleton-ul pentru o imagine eșuată.
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0) {
          el.classList.add('is-loaded')
          if (!loaded) setLoaded(true)
        }
      }}
      onLoad={(e) => {
        e.currentTarget.classList.add('is-loaded')
        setLoaded(true)
      }}
      // Imagine eșuată (404/rețea): oprim skeleton-ul și trecem pe fallback
      // (altfel ar rămâne vizibilă iconița „broken image" a browserului).
      onError={() => {
        setLoaded(true)
        setFailed(true)
      }}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        ...(aspectRatio ? { aspectRatio } : null),
        ...style,
      }}
    />
  )

  const content = failed ? fallback : img

  if (!skeleton) return content

  // Wrapper cu skeleton sub imagine (dispare când imaginea s-a încărcat).
  return (
    <div
      className={!loaded ? 'skeleton' : undefined}
      style={{
        position: 'relative',
        width: '100%',
        ...(aspectRatio ? { aspectRatio } : null),
        ...style,
        overflow: 'hidden',
      }}
    >
      {content}
    </div>
  )
}

export default BlurImage
