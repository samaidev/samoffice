import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createBackend } from './services/backend'
import type { Backend, Document, SpellError } from './types/udm'
import { DocumentEditor } from './editors/document/DocumentEditor'
import { SpreadsheetEditor } from './editors/spreadsheet/SpreadsheetEditor'
import { SlideEditor } from './editors/slide/SlideEditor'
import { MarkdownHtmlEditor } from './editors/markdown/MarkdownHtmlEditor'
import { AboutPage } from './components/AboutPage'
import { useI18n } from './i18n'

type Tab = 'document' | 'spreadsheet' | 'slide' | 'markdown' | 'html' | 'about'
type Theme = 'light' | 'dark' | 'auto'

function App() {
  const { t, lang, setLang } = useI18n()

  const emptyDoc = useMemo<Document>(() => ({
    meta: { title: t('app.untitled') },
    blocks: [
      { inline: [{ content: t('app.welcome'), bold: true }], style: '', align: '' },
      { inline: [{ content: t('app.subtitle') }], style: '', align: '' }
    ]
  }), [t])

  const sampleMd = useMemo(() => `${t('sample.md.title')}

${t('sample.md.intro')}

${t('sample.md.features')}

${t('sample.md.split')}
${t('sample.md.toc')}
${t('sample.md.highlight')}
${t('sample.md.tables')}

${t('sample.md.codeExample')}

\`\`\`go
package main

import "fmt"

func main() {
    fmt.Println("Hello, GoOffice!")
}
\`\`\`

\`\`\`python
def greet(name):
    return f"Hello, {name}!"

print(greet("SamAI"))
\`\`\`

${t('sample.md.table')}

| ${t('sample.md.feature')} | ${t('sample.md.status')} |
|------|------|
| ${t('sample.md.doc')} | ✅ |
| ${t('sample.md.sheet')} | ✅ |
| ${t('sample.md.slide')} | ✅ |
| Markdown | ✅ |

${t('sample.md.quote')}

${t('sample.md.h3')}

${t('sample.md.more')}
`, [t])

  const sampleHtml = useMemo(() => `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: sans-serif; padding: 2rem; }
    h1 { color: #4f46e5; }
    .card { background: #f8fafc; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
  </style>
</head>
<body>
  <h1>Hello from GoOffice</h1>
  <p>${t('sample.html.body')}</p>
  <div class="card">
    <strong>SamAI Group</strong> · ${t('sample.html.opensource')}
  </div>
  <ul>
    <li>${t('sample.html.preview')}</li>
    <li>${t('sample.html.source')}</li>
    <li>${t('sample.html.sandbox')}</li>
  </ul>
</body>
</html>`, [t])

  const [backend, setBackend] = useState<Backend | null>(null)
  const [tab, setTab] = useState<Tab>('document')
  const [doc, setDoc] = useState<Document>(emptyDoc)
  const [spellErrors, setSpellErrors] = useState<SpellError[]>([])
  const [filePath, setFilePath] = useState('')
  const [toast, setToast] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [spellPanelOpen, setSpellPanelOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>('auto')
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [mdContent, setMdContent] = useState(sampleMd)
  const [htmlContent, setHtmlContent] = useState(sampleHtml)
  const spellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2500)
  }, [])

  // 主题应用
  useEffect(() => {
    const applyTheme = () => {
      const isDark = theme === 'dark' ||
        (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
      // 切换 hljs 主题
      const lightLink = document.getElementById('hljs-light') as HTMLLinkElement
      const darkLink = document.getElementById('hljs-dark') as HTMLLinkElement
      if (lightLink && darkLink) {
        lightLink.disabled = isDark
        darkLink.disabled = !isDark
      }
    }
    applyTheme()
    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', applyTheme)
      return () => mq.removeEventListener('change', applyTheme)
    }
  }, [theme])

  useEffect(() => {
    setBackend(createBackend())
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // 字数统计
  useEffect(() => {
    const text = doc.blocks?.map(b => {
      if ('inline' in b) return (b as any).inline?.map((i: any) => i.content || '').join('') || ''
      if ('code' in b) return (b as any).code || ''
      return ''
    }).join(' ') || ''
    setCharCount(text.length)
    setWordCount(text.trim() ? text.trim().split(/\s+/).length : 0)
  }, [doc])

  const triggerSpellCheck = useCallback((text: string) => {
    if (spellTimer.current) clearTimeout(spellTimer.current)
    spellTimer.current = setTimeout(async () => {
      if (!backend || !text.trim()) {
        setSpellErrors([])
        return
      }
      try {
        const errs = await backend.spellCheck(text, lang)
        setSpellErrors(errs)
      } catch (e) {
        console.error('spell check failed', e)
      }
    }, 500)
  }, [backend, lang])

  const handleOpenFile = async () => {
    if (!backend) return
    setMenuOpen(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.docx,.md,.markdown,.xlsx,.pptx'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setLoading(true)
      showToast(t('app.opening', { name: file.name }))
      try {
        const result = await backend.uploadFile(file)
        setDoc(result.document)
        setFilePath(file.name)
        showToast(t('app.opened', { name: file.name }))
        triggerSpellCheck(JSON.stringify(result.document.blocks))
      } catch (e: any) {
        showToast(t('app.openFailed', { msg: e.message }))
      } finally {
        setLoading(false)
      }
    }
    input.click()
  }

  const handleSave = async (format: 'docx' | 'pdf') => {
    if (!backend) return
    setMenuOpen(false)
    setLoading(true)
    showToast(t('app.exporting', { format: format.toUpperCase() }))
    try {
      const endpoint = format === 'docx' ? '/api/doc/save' : '/api/doc/export-pdf'
      const mime = format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf'
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc)
      })
      if (resp.ok) {
        const blob = await resp.blob()
        if (blob.type !== mime && blob.size < 500) {
          showToast(t('app.exportFailed', { msg: await blob.text() }))
          return
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const title = doc.meta?.title || 'untitled'
        a.download = `${title}.${format}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        showToast(t('app.exported', { format: format.toUpperCase() }))
      } else {
        showToast(t('app.exportFailed', { msg: await resp.text() }))
      }
    } catch (e: any) {
      showToast(t('app.exportFailed', { msg: e.message }))
    } finally {
      setLoading(false)
    }
  }

  const handleInsertImage = () => {
    setMenuOpen(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUri = reader.result as string
        setDoc((d) => ({
          ...d,
          blocks: [...d.blocks, { src: dataUri, width: 400, height: 300, alt: file.name } as any]
        }))
        showToast(t('app.imageInserted', { name: file.name }))
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const handleLearnWord = async (word: string) => {
    if (!backend) return
    await backend.learnWord(word, lang, 'manual')
    showToast(t('app.wordLearned', { word }))
    triggerSpellCheck(JSON.stringify(doc.blocks))
  }

  const toggleTheme = () => {
    setTheme(t => t === 'light' ? 'dark' : t === 'dark' ? 'auto' : 'light')
  }

  const themeIcon = theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🖥'
  const themeLabel = theme === 'light' ? t('app.theme.light') : theme === 'dark' ? t('app.theme.dark') : t('app.theme.auto')

  const menuItems = [
    { icon: '📂', label: t('app.openFile'), onClick: handleOpenFile, shortcut: 'Ctrl+O' },
    { icon: '📄', label: t('app.saveDocx'), onClick: () => handleSave('docx'), shortcut: 'Ctrl+S' },
    { icon: '📕', label: t('app.exportPdf'), onClick: () => handleSave('pdf'), shortcut: 'Ctrl+P' },
    { icon: '🖼', label: t('app.insertImage'), onClick: handleInsertImage },
  ]

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--color-bg)' }}>
      {/* 顶部菜单栏 */}
      <header
        className="text-white px-3 sm:px-5 py-2.5 flex items-center gap-3 flex-shrink-0"
        style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #818cf8 100%)',
          boxShadow: '0 2px 12px rgba(79, 70, 229, 0.25)'
        }}
      >
        <div className="font-bold text-base sm:text-lg flex items-center gap-2 flex-shrink-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
            style={{
              background: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.15)'
            }}
          >Go</div>
          <span className="hidden sm:inline tracking-tight">Office</span>
        </div>

        {/* 桌面端菜单 */}
        {!isMobile && (
          <div className="flex gap-0.5 items-center">
            {menuItems.map((it) => (
              <button
                key={it.label}
                onClick={it.onClick}
                disabled={loading}
                data-tooltip={it.shortcut ? `${it.label} (${it.shortcut})` : it.label}
                data-testid={`menu-${it.label.replace(/\s+/g, '-').toLowerCase()}`}
                className="px-3 py-1.5 text-sm rounded-md transition-all hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5"
              >
                <span className="text-xs opacity-90">{it.icon}</span>
                <span className="hidden md:inline">{it.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* 移动端汉堡 */}
        {isMobile && (
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 rounded-md hover:bg-white/15 transition-colors"
            aria-label={t('app.menu')}
            data-testid="hamburger-toggle"
          >
            <div className="w-5 h-0.5 bg-white mb-1.5 rounded transition-all" style={{ transform: menuOpen ? 'rotate(45deg) translate(4px, 4px)' : '' }}></div>
            <div className="w-5 h-0.5 bg-white mb-1.5 rounded transition-all" style={{ opacity: menuOpen ? 0 : 1 }}></div>
            <div className="w-5 h-0.5 bg-white rounded transition-all" style={{ transform: menuOpen ? 'rotate(-45deg) translate(4px, -4px)' : '' }}></div>
          </button>
        )}

        <div className="flex-1" />

        {/* 主题切换 */}
        <button
          onClick={toggleTheme}
          data-tooltip={`${t('app.theme')}: ${themeLabel}`}
          data-testid="theme-toggle"
          aria-label={t('app.theme')}
          className="p-2 rounded-md hover:bg-white/15 transition-all flex-shrink-0"
        >
          <span className="text-sm">{themeIcon}</span>
        </button>

        {/* 模式标识 */}
        <div
          className="text-xs opacity-80 hidden md:flex items-center gap-1.5"
          data-testid="mode-badge"
          data-mode={backend?.mode || 'remote'}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${backend?.mode === 'local' ? 'bg-green-300' : 'bg-blue-300'} animate-pulse`}></span>
          {backend?.mode === 'local' ? t('app.local') : t('app.remote')}
        </div>

        {/* 拼写错误徽章 */}
        {spellErrors.length > 0 && (
          <button
            onClick={() => setSpellPanelOpen(!spellPanelOpen)}
            className="px-2.5 py-1 text-xs rounded-full font-semibold flex items-center gap-1 animate-scale-in"
            style={{ background: 'rgba(225, 29, 72, 0.9)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
            {spellErrors.length}
          </button>
        )}
      </header>

      {/* 移动端下拉菜单 */}
      {isMobile && menuOpen && (
        <div
          className="shadow-lg flex-shrink-0 border-b animate-fade-in"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          {menuItems.map((it, idx) => (
            <button
              key={it.label}
              onClick={it.onClick}
              disabled={loading}
              data-testid={`mobile-menu-item-${idx}`}
              className="block w-full text-left px-4 py-3 text-sm border-b disabled:opacity-50 flex items-center gap-3 transition-colors"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span className="text-base">{it.icon}</span>
              <span>{it.label}</span>
              {it.shortcut && <span className="ml-auto text-xs opacity-50">{it.shortcut}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Tab 切换栏 */}
      <div
        className="border-b px-2 sm:px-5 flex items-center gap-1 flex-shrink-0 overflow-x-auto"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        {([
          { id: 'document', icon: '📄', label: t('tab.document') },
          { id: 'spreadsheet', icon: '📊', label: t('tab.spreadsheet') },
          { id: 'slide', icon: '🎞', label: t('tab.slide') },
          { id: 'markdown', icon: '📝', label: t('tab.markdown') },
          { id: 'html', icon: '🌐', label: t('tab.html') },
          { id: 'about', icon: 'ℹ️', label: t('tab.about') },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as Tab)}
            data-testid={`tab-${t.id}`}
            className={`px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-all flex items-center gap-2 ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
            style={{
              borderColor: tab === t.id ? 'var(--color-primary)' : 'transparent',
              color: tab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)'
            }}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-sm flex-shrink-0 py-1.5">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as 'en' | 'zh')}
            className="text-xs rounded-md px-2 py-1"
            style={{ minWidth: '70px', background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* 主编辑区 */}
      <main className="flex-1 overflow-hidden min-h-0 flex">
        <div className="flex-1 overflow-hidden min-w-0">
          {tab === 'document' && (
            <div className="h-full overflow-auto" style={{ background: 'var(--color-bg-alt)' }}>
              <div
                className="max-w-4xl mx-auto bg-white min-h-full animate-fade-in"
                style={{
                  boxShadow: '0 0 32px rgba(15, 23, 42, 0.06)',
                  marginTop: '24px',
                  marginBottom: '24px',
                  borderRadius: '8px',
                  background: 'var(--color-surface)',
                  minHeight: 'calc(100% - 48px)'
                }}
              >
                <DocumentEditor
                  document={doc}
                  spellErrors={spellErrors}
                  onChange={(d) => setDoc(d)}
                  onSpellCheck={triggerSpellCheck}
                />
              </div>
            </div>
          )}
          {tab === 'spreadsheet' && <SpreadsheetEditor title={t('app.sheet1')} />}
          {tab === 'slide' && <SlideEditor />}
          {tab === 'markdown' && (
            <MarkdownHtmlEditor
              initialContent={mdContent}
              mode="markdown"
              onChange={setMdContent}
            />
          )}
          {tab === 'html' && (
            <MarkdownHtmlEditor
              initialContent={htmlContent}
              mode="html"
              onChange={setHtmlContent}
            />
          )}
          {tab === 'about' && <AboutPage />}
        </div>

        {/* 拼写检查侧边面板 */}
        {spellErrors.length > 0 && spellPanelOpen && !isMobile && (
          <aside
            className="w-80 flex flex-col flex-shrink-0 animate-slide-in"
            style={{
              background: 'var(--color-surface)',
              borderLeft: '1px solid var(--color-border)',
              boxShadow: '-4px 0 12px rgba(15, 23, 42, 0.04)'
            }}
          >
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <span className="badge badge-danger">{spellErrors.length}</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{t('app.spellCheck')}</span>
              </div>
              <button
                onClick={() => setSpellPanelOpen(false)}
                className="px-1.5 hover:opacity-70 transition-opacity"
                style={{ color: 'var(--color-text-muted)' }}
              >✕</button>
            </div>
            <div className="flex-1 overflow-auto">
              {spellErrors.map((e, i) => (
                <div
                  key={i}
                  className="px-4 py-3 transition-colors hover:bg-slate-50"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-sm font-medium" style={{ color: 'var(--color-danger)' }}>{e.word}</span>
                    <button
                      onClick={() => handleLearnWord(e.word)}
                      className="text-xs hover:underline flex-shrink-0 ml-2"
                      style={{ color: 'var(--color-primary)' }}
                    >{t('app.addToDict')}</button>
                  </div>
                  {e.suggest.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {e.suggest.slice(0, 5).map((s, j) => (
                        <span
                          key={j}
                          className="text-xs px-2 py-0.5 rounded"
                          style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text-secondary)' }}
                        >{s}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs italic" style={{ color: 'var(--color-text-muted)' }}>{t('app.noSuggestions')}</div>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}
      </main>

      {/* 移动端拼写检查浮层 */}
      {spellErrors.length > 0 && spellPanelOpen && isMobile && (
        <div
          className="fixed inset-0 z-50 flex items-end animate-fade-in-fast"
          style={{ background: 'rgba(15, 23, 42, 0.4)' }}
          onClick={() => setSpellPanelOpen(false)}
        >
          <div
            className="bg-white w-full max-h-[70vh] flex flex-col rounded-t-xl animate-slide-in-up"
            style={{ background: 'var(--color-surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <span className="badge badge-danger">{spellErrors.length}</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{t('app.spellCheck')}</span>
              </div>
              <button
                onClick={() => setSpellPanelOpen(false)}
                className="px-1.5"
                style={{ color: 'var(--color-text-muted)' }}
              >✕</button>
            </div>
            <div className="flex-1 overflow-auto">
              {spellErrors.map((e, i) => (
                <div key={i} className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-sm font-medium" style={{ color: 'var(--color-danger)' }}>{e.word}</span>
                    <button
                      onClick={() => handleLearnWord(e.word)}
                      className="text-xs hover:underline"
                      style={{ color: 'var(--color-primary)' }}
                    >{t('app.addToDict')}</button>
                  </div>
                  {e.suggest.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {e.suggest.slice(0, 5).map((s, j) => (
                        <span key={j} className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text-secondary)' }}>{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 底部状态栏 */}
      <footer
        className="text-xs px-3 sm:px-5 py-1.5 flex items-center gap-3 flex-shrink-0 overflow-hidden"
        style={{ background: 'var(--color-text)', color: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          {loading && (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
          )}
          <span className="truncate max-w-[150px] sm:max-w-md">
            {filePath || t('app.ready')}
          </span>
        </div>
        <div className="flex-1" />
        {tab === 'document' && (
          <span className="hidden sm:inline opacity-70">
            {wordCount} {t('app.words')} · {charCount} {t('app.chars')}
          </span>
        )}
        {spellErrors.length > 0 && (
          <span className="opacity-70 hidden sm:inline">{spellErrors.length} {t('app.spellErrors')}</span>
        )}
        <span className="opacity-50">v0.3.0</span>
      </footer>

      {/* Toast */}
      {toast && (
        <div className="toast">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
          {toast}
        </div>
      )}
    </div>
  )
}

export default App
