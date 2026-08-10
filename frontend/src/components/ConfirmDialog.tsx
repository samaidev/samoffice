import { useEffect, useRef } from 'react'

export type ConfirmChoice = 'save' | 'discard' | 'cancel'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  hint?: string
  saveLabel: string
  discardLabel: string
  cancelLabel: string
  onChoice: (choice: ConfirmChoice) => void
}

/**
 * 三按钮确认框（保存 / 不保存 / 取消），用于关闭存在未保存更改的文档时提示。
 * 行为对齐 Office / VSCode：Esc 等价于“取消”，Enter 等价于“保存”。
 */
export function ConfirmDialog({
  open, title, message, hint,
  saveLabel, discardLabel, cancelLabel, onChoice,
}: ConfirmDialogProps) {
  const saveBtnRef = useRef<HTMLButtonElement>(null)

  // 打开时把焦点放到默认按钮（保存），并接管 Esc / Enter
  useEffect(() => {
    if (!open) return
    saveBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onChoice('cancel')
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onChoice('save')
      }
    }
    // 捕获阶段监听，避免被编辑器的全局快捷键先行处理
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onChoice])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="confirm-unsaved"
    >
      <div
        className="rounded-lg shadow-2xl w-[420px] max-w-[90vw] overflow-hidden"
        style={{ background: 'var(--bg-panel, #ffffff)', color: 'var(--text-main, #1f2937)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3">
          <div className="text-base font-semibold mb-2">{title}</div>
          <div className="text-sm leading-relaxed opacity-90">{message}</div>
          {hint && <div className="text-xs mt-2 opacity-60">{hint}</div>}
        </div>
        <div
          className="px-5 py-3 flex justify-end gap-2"
          style={{ background: 'var(--bg-subtle, rgba(0,0,0,0.04))' }}
        >
          <button
            ref={saveBtnRef}
            onClick={() => onChoice('save')}
            data-testid="confirm-save"
            className="px-4 py-1.5 text-sm rounded-md font-medium text-white transition-colors"
            style={{ background: '#2563eb' }}
          >
            {saveLabel}
          </button>
          <button
            onClick={() => onChoice('discard')}
            data-testid="confirm-discard"
            className="px-4 py-1.5 text-sm rounded-md font-medium transition-colors hover:bg-black/10"
            style={{ border: '1px solid var(--border-color, rgba(0,0,0,0.2))' }}
          >
            {discardLabel}
          </button>
          <button
            onClick={() => onChoice('cancel')}
            data-testid="confirm-cancel"
            className="px-4 py-1.5 text-sm rounded-md font-medium transition-colors hover:bg-black/10"
            style={{ border: '1px solid var(--border-color, rgba(0,0,0,0.2))' }}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
