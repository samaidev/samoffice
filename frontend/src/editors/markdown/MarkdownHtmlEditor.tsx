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
      // 保护公式：breaks:true 会把 $$...$$ 内的换行变成 <br>，导致 KaTeX 无法匹配。
      // 在解析前把公式块内部空白折叠成单行（KaTeX 仅以 \\ 换行，折叠原始换行无影响）。
      const safeMd = protectMath(md)
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
      const raw = w.marked.parse(safeMd, { renderer })
      // 安全过滤：移除 script/iframe/object/embed/style 标签、事件处理器、javascript: 协议
      return sanitizeHtml(raw)
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
    // HTML 模式同样需要安全过滤
    return sanitizeHtml(html)
  }, [])

  useEffect(() => {
    if (!previewRef.current) return
    if (mode === 'markdown') {
      previewRef.current.innerHTML = renderMarkdown(content)
      // KaTeX 公式渲染：在 sanitize 之后对实时 DOM 执行，
      // 这样 sanitize 不会破坏 KaTeX 生成的 <span class="katex"> 结构。
      const w = window as any
      if (typeof w.renderMathInElement !== 'undefined') {
        try {
          w.renderMathInElement(previewRef.current, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\(', right: '\\)', display: false },
              { left: '\\[', right: '\\]', display: true },
            ],
            throwOnError: false,
          })
        } catch (e) {
          /* 忽略渲染异常，避免影响整页 */
        }
      }
      setToc(extractToc(content))
    } else {
      previewRef.current.innerHTML = renderHtml(content)
      setToc([])
    }
  }, [content, mode, renderMarkdown, renderHtml, extractToc])

  const jumpToToc = (id: string) => {
    setActiveTocId(id)
    // 预览区：仅在预览容器内滚动到对应标题（不使用 scrollIntoView，
    // 否则会连带滚动外层容器/窗口，导致顶部菜单栏被推出视口）。
    if (viewMode === 'preview' || viewMode === 'split') {
      const prev = previewRef.current
      const el = prev?.querySelector(`#${CSS.escape(id)}`)
      if (prev && el) {
        const target =
          el.getBoundingClientRect().top - prev.getBoundingClientRect().top + prev.scrollTop - 12
        prev.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
      }
    }
    // 代码区：同步滚动到对应行（与预览导航保持一致）
    const line = lineMapRef.current.get(id)
    if (line && editorRef.current && viewMode !== 'preview') {
      const ta = editorRef.current
      const lines = content.split('\n')
      const offset = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
      // 计算行高并直接设置滚动位置（仅滚动该 textarea，不影响页面/菜单栏）
      const style = window.getComputedStyle(ta)
      const lh = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.6)
      ta.scrollTop = Math.max(0, (line - 1) * lh - 8)
      // 仅当编辑器已获得焦点时定位光标，避免 setSelectionRange 触发文档滚动
      if (document.activeElement === ta) {
        ta.setSelectionRange(offset, offset)
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
              className={viewMode === 'split' ? 'w-1/2 border-r relative' : 'w-full relative'}
              style={{ borderColor: 'var(--color-border)' }}
            >
              {/* 语法高亮层 (仅 HTML 模式显示, Markdown 用纯文本即可) */}
              {mode === 'html' && (
                <pre
                  aria-hidden="true"
                  className="absolute inset-0 m-0 p-4 font-mono text-sm overflow-auto pointer-events-none whitespace-pre-wrap break-words"
                  style={{
                    color: 'var(--color-text)',
                    background: 'var(--color-surface)',
                    lineHeight: 1.6,
                    fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
                  }}
                  dangerouslySetInnerHTML={{ __html: highlightHtmlForEditor(content) + '\n' }}
                />
              )}
              <textarea
                ref={editorRef}
                value={content}
                onChange={handleContentChange}
                onKeyDown={handleKeyDown}
                onScroll={(e) => {
                  const ta = e.currentTarget
                  const pre = ta.previousElementSibling as HTMLPreElement
                  if (pre) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft }
                }}
                className={`w-full h-full p-4 font-mono text-sm outline-none resize-none ${mode === 'html' ? 'relative' : ''}`}
                style={{
                  background: mode === 'html' ? 'transparent' : 'var(--color-surface)',
                  color: mode === 'html' ? 'transparent' : 'var(--color-text)',
                  caretColor: 'var(--color-text)',
                  border: 'none',
                  lineHeight: 1.6,
                  fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
                  position: 'relative',
                  zIndex: 1,
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

/**
 * 保护公式：在 marked 解析前，把 $$...$$ 与 $...$ 内部的空白/换行折叠成单行。
 * 否则 breaks:true 会把公式内的换行变成 <br>，把 $$ 分隔符拆到多个文本节点，
 * 导致 KaTeX auto-render 无法匹配（块级公式不渲染）。
 */
function protectMath(src: string): string {
  // 块级 $$...$$（可跨多行）
  src = src.replace(/\$\$([\s\S]*?)\$\$/g, (_m, body: string) => {
    return '$$' + body.replace(/\s+/g, ' ').trim() + '$$'
  })
  // 行内 $...$（单行）
  src = src.replace(/\$([^$\n]+?)\$/g, (m) => {
    return '$' + m.slice(1, -1).replace(/\s+/g, ' ').trim() + '$'
  })
  return src
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

/**
 * 为 HTML 编辑器生成语法高亮 (用于 textarea overlay)
 * 用 highlight.js 的 xml 语言高亮, 转义后包裹, 保证和 textarea 字符对齐
 */
function highlightHtmlForEditor(code: string): string {
  const w = window as any
  if (typeof w.hljs !== 'undefined' && w.hljs.getLanguage('xml')) {
    try {
      return w.hljs.highlight(code, { language: 'xml' }).value
    } catch {}
  }
  return escapeHtml(code)
    .replace(/(&lt;\/?)([\w-]+)/g, '$1<span style="color:#0550ae;font-weight:600">$2</span>')
    .replace(/([\w-]+)=(&quot;[^&]*&quot;)/g, '<span style="color:#953800">$1</span>=<span style="color:#0a3069">$2</span>')
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span style="color:#6e7781;font-style:italic">$1</span>')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * HTML 安全过滤：防止 XSS 攻击
 * 1. 移除 <script>、<iframe>、<object>、<embed>、<style>、<link>、<meta> 等危险标签
 * 2. 移除所有 on* 事件处理器属性（onclick、onerror、onload 等）
 * 3. 移除 javascript: 协议的 href/src 属性
 * 4. 移除 data: 协议的 href/src 属性（防止 data:text/html 执行）
 */
function sanitizeHtml(html: string): string {
  return html
    // 移除 <script>...</script>（含内容）
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // 移除 <noscript>...</noscript>
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    // 移除自闭合或未闭合的危险标签（含内容到下一个 >）
    .replace(/<(iframe|object|embed|style|link|meta|base|form|input|button|textarea|svg|math)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // 移除独立的危险标签（无闭合）
    .replace(/<\/?(iframe|object|embed|style|link|meta|base|form|input|button|textarea|svg|math|script|noscript)\b[^>]*>/gi, '')
    // 移除所有事件处理器属性 on*="..."
    .replace(/\s+on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '')
    // 移除 javascript: 协议的 href/src
    .replace(/(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'\s*javascript:[^']*'/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*javascript:[^\s>]+/gi, '$1="#"')
    // 移除 data:text/html 等可执行 data 协议
    .replace(/(href|src)\s*=\s*"\s*data:text\/html[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'\s*data:text\/html[^']*'/gi, '$1="#"')
}
