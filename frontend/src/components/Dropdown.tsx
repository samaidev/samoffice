import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'

export interface DropdownOption {
  label: string
  value: string
  color?: string
}

interface DropdownProps {
  value: string
  onChange: (value: string) => void
  options: DropdownOption[]
  className?: string
  style?: CSSProperties
  title?: string
  placeholder?: string
  testId?: string
  // 可编辑模式：在触发框内渲染一个文本输入框（保留自由输入），右侧 ▾ 按钮点击弹出菜单，
  // 依然规避 Wails/WebView2 下原生 <input list> / <select> 的二次点击、需三次才弹出问题。
  editable?: boolean
  inputValue?: string
  onInputChange?: (raw: string) => void
  onInputBlur?: () => void
  inputMode?: 'numeric' | 'text'
}

// 自定义下拉组件：用 div 模拟 <select>，规避 Wails/WebView2 下原生 <select>
// 二次点击闪烁、需三次才弹出的平台问题。菜单通过 portal + fixed 定位，
// 不会被 ribbon 或 modal 的 overflow 裁剪。
export function Dropdown({ value, onChange, options, className, style, title, placeholder, testId, editable, inputValue, onInputChange, onInputBlur, inputMode }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const boxRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // 可编辑输入框的本地缓冲：输入过程中以缓冲为准，避免输入 "1.5" 时
  // 中间态 "1." 被实时规整成 "1" 而打断小数输入；失焦或外部更新时再同步。
  const [inputBuffer, setInputBuffer] = useState(inputValue ?? '')
  const inputFocused = useRef(false)
  useEffect(() => { if (!inputFocused.current) setInputBuffer(inputValue ?? '') }, [inputValue])
  const selected = options.find(o => o.value === value)

  const updateCoords = () => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCoords({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 140) })
  }

  useLayoutEffect(() => {
    if (open) updateCoords()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (boxRef.current && boxRef.current.contains(t)) return
      if (triggerRef.current && triggerRef.current.contains(t)) return
      if (menuRef.current && menuRef.current.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = () => updateCoords()
    const onResize = () => updateCoords()
    // 用 click 阶段与触发器 onClick 保持一致，避免 mousedown(外部关闭) 与 click(切换) 相位错位导致闪烁/需多次点击
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <>
      {editable ? (
        <div
          ref={boxRef}
          title={title}
          data-testid={testId}
          className={className}
          style={{ display: 'flex', alignItems: 'center', ['--wails-draggable' as any]: 'no-drag', ...style }}
        >
          <input
            type="text"
            value={inputBuffer}
            placeholder={placeholder}
            inputMode={inputMode}
            onFocus={() => { inputFocused.current = true }}
            onChange={(e) => { setInputBuffer(e.target.value); onInputChange?.(e.target.value) }}
            onKeyDown={(e) => {
              // 阻止按键冒泡到 ProseMirror 的原生 document 监听，否则输入会被当作正文写入编辑器
              e.nativeEvent.stopImmediatePropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            onKeyUp={(e) => { e.nativeEvent.stopImmediatePropagation() }}
            onInput={(e) => { e.nativeEvent.stopImmediatePropagation() }}
            onBlur={() => { inputFocused.current = false; onInputBlur?.() }}
            className="dropdown-input"
            style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: 'inherit', outline: 'none', fontSize: 'inherit', textAlign: 'left' }}
          />
          <button
            ref={triggerRef}
            type="button"
            title={title}
            onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', color: 'inherit', fontSize: '9px', opacity: 0.7, flexShrink: 0 }}
          >▾</button>
        </div>
      ) : (
      <button
        ref={triggerRef}
        type="button"
        title={title}
        data-testid={testId}
        className={className}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ['--wails-draggable' as any]: 'no-drag', ...style }}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>{selected ? selected.label : (placeholder ?? '')}</span>
        <span style={{ fontSize: '9px', opacity: 0.7, marginLeft: 4, flexShrink: 0 }}>▾</span>
      </button>
      )}
      {open && createPortal(
        <div
          ref={menuRef}
          className="ribbon-popup"
          style={{ position: 'fixed', top: coords.top, left: coords.left, minWidth: coords.width, maxHeight: 280, overflowY: 'auto', zIndex: 9999 } as CSSProperties}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(o.value); setOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs"
              style={{ color: 'var(--color-text)', whiteSpace: 'nowrap', background: o.value === value ? 'var(--color-bg-alt)' : 'transparent', textAlign: 'left' } as CSSProperties}
            >
              {o.color && <span style={{ width: 12, height: 12, borderRadius: 2, background: o.color, border: '1px solid var(--color-border)', flexShrink: 0 }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}
