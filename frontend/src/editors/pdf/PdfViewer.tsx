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
}

export function PdfViewer({ initialUrl }: PdfViewerProps) {
  const { t } = useI18n()
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [pageNum, setPageNum] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [pdfUrl, setPdfUrl] = useState(initialUrl || '')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<any>(null)
  const [printDialogOpen, setPrintDialogOpen] = useState(false)

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
    if (!url) return
    setLoading(true)
    setError('')
    try {
      const pdfjsLib = await ensurePdfLib()
      const loadingTask = pdfjsLib.getDocument(url)
      const doc = await loadingTask.promise
      setPdfDoc(doc)
      setNumPages(doc.numPages)
      setPageNum(1)
      if (name) setFileName(name)
      setPdfUrl(url)
    } catch (e: any) {
      setError(e.message || 'Failed to load PDF')
      setPdfDoc(null)
      setNumPages(0)
    } finally {
      setLoading(false)
    }
  }, [ensurePdfLib])

  // 渲染当前页
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    let cancelled = false

    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(pageNum)
        if (cancelled || !canvasRef.current) return

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const dpr = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: scale * dpr })
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = `${viewport.width / dpr}px`
        canvas.style.height = `${viewport.height / dpr}px`

        if (renderTaskRef.current) {
          renderTaskRef.current.cancel()
        }

        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
        })
        renderTaskRef.current = renderTask
        await renderTask.promise
      } catch (e: any) {
        if (e?.name !== 'RenderingCancelledException') {
          console.error('Render error:', e)
        }
      }
    }

    renderPage()
    return () => {
      cancelled = true
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
      }
    }
  }, [pdfDoc, pageNum, scale])

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

  // 打印当前页 (通过 canvas 渲染到打印窗口)
  const handlePrintCurrentPage = () => {
    if (!canvasRef.current || !pdfDoc) return
    const canvas = canvasRef.current
    const dataUrl = canvas.toDataURL('image/png')
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

  // 页面跳转
  const goToPage = (n: number) => {
    if (n < 1 || n > numPages) return
    setPageNum(n)
  }

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

  // 监听全局 pdf-open 事件 (来自顶栏的"打开文件"按钮)
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

      {/* PDF 渲染区 */}
      <div className="flex-1 overflow-auto flex justify-center p-4" style={{ background: 'var(--color-bg-alt)' }} data-testid="pdf-canvas-area">
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

        {pdfDoc && (
          <canvas
            ref={canvasRef}
            data-testid="pdf-canvas"
            className="shadow-lg"
            style={{ background: 'white', borderRadius: '4px' }}
          />
        )}
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
