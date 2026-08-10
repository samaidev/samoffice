import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createBackend } from './services/backend'
import type { Backend, Document, SpellError } from './types/udm'
import type { SlideData } from './lib/openroute'
import { DocumentEditor } from './editors/document/DocumentEditor'
import { SpreadsheetEditor } from './editors/spreadsheet/SpreadsheetEditor'
import { SlideEditor } from './editors/slide/SlideEditor'
import { MarkdownHtmlEditor } from './editors/markdown/MarkdownHtmlEditor'
import { PdfViewer } from './editors/pdf/PdfViewer'
import { AboutPage } from './components/AboutPage'
import { useI18n } from './i18n'
import { usePopupAutoFlip } from './hooks/usePopupAutoFlip'
import { Dropdown } from './components/Dropdown'
import { ConfirmDialog } from './components/ConfirmDialog'
import type { ConfirmChoice } from './components/ConfirmDialog'
import { decideOpen } from './lib/openroute'

type Tab = 'document' | 'spreadsheet' | 'slide' | 'markdown' | 'html' | 'pdf' | 'about'

// 一个已打开的文件窗口（标签页）。持有该窗口的完整数据快照，切换时恢复，避免多文件互相覆盖。
interface OpenWindow {
  id: number
  type: Tab                      // 不含 'about'
  path: string
  title: string                 // 文件名（不含路径）
  doc?: Document
  md?: string
  html?: string
  sheets?: { name: string; cells: Record<string, any> }[]
  slides?: SlideData[]
  sheetSnapshot?: { name: string; rows: number; cols: number; cells: Record<string, any> }[] | null
  slideSnapshot?: SlideData[] | null
  pdf?: { url: string; name: string; nonce: number } | null
  sheetEpoch: number
  slideEpoch: number
  zoom: number
  spellErrors: SpellError[]
  // 上次保存（或刚打开）时的内容指纹。与当前内容指纹比对得出"脏"状态，
  // 改回原样即不再算脏，避免误报。pdf 为只读视图，恒不脏。
  savedFingerprint: string
}

type Theme = 'light' | 'dark' | 'auto'

// 规范化外部传入的文件路径：去掉首尾引号/空白，以及 file:// / file:\\ 协议前缀，
// 并把 /C:/xxx 还原为 C:/xxx，确保 os.ReadFile / ReadFile 能正确定位文件。
function normalizePath(raw: string): string {
  let p = String(raw).trim().replace(/^["']|["']$/g, '')
  const m = p.match(/^file:\/\/+\/?(.+)$/i) || p.match(/^file:\\+(.+)$/i)
  if (m) p = m[1]
  p = p.replace(/^\/([A-Za-z]:[\\/])/, '$1')
  return p.trim()
}

// base64 → Blob，用于本地模式读取 PDF 等二进制文件后在 WebView 中预览
function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// base64 → UTF-8 字符串，用于读取 Markdown/HTML 等文本文件原文
function base64ToUtf8(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

// 读取文本文件原文（base64）：优先使用 OpenFile 一并返回的 rawContent，
// 这样在远程/网页模式下（readFile 不可用）也能正确加载 Markdown/HTML 内容；
// 本地模式则回退到 backend.readFile。
async function loadRawText(result: any, backend: Backend | null, path: string): Promise<string> {
  if (result && typeof result.rawContent === 'string' && result.rawContent.length > 0) {
    return result.rawContent
  }
  if (backend?.readFile) {
    return await backend.readFile(path)
  }
  throw new Error('无法读取文件原文：rawContent 为空且 readFile 不可用')
}



function App() {
  const { t, lang, setLang } = useI18n()
  // 全局 popup 自动定位：检测越界并翻转对齐
  usePopupAutoFlip()

  // 默认文档模板：保留一个空段落（ProseMirror 的 doc 节点必须有内容），
  // 但不带任何欢迎/占位文字，满足“默认模板为空”的需求。
  const emptyDoc = useMemo<Document>(() => ({
    meta: { title: '' },
    blocks: [{ inline: [{ content: '' }], style: '', align: '' }]
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
  const [doc, setDoc] = useState<Document>(emptyDoc)
  const [spellErrors, setSpellErrors] = useState<SpellError[]>([])
  // 打开 xlsx/xls 时传入表格编辑器的初始 sheet 数据；epoch 用于强制重挂载以加载新文件
  const [sheetInitial, setSheetInitial] = useState<{ name: string; cells: Record<string, any> }[] | null>(null)
  // SpreadsheetEditor 回传的完整工作簿快照（含边框/合并/填充），用于保存 xlsx
  const [sheetSnapshot, setSheetSnapshot] = useState<{ name: string; rows: number; cols: number; cells: Record<string, any> }[] | null>(null)
  const [sheetEpoch, setSheetEpoch] = useState(0)
  // SlideEditor 回传的最新幻灯片快照（EMU 坐标），用于保存 pptx
  const [slideSnapshot, setSlideSnapshot] = useState<SlideData[] | null>(null)
  // 待打开的 PDF（通过 prop 传给 PdfViewer，避免 setTimeout+全局事件竞态导致 loadPdf 未触发）
  const [pdfOpenSignal, setPdfOpenSignal] = useState<{ url: string; name: string; nonce: number } | null>(null)
  // 打开 pptx/ppt 时传入幻灯片编辑器的初始幻灯片数据；epoch 用于强制重挂载以加载新文件
  const [slideInitial, setSlideInitial] = useState<{ title: string; content: string; notes?: string }[] | null>(null)
  const [slideEpoch, setSlideEpoch] = useState(0)

  // === 多窗口（多标签）模型 ===
  // 默认不显示任何类型选项卡，只有"关于"；打开文件后才出现对应类型的窗口标签。
  // 打开同类型多个文件时，每个窗口一个标签，形如"文档：文件名"。
  const [windows, setWindows] = useState<OpenWindow[]>([])
  const [activeWindowId, setActiveWindowId] = useState<number | null>(null)
  const [dragTabId, setDragTabId] = useState<number | null>(null)
  const winIdRef = useRef(1)
  const activeWindow = windows.find(w => w.id === activeWindowId) || null

  // 当前激活窗口对应的"逻辑 tab"（用于渲染对应编辑器）；无激活窗口时为 about
  const tab = activeWindow ? activeWindow.type : 'about'
  // 当前激活窗口的文件路径
  const filePath = activeWindow ? activeWindow.path : ''

  // 文件名截断：超过 maxLen 个字用 … 省略
  const truncateName = (s: string, maxLen = 6) =>
    !s ? '' : s.length > maxLen ? s.slice(0, maxLen) + '…' : s
  // 类型前缀
  const typePrefix = (type: Tab) =>
    ({ document: t('tab.document'), spreadsheet: t('tab.spreadsheet'), slide: t('tab.slide'), markdown: t('tab.markdown'), html: t('tab.html'), pdf: t('tab.pdf') } as Record<string, string>)[type] || '文档'

  // 文档指纹：从文件解析出的 UDM 与 proseMirrorToUDM 回流的 UDM 在结构上并不全等
  // （后者是 PM 归一化结果，字段更规整、可选属性被补齐或省略）。若直接 JSON 比对，
  // 打开→编辑→撤销回原样后仍会被判为脏。故统一提炼为"语义内容"再比对：
  // 逐块取 [块类型, 纯文本, 关键格式]，忽略纯表现层与 undefined/空值差异。
  const docFingerprint = (d: any): string => {
    if (!d) return 'null'
    const inlineText = (inline: any): string => {
      if (!Array.isArray(inline)) return ''
      return inline.map((r: any) => {
        if (r == null) return ''
        if (typeof r === 'string') return r
        // 文本内容在两种来源中可能落在 content / text 字段
        if (typeof r.content === 'string') return r.content
        if (typeof r.text === 'string') return r.text
        if (Array.isArray(r.inline)) return inlineText(r.inline)
        return ''
      }).join('')
    }
    const blockSig = (b: any): any => {
      if (!b) return null
      if (Array.isArray(b.rows)) {
        // 表格：逐单元格取文本
        return ['table', b.rows.map((row: any) =>
          (row?.cells ?? row ?? []).map((c: any) => inlineText(c?.inline ?? c?.content ?? [])))]
      }
      if (b.type === 'image' || b.src) return ['image', b.src ?? '']
      if (b.formula || b.type === 'math') return ['math', b.formula ?? b.latex ?? '']
      return [b.type ?? 'p', b.level ?? 0, b.style ?? '', inlineText(b.inline)]
    }
    const blocks = Array.isArray(d.blocks) ? d.blocks.map(blockSig) : []
    // 文档级配置也要纳入：改了密码保护 / 页码设置同样算未保存改动
    return JSON.stringify({
      title: d.meta?.title ?? '',
      blocks,
      protect: d.protect ?? null,
      pageNumber: d.pageNumber ?? null,
      styles: d.styles ?? null,
    })
  }

  // 计算一个窗口的内容指纹：只纳入"会被写盘的内容"，排除 zoom / 拼写结果 / epoch
  // 等纯视图状态，避免缩放、拼写检查之类的操作被误判为文档改动。
  const fingerprintOf = (w: Partial<OpenWindow>): string => {
    switch (w.type) {
      case 'document':
        return docFingerprint(w.doc)
      case 'markdown':
        return w.md ?? ''
      case 'html':
        return w.html ?? ''
      case 'spreadsheet': {
        // 编辑器挂载即回传 snapshot，其结构（含 rows/cols）比初始 sheets 更宽，
        // 直接比对会导致"一打开就脏"。故统一归一化到 {name, cells}，且剔除空单元格。
        const src = w.sheetSnapshot ?? w.sheets ?? null
        if (!src) return 'null'
        return JSON.stringify(src.map((s: any) => {
          const cells: Record<string, any> = {}
          for (const [k, v] of Object.entries(s.cells ?? {})) {
            // 空值单元格在两种来源中表现不一致（缺失 vs 空对象），统一忽略
            if (v == null) continue
            if (typeof v === 'object' && Object.keys(v as object).length === 0) continue
            cells[k] = v
          }
          return { name: s.name, cells }
        }))
      }
      case 'slide': {
        const src = w.slideSnapshot ?? w.slides ?? null
        if (!src) return 'null'
        return JSON.stringify(src.map((s: any) => ({
          title: s.title ?? '', content: s.content ?? '', notes: s.notes ?? '',
        })))
      }
      default:
        return '' // pdf / about：只读，恒不脏
    }
  }

  // 把当前顶层编辑状态捕获为窗口快照（用于切换/打开时保存当前窗口的改动）
  const captureActive = (): Partial<OpenWindow> => ({
    doc,
    md: mdContent,
    html: htmlContent,
    sheets: sheetInitial ?? undefined,
    slides: slideInitial ?? undefined,
    sheetSnapshot: sheetSnapshot ?? undefined,
    slideSnapshot: slideSnapshot ?? undefined,
    pdf: pdfOpenSignal ?? undefined,
    sheetEpoch,
    slideEpoch,
    zoom: docZoom,
    spellErrors,
  })
  // 把窗口快照写回顶层编辑状态（切换到该窗口时恢复）
  const applyWindow = (w: OpenWindow) => {
    setDoc(w.doc ?? emptyDoc)
    setMdContent(w.md ?? sampleMd)
    setHtmlContent(w.html ?? '')
    setSheetInitial(w.sheets ? w.sheets.map(s => ({ name: s.name, cells: s.cells })) : null)
    setSlideInitial(w.slides ? w.slides.map(s => ({ title: s.title, content: s.content, notes: s.notes })) : null)
    setSheetSnapshot(w.sheetSnapshot ?? null)
    setSlideSnapshot(w.slideSnapshot ?? null)
    setPdfOpenSignal(w.pdf ?? null)
    setSheetEpoch(w.sheetEpoch)
    setSlideEpoch(w.slideEpoch)
    setDocZoom(w.zoom)
    setSpellErrors(w.spellErrors ?? [])
  }

  // 某个窗口当前是否有未保存改动。激活窗口需先用顶层实时状态覆盖，
  // 因为编辑中的最新内容还没回写进 windows 数组。
  const isWindowDirty = (w: OpenWindow): boolean => {
    if (w.type === 'pdf' || w.type === 'about') return false
    const live = w.id === activeWindowId ? { ...w, ...captureActive(), type: w.type } : w
    return fingerprintOf(live) !== w.savedFingerprint
  }

  // 统一处理打开结果：表格类文件切换到表格视图，其余切换到文档视图
  const openResult = async (result: any) => {
    const path: string = result.path || ''
    const decision = decideOpen(path, result.document)
    const sheets = decision.sheets
    const slides = decision.slides
    const isSheet = decision.tab === 'spreadsheet'
    // 当前打开文件要进入的目标视图类型
    const targetTab: Tab = isSheet ? 'spreadsheet'
      : decision.tab === 'slide' ? 'slide'
      : decision.tab === 'markdown' ? 'markdown'
      : decision.tab === 'html' ? 'html'
      : decision.tab === 'pdf' ? 'pdf'
      : 'document'
    try {
      const name = path.split(/[\\/]/).pop() || path
      const recent: { name: string; path: string }[] = JSON.parse(localStorage.getItem('samoffice_recent_files') || '[]')
      const filtered = recent.filter(r => r.path !== path)
      filtered.unshift({ name, path })
      localStorage.setItem('samoffice_recent_files', JSON.stringify(filtered.slice(0, 5)))
    } catch {}
    // 先保存当前激活窗口的编辑内容（保证切换/打开不会丢失改动）
    let savedSnapshot: Partial<OpenWindow> | null = null
    setWindows(prev => {
      if (activeWindowId == null) return prev
      savedSnapshot = captureActive()
      return prev.map(w => (w.id === activeWindowId ? { ...w, ...savedSnapshot! } : w))
    })

    // 用局部变量承接本次要载入的状态，便于同时写进窗口快照
    const win: Partial<OpenWindow> = { type: targetTab, path, title: path.split(/[\\/]/).pop() || path }
    if (isSheet && sheets && sheets.length) {
      let finalSheets = sheets
      // xlsx 直接走原生读取，完整保留边框/合并/填充等格式（绕开有损的 UDM 中转）
      if (/\.xlsx?$/i.test(path) && backend) {
        try {
          const json = await backend.readXLSX(path)
          const parsed = JSON.parse(json)
          if (parsed && Array.isArray(parsed.sheets) && parsed.sheets.length) {
            finalSheets = parsed.sheets
          }
        } catch (e) {
          console.warn('readXLSX failed, fall back to UDM sheets', e)
        }
      }
      setSheetInitial(finalSheets)
      setSheetEpoch(e => e + 1)
      setSheetSnapshot(null)
      win.sheets = finalSheets
      win.sheetEpoch = sheetEpoch + 1
    } else if (decision.tab === 'slide') {
      // 演示文稿：把 pptx 解析出的幻灯片数据传入幻灯片编辑器
      const initSlides = slides && slides.length ? slides : []
      setSlideInitial(initSlides)
      setSlideEpoch(e => e + 1)
      setSlideSnapshot(null)
      win.slides = initSlides
      win.slideEpoch = slideEpoch + 1
    } else if (decision.tab === 'markdown') {
      setSheetInitial(null)
      let md = sampleMd
      try {
        const b64 = await loadRawText(result, backend, path)
        md = base64ToUtf8(b64)
      } catch (e: any) {
        console.error('read markdown failed', e)
      }
      setMdContent(md)
      win.md = md
    } else if (decision.tab === 'html') {
      setSheetInitial(null)
      let html = ''
      try {
        const b64 = await loadRawText(result, backend, path)
        html = base64ToUtf8(b64)
      } catch (e: any) {
        console.error('read html failed', e)
      }
      setHtmlContent(html)
      win.html = html
    } else if (decision.tab === 'pdf') {
      setSheetInitial(null)
      try {
        // 读取 PDF 原始字节：优先 backend.readFile；否则直接走 Wails 绑定兜底
        let b64: string | undefined
        if (backend?.readFile) {
          b64 = await backend.readFile(path)
        } else {
          const appRead = (window as any).go?.main?.App?.ReadFile
          if (typeof appRead === 'function') b64 = await appRead(path)
        }
        if (b64) {
          const blob = base64ToBlob(b64, 'application/pdf')
          const url = URL.createObjectURL(blob)
          const sig = { url, name: path, nonce: Date.now() }
          setPdfOpenSignal(sig)
          win.pdf = sig
        } else {
          showToast(t('doc.openPdfFailed', { name: path }) || 'PDF 读取失败')
        }
      } catch (e: any) {
        console.error('read pdf failed', e)
        showToast(t('doc.openPdfFailed', { name: path }) || 'PDF 读取失败')
      }
    } else {
      setSheetInitial(null)
      setDoc(result.document)
      try { triggerSpellCheck(JSON.stringify(result.document?.blocks || [])) } catch {}
      win.doc = result.document
    }
    // 写入默认窗口字段
    win.zoom = docZoom
    win.spellErrors = []

    // 同 path 的窗口已存在则更新，否则新建；切换窗口时通过 applyWindow 恢复
    // 注意：先在外面算出 targetId（setWindows 的回调是异步的，不能在回调里赋值后再同步读取）
    const existingIdx = windows.findIndex(w => w.path === path && w.type === targetTab)
    const targetId = existingIdx >= 0 ? windows[existingIdx].id : winIdRef.current++
    const fullWin: OpenWindow = {
      id: targetId, type: targetTab, path, title: win.title || path.split(/[\\/]/).pop() || path,
      ...win,
      sheetEpoch: win.sheetEpoch ?? 0, slideEpoch: win.slideEpoch ?? 0,
      zoom: win.zoom ?? 1, spellErrors: win.spellErrors ?? [],
      // 刚打开即为"已保存"基线
      savedFingerprint: fingerprintOf({ ...win, type: targetTab }),
    } as OpenWindow
    setWindows(prev => {
      const idx = prev.findIndex(w => w.path === path && w.type === targetTab)
      return idx >= 0 ? prev.map(w => (w.id === targetId ? fullWin : w)) : [...prev, fullWin]
    })
    setActiveWindowId(targetId)
    applyWindow({
      id: targetId, type: targetTab, path, title: win.title || path.split(/[\\/]/).pop() || path,
      ...win,
      sheetEpoch: win.sheetEpoch ?? 0, slideEpoch: win.slideEpoch ?? 0,
      zoom: win.zoom ?? 1, spellErrors: win.spellErrors ?? [],
    } as OpenWindow)
    showToast(t('app.opened', { name: path }))
  }

  // 直接用一个已准备好的数据对象（如已读取的 PDF blob）激活/新建一个窗口标签。
  // 与 openResult 共用"保存当前窗口快照 + 新建/复用窗口 + 切换激活"的逻辑。
  const activateWindowData = (win: Partial<OpenWindow> & { type: Tab; path: string; title: string }) => {
    setWindows(prev => activeWindowId == null ? prev : prev.map(w => (w.id === activeWindowId ? { ...w, ...captureActive() } : w)))
    const existingIdx = windows.findIndex(w => w.path === win.path && w.type === win.type)
    const targetId = existingIdx >= 0 ? windows[existingIdx].id : winIdRef.current++
    const full = {
      id: targetId, ...win,
      sheetEpoch: win.sheetEpoch ?? 0, slideEpoch: win.slideEpoch ?? 0,
      zoom: win.zoom ?? docZoom, spellErrors: win.spellErrors ?? [],
      savedFingerprint: fingerprintOf(win),
    } as OpenWindow
    setWindows(prev => {
      const idx = prev.findIndex(w => w.path === win.path && w.type === win.type)
      return idx >= 0 ? prev.map(w => (w.id === targetId ? full : w)) : [...prev, full]
    })
    setActiveWindowId(targetId)
    applyWindow({
      id: targetId, ...win,
      sheetEpoch: win.sheetEpoch ?? 0, slideEpoch: win.slideEpoch ?? 0,
      zoom: win.zoom ?? docZoom, spellErrors: win.spellErrors ?? [],
    } as OpenWindow)
  }
  const [toast, setToast] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [spellPanelOpen, setSpellPanelOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('samoffice_theme') as Theme) || 'auto'
  )
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
    const normalizeStartupPath = (raw: string): string => normalizePath(raw)
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
          openResult(result)
          try { app.LogError?.('STARTUP_OPEN_OK: ' + (result.path || path)) } catch {}
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

    // 单实例：第二个 SamOffice 实例(或再次双击文档)启动时会把文件路径通过此事件转发过来。
    // 这里复用当前窗口打开该文件，窗口已在后端最大化，无需新建窗口。
    const onSecondInstance = (args: any) => {
      const arr = Array.isArray(args) ? args : [args]
      const path = arr.find((a: any) => typeof a === 'string' && /\.(docx?|xlsx?|pptx?|ppsx?|potx?|pdf|md|markdown|mdx|html?|txt|rtf|csv)$/i.test(a))
      if (!path) return
      void openViaApp(path)
    }
    const rt: any = (window as any).runtime
    if (rt && typeof rt.EventsOn === 'function') {
      rt.EventsOn('second-instance-open', onSecondInstance)
    }

    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => {
      cancelled = true
      clearTimeout(timer)
      window.removeEventListener('resize', checkMobile)
      const rt: any = (window as any).runtime
      if (rt && typeof rt.EventsOff === 'function') {
        rt.EventsOff('second-instance-open', onSecondInstance)
      }
    }
  }, [])

  // 由单实例事件(onSecondInstance)调用：在当前窗口中打开文件，不新建窗口。
  // 直接复用统一的 openResult 处理各类型文件（docx/xlsx/pdf/md/html），后端已负责最大化窗口。
  const openViaApp = async (path: string) => {
    if (!path) return
    path = normalizePath(path)
    setLoading(true)
    showToast(t('app.opening', { name: path }))
    try {
      const app: any = (window as any).go?.main?.App
      if (!app) {
        showToast(t('app.openFailed', { msg: 'binding not ready' }))
        setLoading(false)
        return
      }
      const result = await app.OpenFile(path)
      if (!result || (result as any).error) {
        showToast(t('app.openFailed', { msg: (result as any)?.error || 'unknown' }))
        setLoading(false)
        return
      }
      // 确保 backend 已就绪（PDF 分支依赖 backend.readFile）
      if (!backend) {
        const b = createBackend()
        setBackend(b)
      }
      await openResult(result)
      setSpellErrors([])
      try { app.SetCurrentFilePath?.(path) } catch {}
    } catch (e: any) {
      console.error('open via app failed', e)
      showToast(t('app.openFailed', { msg: (e?.message || String(e)) + '  (' + path + ')' }))
    } finally {
      setLoading(false)
    }
  }

  // 字数统计
  useEffect(() => {
    const text = doc.blocks?.map(b => {
      if (b && Array.isArray((b as any).inline)) return (b as any).inline.map((i: any) => i.content || '').join('') || ''
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

      // PDF 直接读取字节并打开（走 openResult 统一处理窗口标签）
      if (path.toLowerCase().endsWith('.pdf')) {
        setLoading(true)
        showToast(t('app.opening', { name: path }))
        try {
          if (!backend) { const b = createBackend(); setBackend(b) }
          const result = await (window as any).go?.main?.App?.OpenFile(normalizePath(path))
          if (result && !result.error) {
            await openResult(result)
          } else {
            showToast(t('app.openFailed', { msg: (result as any)?.error || 'unknown' }))
          }
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
        openResult(result)
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

      // PDF 文件：用 blob URL 加载，激活为 PDF 窗口标签
      if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        showToast(t('app.opening', { name: file.name }))
        // 通过 prop 传给 PdfViewer，避免全局事件在组件挂载前触发而丢失
        const url = URL.createObjectURL(file)
        const sig = { url, name: file.name, nonce: Date.now() }
        setPdfOpenSignal(sig)
        activateWindowData({ type: 'pdf', path: file.name, title: file.name, pdf: sig })
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
        // 统一走 openResult 处理各类型（表格/MD/HTML/文档），并创建窗口标签。
        // openResult 内部会按 decideOpen 路由；MD/HTML 分支会读取原文。
        await openResult({ ...result, path: file.name })
        showToast(t('app.opened', { name: file.name }))
      } catch (e: any) {
        showToast(t('app.openFailed', { msg: e.message }))
      } finally {
        setLoading(false)
      }
    }
    input.click()
  }

  // 本地模式：通过 Wails 的 OnFileDrop 获取拖放文件的真实磁盘路径（浏览器 File.path 不可得）
  const openLocalPaths = async (paths: string[]) => {
    if (!paths || paths.length === 0) return
    if (!backend) return

    for (const rawPath of paths) {
      const path = normalizePath(rawPath)
      const lower = path.toLowerCase()
      const name = path.split(/[\\/]/).pop() || path
      setLoading(true)
      showToast(t('app.opening', { name: path }))
      try {
        if (lower.endsWith('.pdf')) {
          const result = await (window as any).go?.main?.App?.OpenFile(path)
          if (result && !result.error) await openResult(result)
          else showToast(t('app.openFailed', { msg: (result as any)?.error || 'unknown' }))
        } else {
          const result = await backend.openFile(path)
          openResult(result)
        }
      } catch (e: any) {
        showToast(t('app.openFailed', { msg: e.message }))
      } finally {
        setLoading(false)
      }
    }
  }

  // 远程模式：用拖入的 File 对象走 /api/doc/open 上传
  const openDroppedFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (!backend) return

    for (const file of Array.from(files)) {
      const name = file.name || ''
      const lower = name.toLowerCase()
      if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
        showToast(t('app.opening', { name }))
        const url = URL.createObjectURL(file)
        const sig = { url, name, nonce: Date.now() }
        setPdfOpenSignal(sig)
        activateWindowData({ type: 'pdf', path: name, title: name, pdf: sig })
        continue
      }
      setLoading(true)
      showToast(t('app.opening', { name }))
      try {
        const base = await getApiBase()
        const form = new FormData()
        form.append('file', file)
        const r = await fetch(`${base}/api/doc/open`, { method: 'POST', body: form })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const result = await r.json()
        await openResult({ ...result, path: name })
        showToast(t('app.opened', { name }))
      } catch (e: any) {
        showToast(t('app.openFailed', { msg: e.message }))
      } finally {
        setLoading(false)
      }
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    // 不 stopPropagation：本地模式由 Wails 在 window 上注册的 onDrop 接管，
    // 若此处拦截会阻断 window 级回调导致 OnFileDrop 永不触发。
    setDragOver(false)
    // 本地模式由 Wails OnFileDrop 提供真实路径；远程模式走上传
    if (backend?.mode !== 'local') openDroppedFiles(e.dataTransfer?.files ?? null)
  }
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  // 注册 Wails 文件拖放（仅本地模式）：window.runtime.OnFileDrop 激活原生拖放，回调拿到真实磁盘路径
  useEffect(() => {
    if (!backend || backend.mode !== 'local') return
    const rt = (window as any).runtime
    if (!rt || typeof rt.OnFileDrop !== 'function') return
    const off = rt.OnFileDrop((_x: number, _y: number, paths: string[]) => {
      setDragOver(false)
      openLocalPaths(paths || [])
    }, false)
    return () => { try { rt.OnFileDropOff() } catch { /* noop */ }; if (typeof off === 'function') off() }
  }, [backend])

  // 远程模式：沿用原下载逻辑（浏览器下载，带文件名）
  const handleDownload = async (format: 'docx' | 'pdf') => {
    if (!backend) return
    setMenuOpen(false)
    setLoading(true)
    showToast(t('app.exporting', { format: format.toUpperCase() }))
    try {
      const endpointMap: Record<string, string> = {
        docx: '/api/doc/save',
        pdf: '/api/doc/export-pdf',
      }
      const mimeMap: Record<string, string> = {
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pdf: 'application/pdf',
      }
      const endpoint = endpointMap[format] || '/api/doc/save'
      const mime = mimeMap[format] || 'application/octet-stream'
      // 注意：这里是在原 doc 基础上"清洗 blocks"，而不是重建一个新对象。
      // 之前写成 { meta, blocks } 字面量，会把 protect / styles 等文档级字段整个丢掉，
      // 导致设了密码保护后导出的文件没有保护。
      const safeDoc: Document = {
        ...(doc as any),
        meta: doc.meta || { title: t('app.untitled') },
        blocks: (doc.blocks || []).map((b: any) => {
          // 结构型块（公式/图片/脚注/表格等）保持原样，不再误当成纯文本处理
          if (b && (b.formula || b.type === 'math' || b.type === 'image' || b.type === 'footnote' || b.type === 'table' || b.type === 'footnote_section' || b.src || b.rows || b.items)) return b
          if (b && Array.isArray(b.inline)) return b
          if (b && typeof b.code === 'string') return { inline: [{ content: b.code }] }
          if (b && typeof b.src === 'string') return { inline: [{ content: '[图片]' }] }
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
    format: 'docx' | 'pdf' | '',
    opts: { forceDialog?: boolean } = {}
  ) => {
    if (!backend) return
    setMenuOpen(false)

    // 保存成功后同步当前窗口标签的路径与文件名，并把当前内容记为新的"已保存"基线
    // （导出 PDF 不算保存原文档，故那条分支不调用本函数）
    const syncActivePath = (target: string) =>
      setWindows(prev => prev.map(w => {
        if (w.id !== activeWindowId) return w
        const merged = { ...w, ...captureActive(), type: w.type }
        return {
          ...merged,
          path: target,
          title: target.split(/[\\/]/).pop() || target,
          savedFingerprint: fingerprintOf(merged),
        } as OpenWindow
      }))

    const isLocal = backend.mode === 'local'
    if (!isLocal) {
      return handleDownload((format || 'docx') as 'docx' | 'pdf')
    }

    // 本地模式：写盘
    // 演示文稿选项卡：把幻灯片（EMU 坐标）序列化为真正的 .pptx
    if (tab === 'slide') {
      const snaps = slideSnapshot || slideInitial || []
      if (!snaps.length) {
        showToast(t('app.noSlides'))
        return
      }
      const hasRealPath = /^[A-Za-z]:[\\/]/.test(filePath) && /\.pptx?$/i.test(filePath)
      let target = filePath
      if (opts.forceDialog || !hasRealPath) {
        const baseName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || ''
        const defaultName = baseName || t('app.untitled')
        target = await backend.saveFileDialog(defaultName, 'pptx')
        if (!target) return // 用户取消
        if (!/\.pptx?$/i.test(target)) target += '.pptx'
      }
      setLoading(true)
      try {
        await backend.writePPTX(target, JSON.stringify({ pageW: 12192000, pageH: 6858000, slides: snaps }))
        syncActivePath(target)
        const name = target.split(/[\\/]/).pop() || target
        showToast(t('app.saved', { name }))
      } catch (e: any) {
        showToast(t('app.saveFailed', { msg: e.message }))
      } finally {
        setLoading(false)
      }
      return
    }
    // Markdown / HTML 选项卡：直接写纯文本（保留原文），不走 UDM
    if (tab === 'markdown' || tab === 'html') {
      const text = tab === 'markdown' ? mdContent : htmlContent
      const ext = tab === 'markdown' ? 'md' : 'html'
      const hasRealPath = /^[A-Za-z]:[\\/]/.test(filePath) && filePath.toLowerCase().endsWith('.' + ext)
      let target = filePath
      if (opts.forceDialog || !hasRealPath) {
        const baseName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || ''
        const defaultName = baseName || t('app.untitled')
        target = await backend.saveFileDialog(defaultName, ext)
        if (!target) return // 用户取消
        if (!target.toLowerCase().endsWith('.' + ext)) target += '.' + ext
      }
      try {
        await backend.writeTextFile(target, text ?? '')
        syncActivePath(target)
        const name = target.split(/[\\/]/).pop() || target
        showToast(t('app.saved', { name }))
      } catch (e: any) {
        showToast(t('app.saveFailed', { msg: e.message }))
      } finally {
        setLoading(false)
      }
      return
    }

    const fmt = (format ||
      (filePath.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx')) as 'docx' | 'pdf'

    // 仅当用户通过本地“打开”得到真实磁盘路径时（含盘符），才允许“快速保存”覆盖
    const hasRealPath = /^[A-Za-z]:[\\/]/.test(filePath)
    let target = filePath
    if (opts.forceDialog || !hasRealPath) {
      const baseName = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || ''
      // 另存为时优先使用当前文件名的基名，方便用户在原文件名后追加后缀保存；
      // 仅在无文件路径（新建文档）时回退到文档标题或“未命名”。
      const defaultName = baseName || doc.meta?.title || t('app.untitled')
      target = await backend.saveFileDialog(defaultName, fmt)
      if (!target) return // 用户取消
    }

    // Excel 文件走原生 xlsx 写盘（保留值/格式/合并/行列增删），绕开 UDM 中转
    if (/\.xlsx?$/i.test(filePath) && tab === 'spreadsheet') {
      try {
        await backend.writeXLSX(target, JSON.stringify({ sheets: sheetSnapshot || [] }))
        syncActivePath(target)
        const name = target.split(/[\\/]/).pop() || target
        showToast(t('app.saved', { name }))
      } catch (e: any) {
        showToast(t('app.saveFailed', { msg: e.message }))
      } finally {
        setLoading(false)
      }
      return
    }

    setLoading(true)
    showToast(t('app.saving'))
    try {
      await backend.writeDocument(target, fmt, doc)
      // 导出 PDF 不改变文档本体的"已保存"状态，也不应改写标签路径
      if (fmt !== 'pdf') syncActivePath(target)
      const name = target.split(/[\\/]/).pop() || target
      showToast(t('app.saved', { name }))
    } catch (e: any) {
      showToast(t('app.saveFailed', { msg: e.message }))
    } finally {
      setLoading(false)
    }
  }

  // === 未保存更改的关闭确认 ===
  // pending 描述"用户想做什么"，等确认框给出选择后再继续执行。
  // queue 为待处理的脏窗口 id 列表（退出应用时可能有多个，逐个询问）。
  const [pendingClose, setPendingClose] = useState<
    { kind: 'tab'; winId: number } | { kind: 'app'; queue: number[] } | null
  >(null)

  // 真正移除一个标签（不做任何询问）
  const removeWindow = (winId: number) => {
    setWindows(prev => {
      const next = prev.filter(x => x.id !== winId)
      if (winId === activeWindowId) {
        const first = next[0]
        if (first) { setActiveWindowId(first.id); applyWindow(first) }
        else { setActiveWindowId(null); applyWindow({ id: 0, type: 'about', path: '', title: '' } as OpenWindow) }
      }
      return next
    })
  }

  // 退出应用（绕过确认）
  const quitApp = () => {
    try { (window as any).go.main.App.WindowClose() } catch {}
  }

  // 关闭单个标签：脏则先问
  const requestCloseTab = (winId: number) => {
    const w = windows.find(x => x.id === winId)
    if (!w || !isWindowDirty(w)) { removeWindow(winId); return }
    setPendingClose({ kind: 'tab', winId })
  }

  // 关闭整个应用：收集所有脏窗口，逐个询问；都干净则直接退出
  const requestCloseApp = () => {
    const dirtyIds = windows.filter(isWindowDirty).map(w => w.id)
    if (dirtyIds.length === 0) { quitApp(); return }
    setPendingClose({ kind: 'app', queue: dirtyIds })
  }

  // 保存指定窗口：必要时先切换到它（handleSave 作用于当前激活窗口）
  const saveWindowById = async (winId: number) => {
    if (winId !== activeWindowId) {
      const target = windows.find(w => w.id === winId)
      if (!target) return
      setWindows(prev => activeWindowId == null ? prev : prev.map(x => (x.id === activeWindowId ? { ...x, ...captureActive() } : x)))
      setActiveWindowId(winId)
      applyWindow(target)
      // 等一帧，让 applyWindow 的状态生效后再保存
      await new Promise(r => setTimeout(r, 0))
    }
    await handleSave('', { forceDialog: false })
  }

  // 确认框的三种选择
  const onConfirmChoice = async (choice: ConfirmChoice) => {
    const pending = pendingClose
    if (!pending) return
    if (choice === 'cancel') { setPendingClose(null); return }

    if (pending.kind === 'tab') {
      if (choice === 'save') {
        await saveWindowById(pending.winId)
        // 保存可能被用户在系统对话框中取消，此时不关闭，避免丢数据
        const still = windowsRef.current.find(w => w.id === pending.winId)
        if (still && isWindowDirtyRef.current(still)) { setPendingClose(null); return }
      }
      setPendingClose(null)
      removeWindow(pending.winId)
      return
    }

    // kind === 'app'：逐个处理队列
    const [head, ...rest] = pending.queue
    if (choice === 'save') {
      await saveWindowById(head)
      const still = windowsRef.current.find(w => w.id === head)
      if (still && isWindowDirtyRef.current(still)) { setPendingClose(null); return } // 用户取消了保存 → 中止退出
    }
    if (rest.length > 0) {
      setPendingClose({ kind: 'app', queue: rest })
    } else {
      setPendingClose(null)
      quitApp()
    }
  }

  // 供异步回调读取最新值，避免闭包捕获旧 state
  const windowsRef = useRef(windows)
  useEffect(() => { windowsRef.current = windows }, [windows])
  const isWindowDirtyRef = useRef(isWindowDirty)
  useEffect(() => { isWindowDirtyRef.current = isWindowDirty })

  // 监听 Go 侧 OnBeforeClose 发来的关闭请求（标题栏 ✕ / Alt+F4 / 任务栏关闭）
  useEffect(() => {
    const rt = (window as any).runtime
    if (!rt?.EventsOn) return
    rt.EventsOn('app-close-requested', () => { requestCloseApp() })
    return () => { try { rt.EventsOff?.('app-close-requested') } catch {} }
  }, [windows, activeWindowId, doc, mdContent, htmlContent, sheetSnapshot, slideSnapshot])

  // 浏览器/远程模式下的兜底：有脏窗口时触发原生离开确认
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (windowsRef.current.some(w => isWindowDirtyRef.current(w))) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

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
    setTheme(t => {
      const next = t === 'light' ? 'dark' : t === 'dark' ? 'auto' : 'light'
      localStorage.setItem('samoffice_theme', next)
      return next
    })
  }

  const themeIcon = theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🖥'
  const themeLabel = theme === 'light' ? t('app.theme.light') : theme === 'dark' ? t('app.theme.dark') : t('app.theme.auto')

  // 按当前 Tab 决定显示哪些导出/操作按钮
  // Excel 表格不显示 docx 按钮 (不该存成 docx); 演示/MD/HTML 各自合适
  // 顶栏 Files 下拉菜单项 (合并 打开/另存docx/导出PDF 为一个 Files 按钮)
  // 插入图片不放在顶栏 — 每个编辑器内部有自己的插入图片按钮
  // 注意: 不用 useMemo — 否则 fileItems 闭包捕获的 handleSave 会捕获到 backend=null 的初始版本，
  // 后续 backend 初始化后 fileItems 不会重建，导致 it.onClick 调用的是 stale handleSave。
  // 可保存/导出的选项卡（about 不可；pdf 为只读查看也不提供保存）
  const saveable = tab === 'document' || tab === 'spreadsheet' || tab === 'slide' || tab === 'markdown' || tab === 'html'

  const fileItems: { icon: string; label: string; onClick: () => void; shortcut?: string }[] = [
    { icon: '📂', label: t('app.openFile'), onClick: handleOpenFile, shortcut: 'Ctrl+O' },
    {
      icon: '🪟',
      label: t('app.newWindow'),
      onClick: () => {
        const go = (window as any).go?.main?.App
        if (go?.NewWindow) go.NewWindow()
        else if ((window as any).runtime?.WindowNew) (window as any).runtime.WindowNew()
      },
    },
  ]
  if (saveable) {
    // “保存”：直接覆盖当前选项卡文件（Ctrl+S）；无真实路径时自动转“另存为”
    fileItems.push({ icon: '💾', label: t('app.save'), onClick: () => handleSave('', { forceDialog: false }), shortcut: 'Ctrl+S' })
  }
  // 根据当前选项卡类型，动态生成对应的“存为 {ext}”选项
  const saveAsExtByTab: Record<string, string> = {
    document: 'docx',
    spreadsheet: 'xlsx',
    slide: 'pptx',
    markdown: 'md',
    html: 'html',
  }
  const saveAsExt = saveAsExtByTab[tab]
  if (saveAsExt) {
    // 非 document 选项卡（xlsx/pptx/md/html）在 handleSave 内部按 tab 分支处理，
    // 不会走到 fmt 推断，这里统一传 'docx' 作为占位；document 选项卡即真实的 docx。
    fileItems.push({ icon: '📄', label: t('app.saveAsExt', { ext: saveAsExt }), onClick: () => handleSave('docx', { forceDialog: true }) })
  }
  // 导出 PDF 归入“保存/导出”一组，排在最近文件列表之前
  if (saveable) {
    fileItems.push({ icon: '📕', label: t('app.exportPdf'), onClick: () => handleSave('pdf', { forceDialog: true }), shortcut: 'Ctrl+P' })
  }
  // Recent files
  const recentFiles: { name: string; path: string }[] = JSON.parse(localStorage.getItem('samoffice_recent_files') || '[]')
  if (recentFiles.length > 0) {
    fileItems.push({ icon: '🕐', label: t('app.recentFiles') || 'Recent Files', onClick: () => {}, shortcut: '' })
    recentFiles.slice(0, 5).forEach((f, i) => {
      fileItems.push({ icon: '  ' + (i+1) + '.', label: f.name, onClick: () => { void openViaApp(f.path) } })
    })
  }

  return (
    <div
      className="flex flex-col h-screen overflow-x-hidden relative"
      style={{ background: 'var(--color-bg)' }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragOver && (
        <div
          className="absolute inset-0 z-[80] flex items-center justify-center pointer-events-none"
          style={{ background: 'rgba(79,70,229,0.12)', border: '3px dashed rgba(79,70,229,0.6)' }}
        >
          <div className="px-5 py-3 rounded-lg text-sm font-semibold" style={{ background: 'rgba(79,70,229,0.9)', color: '#fff' }}>
            {t('app.dropToOpen')}
          </div>
        </div>
      )}
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

        {/* Tab 切换 (可滚动容器，避免移动端越界)。
            默认只显示“关于”；打开文件后才出现对应类型的窗口标签，多窗口时每个标签形如“文档：文件名”。 */}
        <div className="header-tabs-scroll flex items-center gap-0.5" style={{ '--wails-draggable': 'no-drag' as any } as any}>
          {windows.map((w) => {
            const active = w.id === activeWindowId
            const isDragging = dragTabId === w.id
            return (
              <div
                key={w.id}
                draggable
                onDragStart={(e) => {
                  setDragTabId(w.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  if (dragTabId != null && dragTabId !== w.id) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragTabId == null || dragTabId === w.id) { setDragTabId(null); return }
                  const from = dragTabId
                  setWindows(prev => {
                    const fromIdx = prev.findIndex(x => x.id === from)
                    const toIdx = prev.findIndex(x => x.id === w.id)
                    if (fromIdx < 0 || toIdx < 0) return prev
                    const next = [...prev]
                    const [moved] = next.splice(fromIdx, 1)
                    const insertAt = next.findIndex(x => x.id === w.id)
                    next.splice(insertAt, 0, moved)
                    return next
                  })
                  setDragTabId(null)
                }}
                onDragEnd={() => setDragTabId(null)}
                className="group flex items-center px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-all rounded-md flex-shrink-0"
                style={{
                  background: active ? 'rgba(255,255,255,0.22)' : 'transparent',
                  color: active ? '#ffffff' : 'rgba(255,255,255,0.75)',
                  boxShadow: active ? 'inset 0 -2px 0 0 rgba(255,255,255,0.9)' : 'none',
                  cursor: 'grab',
                  opacity: isDragging ? 0.4 : 1,
                  outline: isDragging ? '1px dashed rgba(255,255,255,0.6)' : 'none',
                }}
                onClick={() => {
                  // 切换前先保存当前窗口快照，再恢复到目标窗口
                  setWindows(prev => activeWindowId == null ? prev : prev.map(x => (x.id === activeWindowId ? { ...x, ...captureActive() } : x)))
                  setActiveWindowId(w.id)
                  applyWindow(w)
                }}
                data-testid={`tab-${w.type}`}
              >
                <span className="mr-1">{typePrefix(w.type)}：{truncateName(w.title)}</span>
                {isWindowDirty(w) && (
                  <span
                    className="mr-1 text-[15px] leading-none"
                    title={t('confirm.unsavedTitle')}
                    data-testid={`tab-dirty-${w.id}`}
                  >•</span>
                )}
                <span
                  className="opacity-50 hover:opacity-100 hover:text-red-300 transition-colors"
                  title={t('app.closeTab') || '关闭'}
                  onClick={(e) => {
                    e.stopPropagation()
                    requestCloseTab(w.id)
                  }}
                >✕</span>
              </div>
            )
          })}
          {/* 关于：始终可点，用于回到关于页（关闭所有窗口后默认停留） */}
          <button
            onClick={() => {
              setWindows(prev => activeWindowId == null ? prev : prev.map(x => (x.id === activeWindowId ? { ...x, ...captureActive() } : x)))
              setActiveWindowId(null)
              applyWindow({ id: 0, type: 'about', path: '', title: '' } as OpenWindow)
            }}
            data-testid="tab-about"
            className="px-2.5 sm:px-3 py-2 text-xs sm:text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1 rounded-md flex-shrink-0"
            style={{
              background: activeWindowId == null ? 'rgba(255,255,255,0.22)' : 'transparent',
              color: activeWindowId == null ? '#ffffff' : 'rgba(255,255,255,0.75)',
              boxShadow: activeWindowId == null ? 'inset 0 -2px 0 0 rgba(255,255,255,0.9)' : 'none',
            }}
          >
            <span>ℹ️</span>
            <span className="hidden md:inline">{t('tab.about')}</span>
          </button>
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
            onClick={requestCloseApp}
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
              key={activeWindowId ?? 'about'}
              document={doc}
              spellErrors={spellErrors}
              onChange={(d) => setDoc(d)}
              onSpellCheck={triggerSpellCheck}
              zoom={docZoom}
              onZoomChange={setDocZoom}
              backend={backend ?? undefined}
              onToast={showToast}
            />
          )}
          {tab === 'spreadsheet' && <SpreadsheetEditor key={`${activeWindowId}-${sheetEpoch}`} title={t('app.sheet1')} initialSheets={sheetInitial || undefined} onSheetsChange={setSheetSnapshot} />}
          {tab === 'slide' && <SlideEditor key={`${activeWindowId}-${slideEpoch}`} initialSlides={slideInitial || undefined} onSlidesChange={setSlideSnapshot} />}
          {tab === 'markdown' && (
            <MarkdownHtmlEditor
              key={activeWindowId ?? 'md'}
              initialContent={mdContent}
              mode="markdown"
              onChange={setMdContent}
            />
          )}
          {tab === 'html' && (
            <MarkdownHtmlEditor
              key={activeWindowId ?? 'html'}
              initialContent={htmlContent}
              mode="html"
              onChange={setHtmlContent}
            />
          )}
          {tab === 'pdf' && <PdfViewer key={activeWindowId ?? 'pdf'} pdfOpenSignal={pdfOpenSignal} />}
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
        className="text-xs px-3 sm:px-5 py-1.5 flex items-center gap-3 flex-shrink-0"
        style={{ background: 'var(--color-text)', color: 'var(--color-surface)', flexWrap: 'nowrap' }}
      >
        <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
          {loading && (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0"></span>
          )}
          <span
            className="flex items-center gap-1 flex-shrink min-w-0"
            style={{ maxWidth: '60vw', overflowX: 'auto', whiteSpace: 'nowrap', scrollbarWidth: 'thin' }}
            title={filePath || t('app.ready')}
          >
            <span style={{ flex: '0 0 auto' }}>📄</span>
            <span>{filePath || t('app.ready')}</span>
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

      {/* 未保存更改确认 */}
      <ConfirmDialog
        open={pendingClose !== null}
        title={t('confirm.unsavedTitle')}
        message={(() => {
          if (!pendingClose) return ''
          const id = pendingClose.kind === 'tab' ? pendingClose.winId : pendingClose.queue[0]
          const w = windows.find(x => x.id === id)
          const name = w?.title || w?.path || ''
          const remaining = pendingClose.kind === 'app' ? pendingClose.queue.length : 1
          return remaining > 1
            ? `${t('confirm.unsavedMany', { count: String(remaining) })}\n${t('confirm.unsavedOne', { name })}`
            : t('confirm.unsavedOne', { name })
        })()}
        hint={t('confirm.unsavedHint')}
        saveLabel={t('confirm.save')}
        discardLabel={t('confirm.dontSave')}
        cancelLabel={t('confirm.cancel')}
        onChoice={onConfirmChoice}
      />
    </div>
  )
}

export default App
