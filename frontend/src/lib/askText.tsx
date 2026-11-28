import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n'

// === 应用内文本输入框 ===
// macOS 的 WKWebView 没有实现 runJavaScriptTextInputPanel，window.prompt() 会直接返回 null
// 且不弹任何 UI（Wails v2 未提供该代理），导致「艺术字 / 行高 / 列宽 / 重命名」等按钮点了没反应。
// 这里用 React 实现一个等效输入框，返回 Promise<string | null>，语义与 prompt 一致：
// 确定 → 输入值（可为空字符串），取消/Esc → null。

type Req = { message: string; defaultValue: string; resolve: (v: string | null) => void }

let notify: ((r: Req | null) => void) | null = null

export function askText(message: string, defaultValue = ''): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const host = notify
    if (!host) {
      // 宿主还没挂载（理论上不会发生）：退回原生 prompt
      resolve(typeof window !== 'undefined' ? window.prompt(message, defaultValue) : null)
      return
    }
    host({ message, defaultValue: defaultValue ?? '', resolve })
  })
}

export function AskTextHost() {
  const { t } = useI18n()
  const [req, setReq] = useState<Req | null>(null)
  const [val, setVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const reqRef = useRef<Req | null>(null)

  useEffect(() => {
    notify = (r) => { reqRef.current = r; setReq(r) }
    return () => { notify = null }
  }, [])

  useEffect(() => {
    if (!req) return
    setVal(req.defaultValue)
    const t = setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 30)
    return () => clearTimeout(t)
  }, [req])

  if (!req) return null

  const close = (v: string | null) => {
    const r = reqRef.current
    reqRef.current = null
    setReq(null)
    r?.resolve(v)
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.45)' }}
      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); close(null) }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="w-full max-w-sm rounded-xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-3 pb-1 text-sm" style={{ color: 'var(--color-text)' }}>
          {req.message}
        </div>
        <div className="px-4 pb-3">
          <input
            ref={inputRef}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // 阻止冒泡，避免被编辑器的全局快捷键（Delete/Esc/方向键）截走
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); close(val) }
              else if (e.key === 'Escape') { e.preventDefault(); close(null) }
            }}
            className="w-full px-2 py-1.5 text-sm rounded-md outline-none"
            style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)', border: '1px solid var(--color-border-strong)' }}
          />
        </div>
        <div className="px-3 py-2 flex justify-end gap-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={() => close(null)}
            className="px-3 py-1.5 text-xs rounded-md"
            style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text-secondary)' }}
          >{t('doc.cancel')}</button>
          <button
            onClick={() => close(val)}
            className="px-3 py-1.5 text-xs font-semibold rounded-md"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >{t('doc.ok')}</button>
        </div>
      </div>
    </div>
  )
}
