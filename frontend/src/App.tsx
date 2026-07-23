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
import { usePopupAutoFlip } from './hooks/usePopupAutoFlip'
import { Dropdown } from './components/Dropdown'

type Tab = 'document' | 'spreadsheet' | 'slide' | 'markdown' | 'html' | 'pdf' | 'about'
type Theme = 'light' | 'dark' | 'auto'

// base64 → Blob，用于本地模式读取 PDF 等二进制文件后在 WebView 中预览
function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function App() {
  const { t, lang, setLang } = useI18n()
  // 全局 popup 自动定位：检测越界并翻转对齐
  usePopupAutoFlip()

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

  // Escape 关闭顶栏弹出菜单（Files 下拉、移动端汉堡菜单）
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (filesOpen) { setFilesOpen(false); e.preventDefault() }
      else if (menuOpen) { setMenuOpen(false); e.preventDefault() }
      else if (spellPanelOpen) { setSpellPanelOpen(false); e.preventDefault() }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [filesOpen, menuOpen, spellPanelOpen])

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

  const [apiBaseUrl, setApiBaseUrl] = useState('')

  // Get API base URL — called on every save/open in case port wasn't ready on init
  const getApiBase = async (): Promise<string> => {
    if (apiBaseUrl) return apiBaseUrl
    const wailsApp = (window as any).go?.main?.App
    if (wailsApp && typeof wailsApp.HTTPPort === 'function') {
      try {
        const port = await wailsApp.HTTPPort()
        if (port > 0) {
          const url = `http://127.0.0.1:${port}`
          setApiBaseUrl(url)
          return url
        }
      } catch {}
    }
    return ''
  }

  useEffect(() => {
    try { (window as any).go?.main?.App?.LogError?.('MOUNT_OK') } catch {}
    // Try to get port immediately, then retry after 1s if not ready
    getApiBase()
    const timer = setTimeout(() => getApiBase(), 1000)
    const b = createBackend()
    setBackend(b)
    // 右键"打开方式"/命令行传入的文件：启动时直接打开该文件而非默认模板。
    let cancelled = false
    // 规范化启动参数路径：处理 Windows "打开方式"可能传入的 file:// / file:/// / file:\\ 形式，
    // 以及首尾引号；并把 /C:/xxx 还原为 C:/xxx（否则 openFile 读不到文件会静默回退到模板）。
    const normalizeStartupPath = (raw: string): string => {
      let p = String(raw).trim().replace(/^["']|["']$/g, '')
      const m = p.match(/^file:\/\/+\/?(.+)$/i) || p.match(/^file:\\+(.+)$/i)
      if (m) p = m[1]
      p = p.replace(/^\/([A-Za-z]:[\\/])/, '$1')
      return p.trim()
    }
    const tryOpenStartupFile = async () => {
      // 注意：此处不依赖 createBackend() 判定出的 b.mode，因为 Wails 绑定在挂载瞬间可能
      // 尚未注入，会导致 b 被误判为 RemoteBackend 而跳过本逻辑。改为直接探测 window.go.main.App。
      for (let attempt = 0; attempt < 20; attempt++) {
        if (cancelled) return
        const app = (window as any).go?.main?.App
        if (!app || !app.GetStartupArgs) {
          await new Promise(r => setTimeout(r, 150))
          continue
        }
        let rawArgs: string[] = []
        try { rawArgs = await app.GetStartupArgs() } catch { rawArgs = [] }
        try { app.LogError?.('STARTUP_ARGS: ' + JSON.stringify(rawArgs)) } catch {}
        const raw = (rawArgs || [])[0]
        const path = raw ? normalizeStartupPath(raw) : ''
        if (!path) {
          // 绑定就绪但确实没有文件参数：保留默认模板
          return
        }
        try {
          // 优先用 LocalBackend；若 createBackend 误判为 remote，则直接用 app 绑定打开
          const opener = (b && b.mode === 'local') ? b : { openFile: (pp: string) => app.OpenFile(pp) }
          const result = await opener.openFile(path)
          if (cancelled) return
          setDoc(result.document)
          setFilePath(result.path)
          setTab('document')
          const name = result.path.split(/[\\/]/).pop() || path
          try {
            const recent: { name: string; path: string }[] = JSON.parse(localStorage.getItem('samoffice_recent_files') || '[]')
            const filtered = recent.filter(r => r.path !== result.path)
            filtered.unshift({ name, path: result.path })
            localStorage.setItem('samoffice_recent_files', JSON.stringify(filtered.slice(0, 5)))
          } catch {}
          try { app.LogError?.('STARTUP_OPEN_OK: ' + result.path) } catch {}
          return
        } catch (e: any) {
          console.error('open startup file failed', e)
          try { app.LogError?.('STARTUP_OPEN_FAIL: ' + path + ' :: ' + (e?.message || String(e))) } catch {}
          showToast(t('app.openFailed', { msg: (e?.message || String(e)) + '  (' + path + ')' }))
          return
        }
      }
      try { (window as any).go?.main?.App?.LogError?.('STARTUP_NO_BINDING') } catch {}
    }
    tryOpenStartupFile()
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener('resize', checkMobile) }
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

    // 本地模式：使用系统原生“打开”对话框，拿到真实磁盘路径（用于后续“保存”覆盖）
    if (backend.mode === 'local') {
      let path = ''
      try {
        path = await backend.openFileDialog()
      } catch (e: any) {
        showToast(t('app.openFailed', { msg: e.message }))
        return
      }
      if (!path) return // 用户取消

      // PDF 直接读取字节并切换到 PDF Tab
      if (path.toLowerCase().endsWith('.pdf')) {
        setLoading(true)
        showToast(t('app.opening', { name: path }))
        try {
          const b64 = await backend.readFile(path)
          const blob = base64ToBlob(b64, 'application/pdf')
          const url = URL.createObjectURL(blob)
          setTab('pdf')
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('pdf-open', { detail: { url, name: path } }))
          }, 300)
        } catch (e: any) {
          showToast(t('app.openFailed', { msg: e.message }))
        } finally {
          setLoading(false)
        }
        return
      }

      setLoading(true)
      showToast(t('app.opening', { name: path }))
      try {
        const result = await backend.openFile(path)
        setDoc(result.document)
        setFilePath(result.path)
        // 存入最近文件
        try {
          const name = result.path.split(/[\\/]/).pop() || path
          const recent: { name: string; path: string }[] = JSON.parse(localStorage.getItem('samoffice_recent_files') || '[]')
          const filtered = recent.filter(r => r.path !== result.path)
          filtered.unshift({ name, path: result.path })
          localStorage.setItem('samoffice_recent_files', JSON.stringify(filtered.slice(0, 5)))
        } catch {}
        showToast(t('app.opened', { name: path }))
        triggerSpellCheck(JSON.stringify(result.document.blocks))
      } catch (e: any) {
        showToast(t('app.openFailed', { msg: e.message }))
      } finally {
        setLoading(false)
      }
      return
    }

    // 远程模式：HTML 文件输入 → 上传
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.docx,.doc,.md,.markdown,.xlsx,.pptx,.pdf'
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
        // Use HTTP API directly (works in both local and remote mode)
        const base = await getApiBase()
        const form = new FormData()
        form.append('file', file)
        const r = await fetch(`${base}/api/doc/open`, { method: 'POST', body: form })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const result = await r.json()
        setDoc(result.document)
        setFilePath(file.name)
        setTab('document')
        // Save to recent files
        try {
          const recent: { name: string; path: string }[] = JSON.parse(localStorage.getItem('samoffice_recent_files') || '[]')
          const filtered = recent.filter(r => r.name !== file.name)
          filtered.unshift({ name: file.name, path: file.name })
          localStorage.setItem('samoffice_recent_files', JSON.stringify(filtered.slice(0, 5)))
        } catch {}
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

  // 远程模式：沿用原下载逻辑（浏览器下载，带文件名）
  const handleDownload = async (format: 'docx' | 'doc' | 'wps' | 'pdf') => {
    if (!backend) return
    setMenuOpen(false)
    setLoading(true)
    showToast(t('app.exporting', { format: format.toUpperCase() }))
    try {
      const endpointMap: Record<string, string> = {
        docx: '/api/doc/save',
        doc: '/api/doc/save-doc',
        wps: '/api/doc/save-wps',
        pdf: '/api/doc/export-pdf',
      }
      const mimeMap: Record<string, string> = {
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        doc: 'application/msword',
        wps: 'application/vnd.ms-works',
        pdf: 'application/pdf',
      }
      const endpoint = endpointMap[format] || '/api/doc/save'
      const mime = mimeMap[format] || 'application/octet-stream'
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
      const base = await getApiBase()
      const resp = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safeDoc)
      })
      if (resp.ok) {
        const blob = await resp.blob()
        const ct = resp.headers.get('content-type') || ''
        if (!ct.includes(mime.split('/')[1] || '') && !ct.includes('octet-stream') && blob.size < 2000) {
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

  // 保存/另存为
  // format 为空表示“快速保存”（Ctrl+S）：若已有真实磁盘路径则直接覆盖，否则弹“另存为”。
  // forceDialog=true 时总是弹系统“保存/另存为”对话框（可输入文件名），用于菜单的“另存为/导出”。
  // 本地模式写盘；远程模式回退为浏览器下载。
  const handleSave = async (
    format: 'docx' | 'doc' | 'wps' | 'pdf' | '',
    opts: { forceDialog?: boolean } = {}
  ) => {
    if (!backend) return
    setMenuOpen(false)

    const isLocal = backend.mode === 'local'
    if (!isLocal) {
      return handleDownload((format || 'docx') as 'docx' | 'doc' | 'wps' | 'pdf')
    }

    // 本地模式：写盘
    const fmt = (format ||
      (filePath.toLowerCase().endsWith('.docx') ? 'docx' :
       filePath.toLowerCase().endsWith('.doc') ? 'doc' :
       filePath.toLowerCase().endsWith('.wps') ? 'wps' :
       filePath.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx')) as 'docx' | 'doc' | 'wps' | 'pdf'

    // 仅当用户通过本地“打开”得到真实磁盘路径时（含盘符），才允许“快速保存”覆盖
    const hasRealPath = /^[A-Za-z]:[\\/]/.test(filePath)
    let target = filePath
    if (opts.forceDialog || !hasRealPath) {
      const baseName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || ''
      const defaultName = doc.meta?.title || baseName || t('app.untitled')
      target = await backend.saveFileDialog(defaultName, fmt)
      if (!target) return // 用户取消
    }

    setLoading(true)
    showToast(t('app.saving'))
    try {
      await backend.writeDocument(target, fmt, doc)
      setFilePath(target)
      const name = target.split(/[\\/]/).pop() || target
      showToast(t('app.saved', { name }))
    } catch (e: any) {
      showToast(t('app.saveFailed', { msg: e.message }))
    } finally {
      setLoading(false)
    }
  }

  // 全局快捷键：Ctrl/Cmd+S 保存，Ctrl/Cmd+O 打开（放在函数声明之后，避免 TDZ）
  useEffect(() => {
    const onShortcut = (e: KeyboardEvent) => {
      const k = (e.key || '').toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault()
        handleSave('', { forceDialog: false })
      } else if ((e.ctrlKey || e.metaKey) && k === 'o') {
        e.preventDefault()
        handleOpenFile()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [handleSave, handleOpenFile])

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
  // 注意: 不用 useMemo — 否则 fileItems 闭包捕获的 handleSave 会捕获到 backend=null 的初始版本，
  // 后续 backend 初始化后 fileItems 不会重建，导致 it.onClick 调用的是 stale handleSave。
  const fileItems: { icon: string; label: string; onClick: () => void; shortcut?: string }[] = [
    { icon: '📂', label: t('app.openFile'), onClick: handleOpenFile, shortcut: 'Ctrl+O' },
  ]
  if (tab === 'document') {
    // “保存”：直接覆盖当前文件（Ctrl+S）；无真实路径时自动转“另存为”
    fileItems.push({ icon: '💾', label: t('app.save'), onClick: () => handleSave('', { forceDialog: false }), shortcut: 'Ctrl+S' })
    // “另存为”：始终弹系统对话框，可输入文件名
    fileItems.push({ icon: '📄', label: t('app.saveDocx'), onClick: () => handleSave('docx', { forceDialog: true }) })
    fileItems.push({ icon: '📃', label: t('app.saveDoc'), onClick: () => handleSave('doc', { forceDialog: true }) })
    fileItems.push({ icon: '📋', label: t('app.saveWps'), onClick: () => handleSave('wps', { forceDialog: true }) })
  }
  // Recent files
  const recentFiles: { name: string; path: string }[] = JSON.parse(localStorage.getItem('samoffice_recent_files') || '[]')
  if (recentFiles.length > 0) {
    fileItems.push({ icon: '🕐', label: t('app.recentFiles') || 'Recent Files', onClick: () => {}, shortcut: '' })
    recentFiles.slice(0, 5).forEach((f, i) => {
      fileItems.push({ icon: '  ' + (i+1) + '.', label: f.name, onClick: () => { /* reopen file */ } })
    })
  }
  if (tab === 'document' || tab === 'spreadsheet' || tab === 'slide' || tab === 'markdown' || tab === 'html') {
    fileItems.push({ icon: '📕', label: t('app.exportPdf'), onClick: () => handleSave('pdf', { forceDialog: true }), shortcut: 'Ctrl+P' })
  }

  return (
    <div className="flex flex-col h-screen overflow-x-hidden" style={{ background: 'var(--color-bg)' }}>
      {/* 合并后的顶部栏: LOGO + 菜单按钮 + Tab + 主题/语言 */}
      {/* 注意: header 不能用 overflow-x-hidden, 因为 CSS 规范规定 overflow-x:hidden 会把
          overflow-y 强制为 auto, 从而裁剪 Files 下拉菜单 (top:100% 垂直超出 header)。
          改用 overflow-visible, 子元素 flex-shrink-0 + whitespace-nowrap 已能避免横向溢出,
          最外层 div 的 overflow-x-hidden 兜底防止页面横向滚动。 */}
      <header
        className="text-white px-2 sm:px-4 py-0 flex items-center gap-1 flex-shrink-0"
        style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #818cf8 100%)',
          boxShadow: '0 2px 12px rgba(79, 70, 229, 0.25)',
          paddingRight: '12px',
          position: 'relative',
          zIndex: 60,
          cursor: 'default',
          userSelect: 'none',
          '--wails-draggable': 'drag' as any, // Wails frameless 窗口 CSS 拖动 (官方方案, WebkitAppRegion 仅 Electron 有效)
        } as any}
        onMouseDown={(e) => {
          // Only start drag if clicking on the header itself (not buttons/inputs)
          const target = e.target as HTMLElement
          if (target.tagName === 'BUTTON' || target.tagName === 'SELECT' || target.tagName === 'INPUT' || target.closest('button') || target.closest('select')) return
          try { (window as any).go?.main?.App?.WindowStartDrag() } catch {}
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
          <div className="relative flex-shrink-0" style={{ zIndex: 62, '--wails-draggable': 'no-drag' as any } as any}>
            <button
              onClick={() => setFilesOpen(!filesOpen)}
              disabled={loading}
              data-testid="menu-files"
              className="px-3 py-1.5 text-xs rounded-md transition-all hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap font-medium"
              style={{ position: 'relative', zIndex: 63 }}
            >
              <span>📁</span>
              <span>{t('app.files') || 'Files'}</span>
              <span style={{ fontSize: '9px', opacity: 0.7 }}>▾</span>
            </button>
            {filesOpen && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 55 }} onClick={() => setFilesOpen(false)} />
                <div className="absolute files-dropdown ribbon-popup_compact min-w-[180px] mt-1" style={{ top: '100%', left: 0, zIndex: 60 }}>
                  {fileItems.map((it) => (
                    <button
                      key={it.label}
                      onClick={() => { it.onClick(); setFilesOpen(false) }}
                      disabled={loading}
                      data-testid={`menu-${it.label.replace(/\s+/g, '-').toLowerCase()}`}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-xs disabled:opacity-50 transition-colors text-left hover:bg-[var(--color-bg-alt)]"
                      style={{ color: 'var(--color-text)' }}
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

        {/* Tab 切换 (可滚动容器，避免移动端越界) */}
        <div className="header-tabs-scroll flex items-center gap-0.5" style={{ '--wails-draggable': 'no-drag' as any } as any}>
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
              className="px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1 rounded-md flex-shrink-0"
              style={{
                // 统一 Tab 选中态：半透明白底 + 底部高亮条，与 ribbon tab 视觉语言一致
                background: tab === tt.id ? 'rgba(255,255,255,0.22)' : 'transparent',
                color: tab === tt.id ? '#ffffff' : 'rgba(255,255,255,0.75)',
                boxShadow: tab === tt.id ? 'inset 0 -2px 0 0 rgba(255,255,255,0.9)' : 'none',
              }}
            >
              <span>{tt.icon}</span>
              <span className="hidden md:inline">{tt.label}</span>
            </button>
          ))}
        </div>

        {/* 主题切换 */}
        <button
          onClick={toggleTheme}
          data-tooltip={`${t('app.theme')}: ${themeLabel}`}
          data-testid="theme-toggle"
          aria-label={t('app.theme')}
          className="p-2 rounded-md hover:bg-white/15 transition-all flex-shrink-0" style={{ '--wails-draggable': 'no-drag' as any } as any}
        >
          <span className="text-sm">{themeIcon}</span>
        </button>

        {/* 语言下拉 */}
        <Dropdown
          className="text-xs rounded-md px-1 py-1"
          style={{ minWidth: '52px', background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', height: 26, ['--wails-draggable' as any]: 'no-drag' }}
          value={lang}
          onChange={v => setLang(v as 'en' | 'zh')}
          options={[
            { label: '中文', value: 'zh' },
            { label: 'EN', value: 'en' },
          ]}
        />

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
            style={{ background: 'rgba(225, 29, 72, 0.9)', minWidth: '28px', justifyContent: 'center' }}
            aria-label={`${spellErrors.length} spelling errors`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
            <span>{spellErrors.length}</span>
          </button>
        )}

        {/* 窗口控制按钮 (最小化/最大化/关闭) — 右对齐到右上角 */}
        <div className="flex items-center gap-0.5 flex-shrink-0" style={{ marginLeft: 'auto', '--wails-draggable': 'no-drag' as any } as any}>
          <button
            onClick={() => { try { (window as any).go.main.App.WindowMinimize() } catch {} }}
            className="w-8 h-8 rounded-md hover:bg-white/20 transition-all flex items-center justify-center"
            title={t('app.minimize') || 'Minimize'}
          >
            <svg width="12" height="12" viewBox="0 0 12 12"><rect y="5" width="12" height="2" fill="white" /></svg>
          </button>
          <button
            onClick={() => { try { (window as any).go.main.App.WindowMaximize() } catch {} }}
            className="w-8 h-8 rounded-md hover:bg-white/20 transition-all flex items-center justify-center"
            title={t('app.maximize') || 'Maximize'}
          >
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="white" strokeWidth="1.5" /></svg>
          </button>
          <button
            onClick={() => { try { (window as any).go.main.App.WindowClose() } catch {} }}
            className="w-8 h-8 rounded-md hover:bg-red-500 transition-all flex items-center justify-center"
            title={t('app.close') || 'Close'}
          >
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1 L11 11 M11 1 L1 11" stroke="white" strokeWidth="1.5" /></svg>
          </button>
        </div>
      </header>

      {/* 移动端下拉菜单 — 复用 files-dropdown 样式保持视觉统一 */}
      {isMobile && menuOpen && (
        <div
          className="files-dropdown border-b animate-fade-in flex-shrink-0"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
            borderRadius: 0,
            boxShadow: 'none',
            position: 'relative',
            zIndex: 50,
          }}
        >
          {fileItems.map((it, idx) => (
            <button
              key={it.label}
              onClick={it.onClick}
              disabled={loading}
              data-testid={`mobile-menu-item-${idx}`}
              className="block w-full text-left px-4 py-3 text-sm border-b disabled:opacity-50 flex items-center gap-3 transition-colors hover:bg-[var(--color-bg-alt)]"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
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
            <DocumentEditor
              document={doc}
              spellErrors={spellErrors}
              onChange={(d) => setDoc(d)}
              onSpellCheck={triggerSpellCheck}
              zoom={docZoom}
              onZoomChange={setDocZoom}
              backend={backend ?? undefined}
            />
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
        style={{ background: 'var(--color-text)', color: 'var(--color-surface)', flexWrap: 'nowrap' }}
      >
        <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
          {loading && (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0"></span>
          )}
          <span className="truncate" style={{ maxWidth: '180px' }}>
            {filePath || t('app.ready')}
          </span>
        </div>
        <div className="flex-1 min-w-0" />
        {tab === 'document' && (
          <span className="hidden md:inline opacity-70 flex-shrink-0 whitespace-nowrap">
            {wordCount} {t('app.words')} · {charCount} {t('app.chars')}
          </span>
        )}
        {spellErrors.length > 0 && (
          <span className="opacity-70 hidden md:inline flex-shrink-0 whitespace-nowrap">{spellErrors.length} {t('app.spellErrors')}</span>
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
