import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

const OPEN_EVENT = 'karu-pdf:dropdown-open'

export type DropdownItem = {
  type?: 'item'
  label: string
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  onSelect(): void
} | {
  type: 'separator'
}

interface Props {
  label: string
  items: readonly DropdownItem[]
  disabled?: boolean
  className?: string
  buttonClassName?: string
  menuBar?: boolean
  children?: ReactNode
  testId?: string
}

function enabledButtons(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')] : []
}

export function Dropdown({ label, items, disabled, className = '', buttonClassName = '', menuBar = false, children, testId }: Props) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const [openAbove, setOpenAbove] = useState(false)
  const [menuMaxHeight, setMenuMaxHeight] = useState<number | null>(null)

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const openMenu = (focus: 'first' | 'last' | 'none' = 'none') => {
    if (disabled) return
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
    setOpen(true)
    if (focus !== 'none') requestAnimationFrame(() => {
      const buttons = enabledButtons(menuRef.current)
      ;(focus === 'last' ? buttons.at(-1) : buttons[0])?.focus()
    })
  }

  useEffect(() => {
    const closeForOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpen(false)
    }
    window.addEventListener(OPEN_EVENT, closeForOther)
    return () => window.removeEventListener(OPEN_EVENT, closeForOther)
  }, [id])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    const onViewportChange = () => close()
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    setAlignRight(false)
    setOpenAbove(false)
    setMenuMaxHeight(null)
    const frame = requestAnimationFrame(() => {
      const rect = menuRef.current?.getBoundingClientRect()
      const triggerRect = triggerRef.current?.getBoundingClientRect()
      if (!rect || !triggerRect) return
      setAlignRight(rect.right > window.innerWidth - 8)
      const spaceBelow = window.innerHeight - triggerRect.bottom - 8
      const spaceAbove = triggerRect.top - 8
      const shouldOpenAbove = rect.height > spaceBelow && spaceAbove > spaceBelow
      setOpenAbove(shouldOpenAbove)
      setMenuMaxHeight(Math.max(0, Math.floor(shouldOpenAbove ? spaceAbove : spaceBelow)))
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  const moveMenuBar = (direction: -1 | 1) => {
    const bar = rootRef.current?.closest('[role="menubar"]')
    const triggers = bar ? [...bar.querySelectorAll<HTMLButtonElement>('[data-dropdown-trigger]')] : []
    const current = triggerRef.current ? triggers.indexOf(triggerRef.current) : -1
    if (current < 0 || triggers.length === 0) return
    const next = triggers[(current + direction + triggers.length) % triggers.length]
    next.focus()
    if (open) next.click()
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault()
      openMenu('first')
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu('last')
    } else if (menuBar && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      moveMenuBar(event.key === 'ArrowLeft' ? -1 : 1)
    }
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = enabledButtons(menuRef.current)
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const offset = event.key === 'ArrowDown' ? 1 : -1
      buttons[(current + offset + buttons.length) % buttons.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault(); buttons[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault(); buttons.at(-1)?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); buttons[current]?.click()
    } else if (menuBar && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      moveMenuBar(event.key === 'ArrowLeft' ? -1 : 1)
    } else if (event.key === 'Tab') {
      close()
    }
  }

  return (
    <div ref={rootRef} className={`dropdown ${open ? 'open ' : ''}${className}`.trim()} data-testid={testId}>
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        data-dropdown-trigger
        disabled={disabled}
        onClick={() => open ? close() : openMenu()}
        onKeyDown={onTriggerKeyDown}
      >{children ?? label}</button>
      {open && <div
        ref={menuRef}
        className={`dropdown-menu${alignRight ? ' align-right' : ''}${openAbove ? ' open-above' : ''}`}
        style={menuMaxHeight === null ? undefined : { maxHeight: menuMaxHeight }}
        role="menu"
        aria-label={label}
        onKeyDown={onMenuKeyDown}
      >
        {items.map((item, index) => item.type === 'separator'
          ? <div key={`separator-${index}`} className="dropdown-separator" role="separator" />
          : <button
            key={`${item.label}-${index}`}
            type="button"
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked === undefined ? undefined : item.checked}
            disabled={item.disabled}
            onClick={() => { close(); item.onSelect() }}
          >
            <span className="dropdown-check">{item.checked === undefined ? '' : item.checked ? '✓' : ''}</span>
            <span className="dropdown-label">{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>)}
      </div>}
    </div>
  )
}
