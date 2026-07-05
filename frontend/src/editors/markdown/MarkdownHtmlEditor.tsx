import { useState, useEffect, useRef, useCallback } from 'react'
import { useI18n } from '../../i18n'

interface Props {
  initialContent?: string
  mode: 'markdown' | 'html'
  onChange?: (content: string) => void
}

type ViewMode = 'split' | 'editor' | 'preview'

interface TocItem {
  id: string
  text: string
  level: number
  line: number
}

export function MarkdownHtmlEditor({ initialContent = '', mode, onChange }: Props) {
  const { t } = useI18n()
  const [content, setContent] = useState(initialContent)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [toc, setToc] = useState<TocItem[]>([])
  const [activeTocId, setActiveTocId] = useState('')
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const lineMapRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (onChange) onChange(content)
  }, [content, onChange])

  const renderMarkdown = useCallback((md: string): string => {
    const w = window as any
    if (typeof w.marked === 'undefined') {
      return '<p style="color:#999">' + t('md.loading') + '</p>'
    }
    try {
      w.marked.setOptions({ gfm: true, breaks: true })
      const renderer = new w.marked.Renderer()
      renderer.heading = function(text: string, level: number, raw: string) {
        const id = slugify(raw)
        return `<h${level} id="${id}">${text}</h${level}>`
      }
      renderer.code = function(code: string, lang: string) {
        if (typeof w.hljs !== 'undefined') {
          if (lang && w.hljs.getLanguage(lang)) {
            try {
              return `<pre><code class="hljs language-${lang}">${w.hljs.highlight(code, { language: lang }).value}</code></pre>`
            } catch {}
          }
          try {
            return `<pre><code class="hljs">${w.hljs.highlightAuto(code).value}</code></pre>`
          } catch {}
        }
        return `<pre><code>${escapeHtml(code)}</code></pre>`
      }
      return w.marked.parse(md, { renderer })
    } catch (e: any) {
      return `<p style="color:red">${t('md.renderError', { msg: e.message })}</p>`
    }
  }, [t])

  const extractToc = useCallback((md: string): TocItem[] => {
    const lines = md.split('\n')
    const items: TocItem[] = []
    let inCodeBlock = false
    let lineNum = 0

    for (const line of lines) {
      lineNum++
      if (/^```/.test(line.trim())) {
        inCodeBlock = !inCodeBlock
        continue
      }
      if (inCodeBlock) continue

      const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
      if (m) {
        const level = m[1].length
        const text = m[2].trim()
        const id = slugify(text)
        items.push({ id, text, level, line: lineNum })
        lineMapRef.current.set(id, lineNum)
      }
    }
    return items
  }, [])

  const renderHtml = useCallback((html: string): string => {
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  }, [])

  useEffect(() => {
    if (!previewRef.current) return
    if (mode === 'markdown') {
      previewRef.current.innerHTML = renderMarkdown(content)
      setToc(extractToc(content))
    } else {
      previewRef.current.innerHTML = renderHtml(content)
      setToc([])
    }
  }, [content, mode, renderMarkdown, renderHtml, extractToc])

  const jumpToToc = (id: string) => {
    setActiveTocId(id)
    if (viewMode === 'preview' || viewMode === 'split') {
      const el = previewRef.current?.querySelector(`#${CSS.escape(id)}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    } else {
      const line = lineMapRef.current.get(id)
      if (line && editorRef.current) {
        const lines = content.split('\n')
        const offset = lines.slice(0, line - 1).join('\n').length
        editorRef.current.focus()
        editorRef.current.setSelectionRange(offset, offset)
      }
    }
  }

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newContent = content.slice(0, start) + '  ' + content.slice(end)
      setContent(newContent)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }

  return (
    <div className="flex h-full" style={{ background: 'var(--color-bg)' }}>
      <div className="flex-1 flex flex-col min-w-0">
        <div
          className="px-3 py-1.5 flex items-center gap-2 flex-shrink-0"
          style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            {mode === 'markdown' ? t('md.markdown') : t('md.html')}
          </span>
          <div className="flex-1" />
          <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
            {([
              { id: 'editor', label: t('md.edit'), icon: '✏️' },
              { id: 'split', label: t('md.split'), icon: '⇆' },
              { id: 'preview', label: t('md.preview'), icon: '👁' },
            ] as const).map(v => (
              <button
                key={v.id}
                onClick={() => setViewMode(v.id)}
                className="px-3 py-1 text-xs transition-colors"
                style={{
                  background: viewMode === v.id ? 'var(--color-primary)' : 'transparent',
                  color: viewMode === v.id ? 'white' : 'var(--color-text-secondary)'
                }}
              >
                {v.icon} {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden min-h-0">
          {viewMode !== 'preview' && (
            <div
              className={viewMode === 'split' ? 'w-1/2 border-r' : 'w-full'}
              style={{ borderColor: 'var(--color-border)' }}
            >
              <textarea
                ref={editorRef}
                value={content}
                onChange={handleContentChange}
                onKeyDown={handleKeyDown}
                className="w-full h-full p-4 font-mono text-sm outline-none resize-none"
                style={{
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  border: 'none',
                  lineHeight: 1.6,
                  fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace"
                }}
                placeholder={mode === 'markdown'
                  ? t('md.placeholder')
                  : '<!DOCTYPE html>\n<html>\n<body>\n  <h1>Hello</h1>\n</body>\n</html>'}
                spellCheck={false}
              />
            </div>
          )}

          {viewMode !== 'editor' && (
            <div
              className={viewMode === 'split' ? 'w-1/2' : 'w-full'}
              style={{ background: 'var(--color-surface)' }}
            >
              <div
                ref={previewRef}
                className="markdown-preview h-full overflow-auto p-8"
                style={{ color: 'var(--color-text)' }}
              />
            </div>
          )}
        </div>
      </div>

      {toc.length > 0 && (
        <aside
          className="w-56 flex-shrink-0 overflow-auto p-3 hidden md:block animate-slide-in"
          style={{ background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}
        >
          <div className="text-xs font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
            <span>📑</span> {t('md.toc')}
            <span className="badge ml-auto">{toc.length}</span>
          </div>
          <div className="space-y-0.5">
            {toc.map((item, i) => (
              <button
                key={i}
                onClick={() => jumpToToc(item.id)}
                className="block w-full text-left text-xs py-1 px-2 rounded transition-colors truncate"
                style={{
                  paddingLeft: `${(item.level - 1) * 12 + 8}px`,
                  color: activeTocId === item.id ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  background: activeTocId === item.id ? 'var(--color-primary-light)' : 'transparent',
                  fontWeight: activeTocId === item.id ? 600 : 400,
                }}
                title={item.text}
              >
                {item.text}
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
