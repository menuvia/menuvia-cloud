import { cloneElement, isValidElement, useId, useState } from 'react'
import '../../styles/components/tooltip.css'

type Placement = 'top' | 'bottom' | 'left' | 'right'

interface TooltipProps {
  content: React.ReactNode
  placement?: Placement
  /** Întârziere afișare pe hover (ms). Default 300. */
  delay?: number
  /** Maxim caractere lățime. */
  maxWidth?: number
  /** Trigger — un singur copil cu props focusable (button / a / input).
   *  Adăugăm aria-describedby + ascultători hover/focus. */
  children: React.ReactElement
}

export function Tooltip({
  content,
  placement = 'top',
  delay = 300,
  maxWidth = 240,
  children,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const id = useId()

  // Timer pentru întârziere — un singur timer activ.
  let timer: ReturnType<typeof setTimeout> | null = null
  const show = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => setOpen(true), delay)
  }
  const hide = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    setOpen(false)
  }

  if (!isValidElement(children)) {
    console.warn('[Tooltip] children trebuie să fie un element React valid.')
    return <>{children}</>
  }

  // Atașăm handlerele pe copil — păstrăm eventualele handlere existente.
  const childProps = children.props as Record<string, unknown>
  const triggerProps = {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (e: React.MouseEvent) => {
      show()
      ;(childProps.onMouseEnter as ((e: React.MouseEvent) => void) | undefined)?.(e)
    },
    onMouseLeave: (e: React.MouseEvent) => {
      hide()
      ;(childProps.onMouseLeave as ((e: React.MouseEvent) => void) | undefined)?.(e)
    },
    onFocus: (e: React.FocusEvent) => {
      show()
      ;(childProps.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(e)
    },
    onBlur: (e: React.FocusEvent) => {
      hide()
      ;(childProps.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(e)
    },
  }

  return (
    <span className="tooltip-wrap">
      {cloneElement(children, triggerProps)}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`tooltip tooltip--${placement}`}
          style={{ maxWidth }}
        >
          {content}
        </span>
      )}
    </span>
  )
}
