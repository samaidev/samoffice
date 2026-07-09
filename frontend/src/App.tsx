import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createBackend } from './services/backend'
import type { Backend, Document, SpellError } from './types/udm'
import { DocumentEditor } from './editors/document/DocumentEditor'
import { SpreadsheetEditor } from './editors/spreadsheet/SpreadsheetEditor'
import { SlideEditor } from './editors/slide/SlideEditor'
import { MarkdownHtmlEditor } from './editors/markdown/MarkdownHtmlEditor'
import { PdfViewer } from './editors/pdf/PdfViewer'
import { AboutPage } from './components/AboutPage'
import { useI18n } from './i18n'

type Tab = 'document' | 'spreadsheet' | 'slide' | 'markdown' | 'html' | 'pdf' | 'about'
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
    fmt.Println("Hello, SamOffice!")
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
  <h1>Hello from SamOffice</h1>
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
  const [filesOpen, setFilesOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [spellPanelOpen, setSpellPanelOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>('auto')
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [docZoom, setDocZoom] = useState(100)
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
    input.accept = '.docx,.md,.markdown,.xlsx,.pptx,.pdf'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      // PDF 文件直接切换到 PDF Tab，用 blob URL 加载
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        setTab('pdf')
        showToast(t('app.opening', { name: file.name }))
        // 等待 PdfViewer 组件挂载后，通过自定义事件传递文件
        setTimeout(() => {
          const url = URL.createObjectURL(file)
          window.dispatchEvent(new CustomEvent('pdf-open', { detail: { url, name: file.name } }))
        }, 300)
        return
      }

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
      const safeDoc: Document = {
        meta: doc.meta || { title: t('app.untitled') },
        blocks: (doc.blocks || []).map((b: any) => {
          if (b && Array.isArray(b.inline)) return b
          if (b && typeof b.code === 'string') return { inline: [{ content: b.code }] }
          if (b && typeof b.src === 'string') return { inline: [{ content: '[图片]' }] }
          if (b && Array.isArray(b.items)) return { inline: [{ content: b.items.flat().map((it: any) => it?.inline?.[0]?.content || '').join(' ') }] }
          if (b && Array.isArray(b.rows)) return { inline: [{ content: b.rows.flat().map((c: any) => c?.inline?.[0]?.content || '').join(' ') }] }
          return { inline: [{ content: '' }] }
        })
      }
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safeDoc)
      })
      if (resp.ok) {
        const blob = await resp.blob()
        const ct = resp.headers.get('content-type') || ''
        if (!ct.includes(format === 'docx' ? 'wordprocessingml' : 'pdf') && !ct.includes('octet-stream') && blob.size < 2000) {
          const txt = await blob.text()
          showToast(t('app.exportFailed', { msg: txt.slice(0, 150) }))
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
        const errText = await resp.text()
        showToast(t('app.exportFailed', { msg: errText.slice(0, 150) }))
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

  // 按当前 Tab 决定显示哪些导出/操作按钮
  // Excel 表格不显示 docx 按钮 (不该存成 docx); 演示/MD/HTML 各自合适
  // 顶栏 Files 下拉菜单项 (合并 打开/另存docx/导出PDF 为一个 Files 按钮)
  // 插入图片不放在顶栏 — 每个编辑器内部有自己的插入图片按钮
  const fileItems = useMemo(() => {
    const items: { icon: string; label: string; onClick: () => void; shortcut?: string }[] = [
      { icon: '📂', label: t('app.openFile'), onClick: handleOpenFile, shortcut: 'Ctrl+O' },
    ]
    if (tab === 'document') {
      items.push({ icon: '📄', label: t('app.saveDocx'), onClick: () => handleSave('docx'), shortcut: 'Ctrl+S' })
    }
    if (tab === 'document' || tab === 'spreadsheet' || tab === 'slide' || tab === 'markdown' || tab === 'html') {
      items.push({ icon: '📕', label: t('app.exportPdf'), onClick: () => handleSave('pdf'), shortcut: 'Ctrl+P' })
    }
    return items
  }, [tab, t, loading])

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--color-bg)' }}>
      {/* 合并后的顶部栏: LOGO + 菜单按钮 + Tab + 主题/语言 */}
      <header
        className="text-white px-2 sm:px-4 py-0 flex items-center gap-1 flex-shrink-0"
        style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #818cf8 100%)',
          boxShadow: '0 2px 12px rgba(79, 70, 229, 0.25)'
        }}
      >
        {/* LOGO + 名称 */}
        <div className="font-bold text-sm sm:text-base flex items-center gap-1.5 flex-shrink-0 py-2 pl-1">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
            style={{
              background: 'rgba(255,255,255,0.25)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.2)'
            }}
          >S</div>
          <span className="hidden sm:inline tracking-tight">SamOffice</span>
        </div>

        <div className="w-px h-6 bg-white/20 mx-1 flex-shrink-0" />

        {/* 桌面端 Files 下拉按钮 (合并 打开/另存docx/导出PDF) */}
        {!isMobile && (
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setFilesOpen(!filesOpen)}
              disabled={loading}
              data-testid="menu-files"
              className="px-3 py-1.5 text-xs rounded-md transition-all hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap font-medium"
            >
              <span>📁</span>
              <span>{t('app.files') || 'Files'}</span>
              <span style={{ fontSize: '9px', opacity: 0.7 }}>▾</span>
            </button>
            {filesOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFilesOpen(false)} />
                <div className="absolute top-full left-0 ribbon-popup ribbon-popup_compact min-w-[180px] mt-1">
                  {fileItems.map((it) => (
                    <button
                      key={it.label}
                      onClick={() => { it.onClick(); setFilesOpen(false) }}
                      disabled={loading}
                      data-testid={`menu-${it.label.replace(/\s+/g, '-').toLowerCase()}`}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-xs disabled:opacity-50 transition-colors text-left"
                      style={{ color: 'var(--color-text)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-alt)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontSize: '14px' }}>{it.icon}</span>
                      <span className="flex-1">{it.label}</span>
                      {it.shortcut && <span className="opacity-40 text-[10px]">{it.shortcut}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* 移动端汉堡 */}
        {isMobile && (
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 rounded-md hover:bg-white/15 transition-colors flex-shrink-0"
            aria-label={t('app.menu')}
            data-testid="hamburger-toggle"
          >
            <div className="w-5 h-0.5 bg-white mb-1.5 rounded transition-all" style={{ transform: menuOpen ? 'rotate(45deg) translate(4px, 4px)' : '' }}></div>
            <div className="w-5 h-0.5 bg-white mb-1.5 rounded transition-all" style={{ opacity: menuOpen ? 0 : 1 }}></div>
            <div className="w-5 h-0.5 bg-white rounded transition-all" style={{ transform: menuOpen ? 'rotate(-45deg) translate(4px, -4px)' : '' }}></div>
          </button>
        )}

        <div className="w-px h-6 bg-white/20 mx-1 flex-shrink-0" />

        {/* Tab 切换 (合并到同一行) */}
        {([
          { id: 'document', icon: '📄', label: t('tab.document') },
          { id: 'spreadsheet', icon: '📊', label: t('tab.spreadsheet') },
          { id: 'slide', icon: '🎞', label: t('tab.slide') },
          { id: 'markdown', icon: '📝', label: t('tab.markdown') },
          { id: 'html', icon: '🌐', label: t('tab.html') },
          { id: 'pdf', icon: '📕', label: t('tab.pdf') },
          { id: 'about', icon: 'ℹ️', label: t('tab.about') },
        ]).map((tt) => (
          <button
            key={tt.id}
            onClick={() => setTab(tt.id as Tab)}
            data-testid={`tab-${tt.id}`}
            className="px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1 rounded-md"
            style={{
              background: tab === tt.id ? 'rgba(255,255,255,0.2)' : 'transparent',
              color: tab === tt.id ? '#ffffff' : 'rgba(255,255,255,0.75)'
            }}
          >
            <span>{tt.icon}</span>
            <span className="hidden md:inline">{tt.label}</span>
          </button>
        ))}

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

        {/* 语言下拉 */}
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as 'en' | 'zh')}
          className="text-xs rounded-md px-1.5 py-1 flex-shrink-0"
          style={{ minWidth: '60px', background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }}
        >
          <option value="zh" style={{ color: '#000' }}>中文</option>
          <option value="en" style={{ color: '#000' }}>EN</option>
        </select>

        {/* 模式标识 */}
        <div
          className="text-xs opacity-80 hidden lg:flex items-center gap-1 flex-shrink-0"
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
            className="px-2 py-1 text-xs rounded-full font-semibold flex items-center gap-1 animate-scale-in flex-shrink-0"
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
          {fileItems.map((it, idx) => (
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
                  zoom={docZoom}
                  onZoomChange={setDocZoom}
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
          {tab === 'pdf' && <PdfViewer />}
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
        {/* Word 缩放控件 (窗口整体右下角, 仅文档 Tab 显示) */}
        {tab === 'document' && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => setDocZoom(Math.max(50, docZoom - 10))} className="px-1.5 py-0.5 rounded hover:bg-white/15 transition-colors" title={t('app.zoomOut') || '缩小 (Ctrl+-)'} style={{ minWidth: 20 }}>−</button>
            <input
              type="number"
              value={docZoom}
              min={50}
              max={300}
              onChange={e => { const v = parseInt(e.target.value) || 100; setDocZoom(Math.max(50, Math.min(300, v))) }}
              className="text-center rounded w-10 px-0.5 py-0.5"
              style={{ background: 'rgba(255,255,255,0.15)', color: 'var(--color-surface)', border: '1px solid rgba(255,255,255,0.2)', fontSize: '10px' }}
              title={t('app.zoom') || '缩放'}
            />
            <span className="opacity-70" style={{ fontSize: '10px' }}>%</span>
            <button onClick={() => setDocZoom(Math.min(300, docZoom + 10))} className="px-1.5 py-0.5 rounded hover:bg-white/15 transition-colors" title={t('app.zoomIn') || '放大 (Ctrl+=)'} style={{ minWidth: 20 }}>+</button>
            <button onClick={() => setDocZoom(100)} className="px-1.5 py-0.5 rounded hover:bg-white/15 transition-colors opacity-80" style={{ fontSize: '10px' }}>100%</button>
          </div>
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
