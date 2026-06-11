import { useCallback, useId, useRef } from 'react'
import '../../styles/components/tabs.css'

export interface TabItem {
  /** Identificator stabil al tabului. */
  id: string
  label: string
  /** Element afișat când tabul e activ. */
  content: React.ReactNode
  /** Iconiță opțională înaintea label-ului. */
  icon?: React.ReactNode
  disabled?: boolean
}

interface TabsProps {
  items: TabItem[]
  /** Id-ul tabului activ (controlled). */
  value: string
  onChange: (id: string) => void
  /** Stil vizual. "underline" (default) sau "segmented" (pill-style). */
  variant?: 'underline' | 'segmented'
  /** Sub-text aria-label pe tablist (pentru a11y). */
  ariaLabel?: string
}

export function Tabs({ items, value, onChange, variant = 'underline', ariaLabel }: TabsProps) {
  const baseId = useId()
  const tablistRef = useRef<HTMLDivElement | null>(null)

  // Navigare keyboard pe tablist: ←/→ schimbă focus, Home/End sare la
  // primul/ultimul. Activarea (Enter/Space) se face nativ pe button.
  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
      if (!keys.includes(e.key)) return
      e.preventDefault()
      const enabled = items.filter((i) => !i.disabled)
      if (enabled.length === 0) return
      const currentIdx = enabled.findIndex((i) => i.id === value)
      let nextIdx = currentIdx
      if (e.key === 'ArrowLeft') {
        nextIdx = currentIdx <= 0 ? enabled.length - 1 : currentIdx - 1
      } else if (e.key === 'ArrowRight') {
        nextIdx = (currentIdx + 1) % enabled.length
      } else if (e.key === 'Home') {
        nextIdx = 0
      } else if (e.key === 'End') {
        nextIdx = enabled.length - 1
      }
      const nextId = enabled[nextIdx].id
      onChange(nextId)
      const btn = tablistRef.current?.querySelector<HTMLElement>(`[data-tab-id="${nextId}"]`)
      btn?.focus()
    },
    [items, value, onChange],
  )

  const activeItem = items.find((i) => i.id === value)

  return (
    <div className={`tabs tabs--${variant}`}>
      <div
        ref={tablistRef}
        role="tablist"
        aria-label={ariaLabel}
        className="tabs__list"
        onKeyDown={handleKey}
      >
        {items.map((item) => {
          const selected = item.id === value
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-controls={`${baseId}-panel-${item.id}`}
              aria-selected={selected}
              data-tab-id={item.id}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={`tabs__tab ${selected ? 'tabs__tab--active' : ''}`}
              onClick={() => onChange(item.id)}
            >
              {item.icon && <span className="tabs__icon">{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>
      {activeItem && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeItem.id}`}
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
          className="tabs__panel"
        >
          {activeItem.content}
        </div>
      )}
    </div>
  )
}
