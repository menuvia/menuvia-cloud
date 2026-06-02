import '../../styles/components/skeleton.css'

type Variant = 'text' | 'title' | 'card' | 'circle' | 'table-row'

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: Variant
  /** Lățime custom (override variant). */
  width?: string | number
  /** Înălțime custom (override variant). */
  height?: string | number
  /** Câte instanțe să randeze (lista de skeletoane). */
  count?: number
}

export function Skeleton({
  variant = 'text',
  width,
  height,
  count = 1,
  className = '',
  style,
  ...rest
}: SkeletonProps) {
  const cls = `skeleton skeleton--${variant} ${className}`.trim()
  const mergedStyle: React.CSSProperties = {
    ...(width !== undefined ? { width } : null),
    ...(height !== undefined ? { height } : null),
    ...style,
  }

  if (count === 1) {
    return <div className={cls} style={mergedStyle} aria-hidden="true" {...rest} />
  }
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cls} style={mergedStyle} aria-hidden="true" />
      ))}
    </>
  )
}
