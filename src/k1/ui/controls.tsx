import { copy } from '../i18n'
import { AnimatePresence, motion } from 'motion/react'
import { ReactNode, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Check, ChevronDown, X } from './icons'
import { ease } from '../../lib/motion'
import { Popover } from './overlay'

export type SelectOption<T extends string> = { value: T; label: string; hint?: string; group?: string }

export function Select<T extends string>({
  value,
  options,
  placeholder,
  onChange,
  label,
  id,
  className,
}: {
  value: T | null
  options: SelectOption<T>[]
  placeholder: string
  onChange: (value: T) => void
  label?: string
  id?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const index = Math.max(0, options.findIndex((option) => option.value === value))
    setActive(index)
    requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }))
  }, [open])

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  const onListKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(options.length - 1, index + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)) }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0) }
    else if (event.key === 'End') { event.preventDefault(); setActive(options.length - 1) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active) }
    else if (event.key === 'Tab') setOpen(false)
  }

  let lastGroup: string | undefined
  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={`k1-select${className ? ` ${className}` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onClick={() => setOpen((next) => !next)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
        }}
      >
        <span className={selected ? 'k1-select__value' : 'k1-select__placeholder'}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="k1-select__chevron" />
      </button>
      <Popover open={open} anchorRef={buttonRef} onClose={() => setOpen(false)} matchWidth>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${listId}-${active}`}
          className="k1-listbox"
          onKeyDown={onListKey}
        >
          {options.map((option, index) => {
            const heading = option.group && option.group !== lastGroup ? option.group : null
            lastGroup = option.group
            return (
              <div key={option.value} role="presentation">
                {heading && <div className="k1-listbox__group" role="presentation">{heading}</div>}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  className={`k1-listbox__option${index === active ? ' is-active' : ''}`}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                >
                  <span>
                    {option.label}
                    {option.hint && <small>{option.hint}</small>}
                  </span>
                  {option.value === value && <Check size={14} strokeWidth={1.75} aria-hidden="true" />}
                </div>
              </div>
            )
          })}
        </div>
      </Popover>
    </>
  )
}

export type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; tone?: 'danger'; hint?: string }

export function Menu({ trigger, items, label, align = 'end', header }: {
  trigger: (props: { ref: React.Ref<HTMLButtonElement>; onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode
  items: MenuItem[]
  label: string
  align?: 'start' | 'end'
  header?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus())
  }, [open])

  const onKey = (event: KeyboardEvent) => {
    const nodes = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const index = nodes.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown') { event.preventDefault(); nodes[(index + 1) % nodes.length]?.focus() }
    if (event.key === 'ArrowUp') { event.preventDefault(); nodes[(index - 1 + nodes.length) % nodes.length]?.focus() }
    if (event.key === 'Tab') setOpen(false)
  }

  return (
    <>
      {trigger({ ref: anchorRef, onClick: () => setOpen((next) => !next), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      <Popover open={open} anchorRef={anchorRef} onClose={() => setOpen(false)} align={align}>
        <div ref={menuRef} role="menu" aria-label={label} className="k1-menu" onKeyDown={onKey}>
          {header}
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`k1-menu__item${item.tone === 'danger' ? ' is-danger' : ''}`}
              onClick={() => {
                setOpen(false)
                anchorRef.current?.focus()
                item.onSelect()
              }}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.hint && <small>{item.hint}</small>}
            </button>
          ))}
        </div>
      </Popover>
    </>
  )
}

export type ToastMessage = { id: number; title: string; body: string; tone?: 'success' | 'error' }

export function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div className="k1-toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            className={`k1-toast${toast.tone === 'error' ? ' is-error' : ''}`}
            initial={{ opacity: 0, y: '-100%' }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: '-100%' }}
            transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <button type="button" className="k1-toast__close" aria-label={copy().common.dismissNotification} onClick={() => onDismiss(toast.id)}>
              <X size={10} strokeWidth={2} />
            </button>
            {toast.tone === 'error'
              ? <X size={16} strokeWidth={2} className="k1-toast__icon" aria-hidden="true" />
              : (
                <svg className="k1-toast__icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="8" fill="currentColor" />
                  <path d="M4.8 8.2l2.1 2.1 4.3-4.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            <div>
              <strong>{toast.title}</strong>
              <p>{toast.body}</p>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const counter = useRef(0)
  const dismiss = (id: number) => setToasts((list) => list.filter((toast) => toast.id !== id))
  const push = (toast: Omit<ToastMessage, 'id'>) => {
    const id = ++counter.current
    setToasts((list) => [...list, { ...toast, id }])
    window.setTimeout(() => dismiss(id), 4200)
  }
  return { toasts, push, dismiss }
}

export function Skeleton({ width, height, radius, className, style }: {
  width?: number | string
  height: number | string
  radius?: number | string
  className?: string
  style?: CSSProperties
}) {
  return <span className={`k1-skel${className ? ` ${className}` : ''}`} style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" />
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="k1-spinner" style={{ width: size, height: size }} aria-hidden="true" />
}
