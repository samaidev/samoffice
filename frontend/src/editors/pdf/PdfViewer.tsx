import { useState, useRef, useEffect, useCallback } from 'react'
import { useI18n } from '../../i18n'
import { PrintDialog } from '../../components/PrintDialog'

// 声明全局 pdfjsLib (通过 vendor/pdf.min.js 加载)
declare global {
  interface Window {
    pdfjsLib: any
  }
}

interface PdfViewerProps {
  initialUrl?: string
  // 由父组件通过 prop 传入待打开的 PDF（含 nonce 以便重复打开同一文件也能触发），
  // 避免依赖全局 'pdf-open' 事件在组件挂载前触发而丢失。
  pdfOpenSignal?: { url: string; name: string; nonce: number } | null
}

export function PdfViewer({ initialUrl, pdfOpenSignal }: PdfViewerProps) {
  const { t } = useI18n()
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [pageNum, setPageNum] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [pdfUrl, setPdfUrl] = useState(initialUrl || '')
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [showThumbs, setShowThumbs] = useState(true)
  const [thumbnails, setThumbnails] = useState<{ page: number; dataUrl: string }[]>([])
  const [thumbsLoading, setThumbsLoading] = useState(false)
  const thumbsPanelRef = useRef<HTMLDivElement>(null)

  // 加载 PDF.js 库 (如果尚未加载)
  const ensurePdfLib = useCallback(async () => {
    if (window.pdfjsLib) {
      if (!window.pdfjsLib._workerSet) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js'
        window.pdfjsLib._workerSet = true
      }
      return window.pdfjsLib
    }
    return new Promise<any>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = '/vendor/pdf.min.js'
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js'
          window.pdfjsLib._workerSet = true
          resolve(window.pdfjsLib)
        } else {
          reject(new Error('PDF.js failed to load'))
        }
      }
      script.onerror = () => reject(new Error('Failed to load PDF.js script'))
      document.head.appendChild(script)
    })
  }, [])

  // 加载 PDF 文档
  const loadPdf = useCallback(async (url: string, name?: string) => {
    if (!url) {
      return
    }
    setLoading(true)
    setError('')
    let doc: any = null
    try {
      const pdfjsLib = await ensurePdfLib()
      const loadingTask = pdfjsLib.getDocument(url)
      doc = await loadingTask.promise
      setPdfDoc(doc)
      setNumPages(doc.numPages)
      setPageNum(1)
      if (name) setFileName(name)
      setPdfUrl(url)
    } catch (e: any) {
      console.error('[PdfViewer] loadPdf failed:', e && e.message)
      setError(e.message || 'Failed to load PDF')
      setPdfDoc(null)
      setNumPages(0)
    } finally {
      setLoading(false)
    }
    // 异步生成缩略图（不阻塞主文档渲染）
    if (doc) generateThumbnails(doc)
  }, [ensurePdfLib])

  // 生成所有页面缩略图（小图）用于左侧导航栏
  const generateThumbnails = useCallback(async (doc: any) => {
    if (!doc) return
    setThumbsLoading(true)
    // 稍作延后，让主渲染区先把当前页画完，避免与同一 page 并发 render 冲突
    // （PDF.js 不允许对同一 page 对象同时发起多次 render，否则当前页主画布会渲染失败变空白）
    await new Promise<void>(r => setTimeout(r, 350))
    try {
      const total = doc.numPages
      const thumbs: { page: number; dataUrl: string }[] = []
      const THUMB_W = 110 // CSS 像素宽
      for (let i = 1; i <= total; i++) {
        const pg = await doc.getPage(i)
        const base = pg.getViewport({ scale: 1 })
        // 目标缩放使宽度约等于 THUMB_W
        const scale = THUMB_W / base.width
        const viewport = pg.getViewport({ scale })
        const canvas = document.createElement('canvas')
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.ceil(viewport.width * dpr)
        canvas.height = Math.ceil(viewport.height * dpr)
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        // 同一页可能被主渲染占用，渲染失败则退避重试，避免拖垮主画布
        let ok = false
        for (let attempt = 0; attempt < 5 && !ok; attempt++) {
          try {
            await pg.render({
              canvasContext: ctx,
              viewport: pg.getViewport({ scale: scale * dpr }),
            }).promise
            ok = true
          } catch (err: any) {
            if (err?.name === 'RenderingCancelledException') break
            await new Promise<void>(r => setTimeout(r, 120))
          }
        }
        if (!ok) continue
        thumbs.push({ page: i, dataUrl: canvas.toDataURL('image/png') })
        // 渐进式更新，避免大文档卡顿
        if (i % 4 === 0 || i === total) {
          setThumbnails([...thumbs])
        }
      }
      setThumbnails(thumbs)
    } catch (e) {
      console.error('[PdfViewer] generateThumbnails failed:', e)
    } finally {
      setThumbsLoading(false)
    }
  }, [])

  // ==== 连续滚动模式 ====
  // 页面尺寸（第 1 页基准，仅用于占位高度；渲染后按各自实际尺寸修正）
  const [pageSizes, setPageSizes] = useState<{ w: number; h: number }[]>([])
  // 已渲染页集合（滚动到附近才渲染，离开视口即释放回占位）
  const [renderedPages, setRenderedPages] = useState<Set<number>>(new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const renderTasksRef = useRef<Map<number, any>>(new Map())

  // 读取每页基础尺寸（无渲染，开销小）
  useEffect(() => {
    if (!pdfDoc) {
      setPageSizes([])
      setRenderedPages(new Set())
      return
    }
    let cancelled = false
    ;(async () => {
      const sizes: { w: number; h: number }[] = []
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        try {
          const pg = await pdfDoc.getPage(i)
          const vp = pg.getViewport({ scale: 1 })
          sizes.push({ w: vp.width, h: vp.height })
        } catch {
          sizes.push({ w: 595, h: 842 }) // A4 兜底
        }
        if (cancelled) return
      }
      if (!cancelled) setPageSizes(sizes)
    })()
    return () => { cancelled = true }
  }, [pdfDoc])

  // 滚动 → 计算当前页（视口中线所在页）
  const handleScroll = useCallback(() => {
    const sc = scrollRef.current
    if (!sc || !pdfDoc || pageSizes.length === 0) return
    const mid = sc.scrollTop + sc.clientHeight / 2
    let acc = 0
    for (let i = 0; i < pageSizes.length; i++) {
      acc += pageSizes[i].h * scale + 16 // 16 = 页间距
      if (mid < acc) {
        if (i + 1 !== pageNum) setPageNum(i + 1)
        break
      }
    }
  }, [pdfDoc, pageSizes, scale, pageNum])

  // 渲染器：连续模式下渲染指定页 canvas（不依赖 canvasRef）
  const renderPageTo = useCallback(async (n: number) => {
    if (!pdfDoc) return
    const holder = pageRefs.current[n - 1]
    if (!holder) return
    try {
      const pg = await pdfDoc.getPage(n)
      const canvas = document.createElement('canvas')
      const dpr = window.devicePixelRatio || 1
      const viewport = pg.getViewport({ scale: scale * dpr })
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width / dpr}px`
      canvas.style.height = `${viewport.height / dpr}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      // 同页旧任务取消
      renderTasksRef.current.get(n)?.cancel()
      const task = pg.render({ canvasContext: ctx, viewport })
      renderTasksRef.current.set(n, task)
      await task.promise
      if (holder.isConnected) {
        holder.innerHTML = ''
        holder.appendChild(canvas)
      }
    } catch (e: any) {
      if (e?.name !== 'RenderingCancelledException') {
        console.error('[PdfViewer] render page', n, e)
      }
    }
  }, [pdfDoc, scale])

  // 视口内页面按需渲染：pageNum±1 渲染、其余释放
  useEffect(() => {
    if (!pdfDoc || pageSizes.length === 0) return
    const want = new Set<number>()
    for (let d = -1; d <= 1; d++) {
      const n = pageNum + d
      if (n >= 1 && n <= numPages) want.add(n)
    }
    setRenderedPages(prev => {
      const next = new Set<number>()
      want.forEach(n => { if (prev.has(n)) next.add(n) })
      return next
    })
    // 渲染缺失页（异步）
    want.forEach(n => {
      if (!renderedPages.has(n)) {
        renderPageTo(n)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, pageNum, scale, pageSizes])

  // goToPage 滚动定位（连续模式下把目标页滚到视口顶部）
  const goToPage = (n: number) => {
    if (n < 1 || n > numPages) return
    const sc = scrollRef.current
    if (sc && pageSizes.length > 0) {
      let top = 0
      for (let i = 0; i < n - 1; i++) top += pageSizes[i].h * scale + 16
      sc.scrollTo({ top, behavior: 'smooth' })
    }
    setPageNum(n)
  }

  // 打开文件
  const handleOpenFile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.pdf,application/pdf'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const url = URL.createObjectURL(file)
      loadPdf(url, file.name)
    }
    input.click()
  }

  // 下载 PDF
  const handleDownload = () => {
    if (!pdfUrl) return
    const a = document.createElement('a')
    a.href = pdfUrl
    a.download = fileName || 'document.pdf'
    a.click()
  }

  // 打印 PDF — 使用浏览器原生 PDF 打印 (在新窗口打开 PDF 并触发打印)
  const handlePrint = () => {
    if (!pdfUrl) return
    // 方案1: 在新窗口打开 PDF, 浏览器原生 PDF 阅读器支持打印
    const printWin = window.open(pdfUrl, '_blank')
    if (printWin) {
      // 等待 PDF 加载后触发打印
      printWin.addEventListener('load', () => {
        setTimeout(() => {
          try { printWin.print() } catch (e) { /* 用户可手动 Ctrl+P */ }
        }, 1000)
      })
    }
  }

  // 打印当前页 (从连续滚动模式的页容器取 canvas)
  const handlePrintCurrentPage = () => {
    if (!pdfDoc) return
    const canvas = pageRefs.current[pageNum - 1]?.querySelector('canvas')
    if (!canvas) return
    const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png')
    const printWin = window.open('', '_blank', 'width=800,height=600')
    if (!printWin) return
    printWin.document.write(`
      <html><head><title>${fileName || 'Print'} - Page ${pageNum}</title>
      <style>
        @page { margin: 0; }
        body { margin: 0; padding: 0; display: flex; justify-content: center; }
        img { max-width: 100%; height: auto; }
      </style>
      </head><body>
      <img src="${dataUrl}" onload="window.print(); setTimeout(() => window.close(), 500)" />
      </body></html>
    `)
    printWin.document.close()
  }

  // （goToPage 已上移到连续滚动区块）

  // 缩放
  const zoomIn = () => setScale(s => Math.min(3, s + 0.2))
  const zoomOut = () => setScale(s => Math.max(0.4, s - 0.2))
  const zoomReset = () => setScale(1.2)

  // 键盘快捷键
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!pdfDoc) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        goToPage(pageNum - 1)
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        goToPage(pageNum + 1)
      } else if (e.key === 'Home') {
        e.preventDefault()
        goToPage(1)
      } else if (e.key === 'End') {
        e.preventDefault()
        goToPage(numPages)
      } else if ((e.ctrlKey || e.metaKey) && e.key === '=') {
        e.preventDefault()
        zoomIn()
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        zoomOut()
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        zoomReset()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [pdfDoc, pageNum, numPages])

  // 监听全局 pdf-open 事件 (来自顶栏的"打开文件"按钮) —— 兜底兼容
  useEffect(() => {
    const handlePdfOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.url) {
        loadPdf(detail.url, detail.name)
      }
    }
    window.addEventListener('pdf-open', handlePdfOpen as EventListener)
    return () => window.removeEventListener('pdf-open', handlePdfOpen as EventListener)
  }, [loadPdf])

  // 主路径：父组件通过 prop 传入待打开的 PDF（含 nonce，重复打开同一文件也能触发）
  useEffect(() => {
    if (pdfOpenSignal?.url) {
      loadPdf(pdfOpenSignal.url, pdfOpenSignal.name)
    }
  }, [pdfOpenSignal, loadPdf])

  // 自动滚动缩略图栏，使当前页可见
  useEffect(() => {
    if (!showThumbs || !thumbsPanelRef.current) return
    const el = thumbsPanelRef.current.querySelector<HTMLElement>(`[data-testid="pdf-thumb-${pageNum}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [pageNum, showThumbs, thumbnails])

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-alt)' }}>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }} data-testid="pdf-toolbar">
        <button
          onClick={handleOpenFile}
          data-testid="pdf-open-btn"
          className="px-3 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center gap-1.5"
          style={{ background: 'var(--color-primary)', color: 'white' }}
          title={t('pdf.openFile')}
        >
          📂 <span className="hidden sm:inline">{t('pdf.openFile')}</span>
        </button>

        {pdfDoc && (
          <>
            <button
              onClick={() => setShowThumbs(s => !s)}
              data-testid="pdf-thumbs-toggle"
              className="p-1.5 rounded-md transition-colors hover:bg-slate-100"
              style={{ color: showThumbs ? 'var(--color-primary)' : 'var(--color-text)' }}
              title={t('pdf.toggleThumbs')}
            >🗂</button>
          </>
        )}

        {pdfDoc && (
          <>
            <div className="toolbar-divider" />

            <button
              onClick={() => goToPage(pageNum - 1)}
              disabled={pageNum <= 1}
              data-testid="pdf-prev-btn"
              className="p-1.5 rounded-md transition-colors disabled:opacity-30 hover:bg-slate-100"
              style={{ color: 'var(--color-text)' }}
              title={t('pdf.prevPage')}
            >◀</button>
            <div className="flex items-center gap-1 text-sm" style={{ color: 'var(--color-text)' }}>
              <input
                type="number"
                min={1}
                max={numPages}
                value={pageNum}
                onChange={e => goToPage(parseInt(e.target.value) || 1)}
                data-testid="pdf-page-input"
                className="w-12 text-center rounded-md px-1 py-0.5"
                style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              />
              <span style={{ color: 'var(--color-text-muted)' }}>/ {numPages}</span>
            </div>
            <button
              onClick={() => goToPage(pageNum + 1)}
              disabled={pageNum >= numPages}
              data-testid="pdf-next-btn"
              className="p-1.5 rounded-md transition-colors disabled:opacity-30 hover:bg-slate-100"
              style={{ color: 'var(--color-text)' }}
              title={t('pdf.nextPage')}
            >▶</button>

            <div className="toolbar-divider" />

            <button
              onClick={zoomOut}
              disabled={scale <= 0.4}
              data-testid="pdf-zoom-out"
              className="p-1.5 rounded-md transition-colors disabled:opacity-30 hover:bg-slate-100"
              style={{ color: 'var(--color-text)' }}
              title={t('pdf.zoomOut')}
            >−</button>
            <span className="text-xs w-12 text-center" style={{ color: 'var(--color-text-muted)' }}>{Math.round(scale * 100)}%</span>
            <button
              onClick={zoomIn}
              disabled={scale >= 3}
              data-testid="pdf-zoom-in"
              className="p-1.5 rounded-md transition-colors disabled:opacity-30 hover:bg-slate-100"
              style={{ color: 'var(--color-text)' }}
              title={t('pdf.zoomIn')}
            >+</button>
            <button
              onClick={zoomReset}
              className="p-1.5 rounded-md transition-colors hover:bg-slate-100 text-xs"
              style={{ color: 'var(--color-text)' }}
              title={t('pdf.zoomReset')}
            >100%</button>

            <div className="toolbar-divider" />

            <button
              onClick={handleDownload}
              data-testid="pdf-download-btn"
              className="p-1.5 rounded-md transition-colors hover:bg-slate-100"
              style={{ color: 'var(--color-text)' }}
              title={t('pdf.download')}
            >⬇</button>

            <button
              onClick={() => setPrintDialogOpen(true)}
              data-testid="pdf-print-btn"
              className="p-1.5 rounded-md transition-colors hover:bg-slate-100"
              style={{ color: 'var(--color-text)' }}
              title={t('pdf.print')}
            >🖨</button>

            <div className="flex-1" />
            <span className="text-xs truncate max-w-[200px]" style={{ color: 'var(--color-text-muted)' }} title={fileName}>
              {fileName}
            </span>
          </>
        )}
      </div>

      {/* 主体：左侧缩略图导航栏 + 右侧渲染区 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧缩略图导航栏 */}
        {showThumbs && pdfDoc && (
          <div
            ref={thumbsPanelRef}
            className="flex-shrink-0 overflow-auto border-r p-2 space-y-2"
            style={{ width: '140px', background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            data-testid="pdf-thumbs-panel"
          >
            {thumbsLoading && thumbnails.length === 0 && (
              <div className="text-xs text-center py-4" style={{ color: 'var(--color-text-muted)' }}>{t('pdf.loading')}</div>
            )}
            {thumbnails.map((th) => (
              <button
                key={th.page}
                onClick={() => goToPage(th.page)}
                data-testid={`pdf-thumb-${th.page}`}
                className="block w-full rounded-md overflow-hidden transition-all"
                style={{
                  border: `2px solid ${th.page === pageNum ? 'var(--color-primary)' : 'transparent'}`,
                  boxShadow: th.page === pageNum ? '0 0 0 2px var(--color-primary)' : '0 1px 2px rgba(0,0,0,0.15)',
                  background: 'white',
                }}
                title={t('pdf.thumbPage', { n: th.page })}
              >
                <img src={th.dataUrl} alt={`Page ${th.page}`} className="w-full block" />
                <div className="text-[10px] text-center py-0.5" style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-alt)' }}>
                  {th.page}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* PDF 渲染区（连续滚动：全部页垂直排列，按需渲染视口附近 ±1 页） */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-auto flex justify-center p-4"
          style={{ background: 'var(--color-bg-alt)' }}
          data-testid="pdf-canvas-area"
        >
        {loading && (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="animate-spin text-4xl mb-4">⏳</div>
            <p style={{ color: 'var(--color-text-muted)' }}>{t('pdf.loading')}</p>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-full max-w-md text-center">
            <div className="text-5xl mb-4">❌</div>
            <p className="font-semibold mb-2" style={{ color: 'var(--color-danger)' }}>{t('pdf.loadError')}</p>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{error}</p>
          </div>
        )}

        {!pdfDoc && !loading && !error && (
          <div className="flex flex-col items-center justify-center h-full max-w-md text-center" data-testid="pdf-empty">
            <div className="text-6xl mb-6 opacity-30">📕</div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>{t('pdf.emptyTitle')}</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>{t('pdf.emptyDesc')}</p>
            <button
              onClick={handleOpenFile}
              className="px-6 py-2.5 rounded-lg font-medium transition-colors flex items-center gap-2"
              style={{ background: 'var(--color-primary)', color: 'white' }}
            >
              📂 {t('pdf.openFile')}
            </button>
            <div className="mt-8 text-xs space-y-1" style={{ color: 'var(--color-text-faint)' }}>
              <p>{t('pdf.shortcutNav')}: ← → PageUp PageDown Home End</p>
              <p>{t('pdf.shortcutZoom')}: Ctrl + / - / 0</p>
            </div>
          </div>
        )}

        {pdfDoc && pageSizes.length > 0 && (
          <div className="flex flex-col items-center gap-4">
            {pageSizes.map((ps, i) => {
              const n = i + 1
              return (
                <div
                  key={n}
                  ref={el => { pageRefs.current[i] = el }}
                  data-testid={`pdf-page-${n}`}
                  className="shadow-lg relative flex-shrink-0"
                  style={{
                    width: ps.w * scale,
                    height: ps.h * scale,
                    background: 'white',
                    borderRadius: '4px',
                  }}
                >
                  {!renderedPages.has(n) && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: '#cbd5e1' }}>
                      {n}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        </div>
      </div>

      {/* 底部状态栏 */}
      {pdfDoc && (
        <div className="px-4 py-1.5 flex items-center justify-between text-xs flex-shrink-0 border-t" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }} data-testid="pdf-statusbar">
          <span>{fileName}</span>
          <span>{t('pdf.pageOf', { current: pageNum, total: numPages })}</span>
          <span>{Math.round(scale * 100)}%</span>
        </div>
      )}

      {/* 打印对话框 */}
      <PrintDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        editorType="word"
        printSelector="canvas"
        renderPreview={(settings) => (
          <div className="w-full h-full flex flex-col items-center justify-center" style={{ color: '#000' }}>
            <div className="text-[10px] font-bold mb-2">{fileName || 'document.pdf'}</div>
            <div className="border-2 border-gray-300 p-3 bg-gray-50" style={{ width: '80%', aspectRatio: '1/1.414' }}>
              <div className="text-[7px] text-gray-400 text-center mt-1/2">{t('pdf.previewPageN', { n: pageNum })}</div>
              <div className="text-[7px] mt-1 leading-tight">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-1 bg-gray-200 rounded mb-0.5" style={{ width: `${70 + Math.random() * 25}%` }} />
                ))}
              </div>
            </div>
            <div className="text-[8px] text-gray-500 mt-2">
              {settings.pageRange === 'all' ? t('print.allPages') : settings.pageRange === 'current' ? t('print.currentPage') : settings.customPages} · {settings.copies} {t('print.copies')}
            </div>
          </div>
        )}
      />
    </div>
  )
}
