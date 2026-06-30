import { useState, type CSSProperties } from 'react'

// ─────────────────────────────────────────────────────────────
// BlurImage — imagine cu blur-up: pornește blurată, devine clară la `onLoad`
// (clasa `.blur-up` + `.is-loaded` din global.css). Opțional afișează un
// placeholder skeleton (clasa `.skeleton` din skeleton.css) sub imagine cât
// timp se încarcă, ca să nu rămână un gol alb pe rețea lentă.
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

  const img = (
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      className={className ? `blur-up ${className}` : 'blur-up'}
      // Imaginile din cache pot fi deja `complete` la montare (fără event
      // `load`) — ref callback-ul le marchează imediat ca încărcate.
      ref={(el) => {
        if (el?.complete) {
          el.classList.add('is-loaded')
          if (!loaded) setLoaded(true)
        }
      }}
      onLoad={(e) => {
        e.currentTarget.classList.add('is-loaded')
        setLoaded(true)
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

  if (!skeleton) return img

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
      {img}
    </div>
  )
}

export default BlurImage
