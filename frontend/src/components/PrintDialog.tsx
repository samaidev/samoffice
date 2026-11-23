import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import PageFlow from './PageFlow'
import { useI18n } from '../i18n'
import { Dropdown } from './Dropdown'

interface PrintDialogProps {
  open: boolean
  onClose: () => void
  /** 编辑器类型 — 决定显示哪些选项 */
  editorType: 'word' | 'ppt' | 'excel' | 'pdf'
  /** Excel：工作表已设置的打印标题行数（用于初始化"标题行数"输入框） */
  excelTitleRows?: number
  /** 预览内容渲染函数 (返回 HTML 字符串或 ReactNode) */
  renderPreview?: (settings: PrintSettings) => React.ReactNode
  /** 实际打印内容的选择器 (用于 window.print) */
  printSelector?: string
  /** 打印选定区域：选中文本的 HTML 片段（word）/选区表格（excel）。
   *  提供非空值时页码范围出现「选定区域」选项，实际打印走专用打印容器。
   *  round56：用户报告打印选定区域无效。 */
  selectionPrintHTML?: string | null
  /** 拼版/多页打印内容（round57）：返回预览坐标系纸张卡片流（.print-paper），
   *  PrintDialog 注入专用打印容器（zoom 校准预览 px→物理 mm + 每卡分页）。
   *  返回 null/undefined 则走传统 printSelector 直印。word/excel 在
   *  perPage>1 时提供；ppt 提供全套幻灯片纸张流。 */
  renderPrint?: (settings: PrintSettings) => React.ReactNode | null
}

/** 打印设置 (对标 MS Office 打印对话框) */
export interface PrintSettings {
  // 打印机
  printer: string          // 打印机名 (空=系统默认)
  // 页范围
  pageRange: 'all' | 'current' | 'custom' | 'selection'
  customPages: string      // 如 "1-3,5,7-9"
  // 份数
  copies: number
  collate: boolean         // 逐份打印
  // 方向
  orientation: 'portrait' | 'landscape'
  // 纸张
  paperSize: 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal'
  // 页边距 (mm)
  margins: { top: number; bottom: number; left: number; right: number }
  // 缩放
  scale: number            // 百分比, 100=实际大小
  scaleFit: 'actual' | 'fit' | 'shrink'  // 实际大小/适应/缩小
  // 每版打印页数（round57，对标 MS Word/Excel「每版打印页数」1版N页）
  perPage: 1 | 2 | 4 | 6 | 8
  // 双面
  duplex: 'none' | 'long' | 'short'  // 无/长边翻转/短边翻转
  // 装订
  binding: 'none' | 'left' | 'top'  // 无/左侧装订/顶部装订
  // 颜色
  color: 'color' | 'grayscale' | 'blackwhite'
  // 质量
  quality: 'draft' | 'normal' | 'high' | 'photo'
  // 每页打印 (PPT 用)
  slidesPerPage: 1 | 2 | 3 | 4 | 6 | 9
  // 打印内容 (PPT 用)
  pptContent: 'full' | 'handout' | 'notes' | 'outline'
  // Excel 专用
  printArea: boolean       // 只打印选定区域
  printTitle: boolean      // 重复打印标题行
  printTitleRows: number   // 顶端标题行数（$1:$N，每页重复）
  printGridlines: boolean  // 打印网格线
  printComments: 'none' | 'end' | 'sheet'  // 不打印/工作表末尾/工作表上
  pageOrder: 'downRight' | 'rightDown'     // 先列后行/先行后列
}

export const defaultPrintSettings: PrintSettings = {
  printer: '',
  pageRange: 'all',
  customPages: '',
  copies: 1,
  collate: true,
  orientation: 'portrait',
  paperSize: 'A4',
  margins: { top: 25, bottom: 25, left: 25, right: 25 },
  scale: 100,
  scaleFit: 'actual',
  perPage: 1,
  duplex: 'none',
  binding: 'none',
  color: 'color',
  quality: 'normal',
  slidesPerPage: 1,
  pptContent: 'full',
  printArea: false,
  printTitle: false,
  printTitleRows: 1,
  printGridlines: false,
  printComments: 'none',
  pageOrder: 'downRight',
}

// 纸张尺寸 (mm)
export const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A5: { w: 148, h: 210 },
  Letter: { w: 216, h: 279 },
  Legal: { w: 216, h: 356 },
}

export function PrintDialog({ open, onClose, editorType, excelTitleRows, renderPreview, printSelector, selectionPrintHTML, renderPrint }: PrintDialogProps) {
  const { t } = useI18n()
  // round54：标题行数初值来自工作表已设置的打印标题（_xlnm.Print_Titles）
  const [settings, setSettings] = useState<PrintSettings>({ ...defaultPrintSettings, printTitleRows: excelTitleRows && excelTitleRows > 0 ? excelTitleRows : defaultPrintSettings.printTitleRows })
  const [activeTab, setActiveTab] = useState<'general' | 'layout' | 'advanced'>('general')
  const previewRef = useRef<HTMLDivElement>(null)
  // round24 打印预览真实分页（用户报告"打印预览无法翻页"——旧版 ◀/▶ 无 onClick、
  // 页码硬编码 1/3、预览只有一张固定高度的纸）。文档预览按纸张内容高度切片，
  // 翻页 = 平移显示第 N 页。仅 word 启用（ppt 幻灯片/excel 表格自成一页，不切片）。
  const [pageCount, setPageCount] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const previewContentRef = useRef<HTMLDivElement>(null)

  // Escape 关闭对话框
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true) // capture 阶段优先
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  const update = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => {
    setSettings(s => ({ ...s, [key]: value }))
  }

  // round56：适应/缩小真实生效 —— 之前 scaleFit 仅存状态，预览 transform 只看
  // settings.scale，实际打印还写入 'fit'/'shrink' 这种非法 CSS（完全无效）。
  // autoFit = 预览区容器 / 纸张 的缩放百分比：word 取宽高双向最小（单页窗口），
  // excel/ppt/pdf 多页堆叠取宽度适应。effScale 是预览与实际打印共用的最终缩放。
  const [autoFit, setAutoFit] = useState(100)
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const box = previewRef.current
      if (!box) return
      const paperWpx = previewW * 1.5, paperHpx = previewH * 1.5
      const fitW = box.clientWidth / paperWpx * 100
      const fitH = (box.clientHeight - 40) / paperHpx * 100
      let v = editorType === 'word' ? Math.min(fitW, fitH) : fitW
      v = Math.max(30, Math.min(200, v))
      setAutoFit(prev => (Math.abs(prev - v) < 1 ? prev : Math.round(v)))
    }
    measure()
    const id = setTimeout(measure, 60)
    return () => clearTimeout(id)
  }, [open, settings.paperSize, settings.orientation, settings.margins, editorType])

  const effScale = settings.scaleFit === 'fit'
    ? autoFit
    : settings.scaleFit === 'shrink'
      ? Math.min(autoFit, settings.scale)
      : settings.scale
  const effScaleRef = useRef(100)
  effScaleRef.current = effScale

  // round57：页数由 PageFlow 测量上报（onCount）。旧测量挂在单页窗口的
  // translateY 包裹层上，多页流重构后该节点不存在；保留 currentPage 钳制。
  const handleCount = (n: number) => {
    setPageCount(prev => (prev === n ? prev : n))
    setCurrentPage(p => (p > n ? n : p))
  }
  // 页码范围 → 显示页集合（word 多页流）：当前页 / 自定义区间展开
  const parseCustom = (spec: string): number[] => {
    const out: number[] = []
    for (const part of String(spec || '').split(/[,，;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/)
      if (!m) continue
      const a = parseInt(m[1]), b = m[2] ? parseInt(m[2]) : a
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i)
    }
    return out.sort((x, y) => x - y)
  }
  const wordSelMode = editorType === 'word' && settings.pageRange === 'selection' && !!selectionPrintHTML
  const wordPages = editorType === 'word' && settings.pageRange === 'current'
    ? [currentPage]
    : editorType === 'word' && settings.pageRange === 'custom'
      ? (parseCustom(settings.customPages).length ? parseCustom(settings.customPages) : [1])
      : undefined
  // 翻页/换范围后滚动到当前页卡片
  useEffect(() => {
    if (!open || editorType !== 'word' || wordSelMode) return
    const id = setTimeout(() => {
      const card = document.querySelector(`[data-testid="print-flow"] [data-page="${currentPage}"]`) as HTMLElement | null
      card?.scrollIntoView({ block: 'start' })
    }, 80)
    return () => clearTimeout(id)
  }, [open, currentPage, settings.pageRange, editorType, wordSelMode])

  // 实际执行打印
  const doPrint = () => {
    // round56：真实缩放 —— 预览的有效缩放（effScale，含适应/缩小）以 CSS zoom
    // 同步作用于实际打印输出；此前 scale 只改预览 transform，打印永远是 100%，
    // scaleFit 更是写入了 'fit'/'shrink' 这种非法 CSS（用户报告：缩放/适应无效）。
    const eff = Math.round(effScaleRef.current)
    const selMode = settings.pageRange === 'selection' && !!selectionPrintHTML

    // round57：拼版/多页打印 —— renderPrint 返回预览坐标纸张卡片流
    //（.print-paper），注入专用容器 React 渲染后打印：
    //  - zoom 校准：预览坐标 = mm×1.5px，物理 = mm×96/25.4px → zoom = 96/25.4/1.5 ≈ 2.5197
    //  - 每张纸卡 break-after:page → 一卡一页；@page 边距置 0（边距在卡内 padding）
    // word perPage>1 拼版 / excel perPage>1 / ppt 全套幻灯片走此路径。
    const TILED_ID = 'print-dialog-tiled-holder'
    let tiledRoot: { unmount: () => void } | null = null
    const tiled = !selMode && renderPrint ? renderPrint(settings) : null
    if (tiled) {
      document.getElementById(TILED_ID)?.remove()
      const holder = document.createElement('div')
      holder.id = TILED_ID
      document.body.appendChild(holder)
      const root = createRoot(holder)
      tiledRoot = root
      root.render(tiled)
    }

    // 选定区域打印：把选区 HTML 注入专用打印容器（body 直挂、屏上移出视口），
    // 打印 CSS 只显示它 —— 旧版对选定区域毫无处理，点打印仍是整篇文档。
    const HOLDER_ID = 'print-dialog-selection-holder'
    if (selMode) {
      let holder = document.getElementById(HOLDER_ID)
      if (!holder) {
        holder = document.createElement('div')
        holder.id = HOLDER_ID
        document.body.appendChild(holder)
      }
      holder.innerHTML = selectionPrintHTML || ''
    }

    // 生成打印专用 CSS
    const styleId = 'print-dialog-style'
    let style = document.getElementById(styleId)
    if (!style) {
      style = document.createElement('style')
      style.id = styleId
      document.head.appendChild(style)
    }
    const paper = PAPER_SIZES[settings.paperSize]
    const orient = settings.orientation === 'landscape' ? 'landscape' : 'portrait'
    const colorCss = settings.color === 'color' ? '' : 'filter: grayscale(1);'
    const zoomCss = eff !== 100 ? `zoom: ${eff}%;` : ''
    // 拼版：预览 px（mm×1.5）→ 物理 px（mm×96/25.4），叠加用户有效缩放
    const tiledZoom = `zoom: ${((96 / 25.4 / 1.5) * effScaleRef.current).toFixed(3)}%;`
    const target = selMode ? `#${HOLDER_ID}` : tiled ? `#${TILED_ID}` : (printSelector || '.print-content')

    style.textContent = `
      @media print {
        @page {
          size: ${paper.w}mm ${paper.h}mm ${orient};
          margin: ${tiled ? '0' : `${settings.margins.top}mm ${settings.margins.right}mm ${settings.margins.bottom}mm ${settings.margins.left}mm`};
        }
        body * { visibility: hidden; }
        ${target} { visibility: visible; position: absolute; left: 0; top: 0; width: 100%; ${colorCss} ${tiled ? tiledZoom : zoomCss} }
        ${target} * { visibility: visible; }
        ${tiled ? `#${TILED_ID} .print-paper { break-after: page; } #${TILED_ID} .print-paper:last-child { break-after: auto; }` : ''}
        .no-print { display: none !important; }
      }
      ${selMode ? `#${HOLDER_ID} { position: fixed; left: -10000px; top: 0; }` : ''}
      ${tiled ? `#${TILED_ID} { position: fixed; left: -10000px; top: 0; width: ${paper.w * 1.5}px; }` : ''}
    `

    // 添加打印内容类
    if (!selMode && printSelector) {
      const el = document.querySelector(printSelector)
      el?.classList.add('print-content')
    }

    setTimeout(() => {
      window.print()
      onClose()
      // 打印结束后清理选区/拼版容器（留在 DOM 也无碍，但保持干净）
      setTimeout(() => {
        document.getElementById(HOLDER_ID)?.remove()
        if (tiledRoot) {
          tiledRoot.unmount()
          document.getElementById(TILED_ID)?.remove()
        }
      }, 800)
    }, tiled ? 260 : 200)
  }

  if (!open) return null

  const paper = PAPER_SIZES[settings.paperSize]
  const previewW = settings.orientation === 'landscape' ? paper.h : paper.w
  const previewH = settings.orientation === 'landscape' ? paper.w : paper.h
  // 纸张内容区高度（px，1.5 为预览缩放系数）—— 分页切片的页高
  const contentH = Math.max(60, previewH * 1.5 - (settings.margins.top + settings.margins.bottom) * 1.5)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: 'rgba(15,23,42,0.7)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl shadow-2xl flex flex-col" style={{ width: '1100px', maxWidth: '95vw', maxHeight: '92vh' }} data-testid="print-dialog" onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            🖨 {t('print.title')}
          </h2>
          <button onClick={onClose} className="text-2xl leading-none hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}>✕</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* 左侧：设置面板 */}
          <div className="w-1/2 overflow-auto p-5 border-r" style={{ borderColor: 'var(--color-border)' }}>
            {/* Tab 切换 */}
            <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ background: 'var(--color-bg-alt)' }}>
              {[
                { id: 'general', label: t('print.tabGeneral') },
                { id: 'layout', label: t('print.tabLayout') },
                { id: 'advanced', label: t('print.tabAdvanced') },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  data-testid={`print-tab-${tab.id}`}
                  className={`flex-1 py-1.5 px-3 text-sm rounded-md font-medium transition-colors ${activeTab === tab.id ? 'bg-white shadow-sm' : 'text-gray-500'}`}
                  style={activeTab === tab.id ? { color: 'var(--color-primary)' } : {}}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* === 常规 Tab === */}
            {activeTab === 'general' && (
              <div className="space-y-4">
                {/* 打印机 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.printer')}</label>
                  <Dropdown
                    testId="print-printer"
                    className="w-full text-sm rounded-md px-3 py-2 ribbon-input"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 38 }}
                    value={settings.printer}
                    onChange={v => update('printer', v)}
                    options={[
                      { label: t('print.defaultPrinter'), value: '' },
                      { label: 'Save as PDF', value: 'pdf' },
                      { label: 'Microsoft Print to PDF', value: 'microsoft' },
                      { label: 'OneNote', value: 'onenote' },
                    ]}
                  />
                </div>

                {/* 页范围 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.pageRange')}</label>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                      <input type="radio" name="pageRange" checked={settings.pageRange === 'all'} onChange={() => update('pageRange', 'all')} data-testid="print-range-all" />
                      {t('print.allPages')}
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                      <input type="radio" name="pageRange" checked={settings.pageRange === 'current'} onChange={() => update('pageRange', 'current')} />
                      {t('print.currentPage')}
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                      <input type="radio" name="pageRange" checked={settings.pageRange === 'custom'} onChange={() => update('pageRange', 'custom')} data-testid="print-range-custom" />
                      {t('print.customPages')}
                    </label>
                    {selectionPrintHTML ? (
                      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                        <input type="radio" name="pageRange" checked={settings.pageRange === 'selection'} onChange={() => update('pageRange', 'selection')} data-testid="print-range-selection" />
                        {t('print.selection') || '选定区域'}
                      </label>
                    ) : null}
                    {settings.pageRange === 'custom' && (
                      <input
                        type="text"
                        placeholder={t('print.customPagesPlaceholder')}
                        value={settings.customPages}
                        onChange={e => update('customPages', e.target.value)}
                        data-testid="print-custom-pages"
                        className="w-full text-sm rounded-md px-3 py-1.5 ml-6"
                        style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                      />
                    )}
                  </div>
                </div>

                {/* 份数 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.copies')}</label>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={settings.copies}
                      onChange={e => update('copies', Math.max(1, parseInt(e.target.value) || 1))}
                      data-testid="print-copies"
                      className="w-full text-sm rounded-md px-3 py-2"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.collate')}</label>
                    <label className="flex items-center h-[38px] gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                      <input type="checkbox" checked={settings.collate} onChange={e => update('collate', e.target.checked)} />
                      {t('print.collateLabel')}
                    </label>
                  </div>
                </div>

                {/* 方向 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.orientation')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => update('orientation', 'portrait')}
                      data-testid="print-portrait"
                      className={`flex flex-col items-center py-2 rounded-md border-2 text-sm ${settings.orientation === 'portrait' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}
                    >
                      <div className="w-6 h-8 border-2 border-current mb-1" />
                      {t('print.portrait')}
                    </button>
                    <button
                      onClick={() => update('orientation', 'landscape')}
                      data-testid="print-landscape"
                      className={`flex flex-col items-center py-2 rounded-md border-2 text-sm ${settings.orientation === 'landscape' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}
                    >
                      <div className="w-8 h-6 border-2 border-current mb-1" />
                      {t('print.landscape')}
                    </button>
                  </div>
                </div>

                {/* 颜色 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.color')}</label>
                  <Dropdown
                    testId="print-color"
                    className="w-full text-sm rounded-md px-3 py-2 ribbon-input"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 38 }}
                    value={settings.color}
                    onChange={v => update('color', v as any)}
                    options={[
                      { label: t('print.colorMode'), value: 'color' },
                      { label: t('print.grayscale'), value: 'grayscale' },
                      { label: t('print.blackwhite'), value: 'blackwhite' },
                    ]}
                  />
                </div>
              </div>
            )}

            {/* === 版式 Tab === */}
            {activeTab === 'layout' && (
              <div className="space-y-4">
                {/* 纸张大小 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.paperSize')}</label>
                  <Dropdown
                    testId="print-paper-size"
                    className="w-full text-sm rounded-md px-3 py-2 ribbon-input"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 38 }}
                    value={settings.paperSize}
                    onChange={v => update('paperSize', v as any)}
                    options={[
                      { label: 'A4 (210×297mm)', value: 'A4' },
                      { label: 'A3 (297×420mm)', value: 'A3' },
                      { label: 'A5 (148×210mm)', value: 'A5' },
                      { label: 'Letter (216×279mm)', value: 'Letter' },
                      { label: 'Legal (216×356mm)', value: 'Legal' },
                    ]}
                  />
                </div>

                {/* 页边距 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.margins')} (mm)</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['top', 'bottom', 'left', 'right'] as const).map(side => (
                      <div key={side}>
                        <span className="block text-[10px] text-center" style={{ color: 'var(--color-text-faint)' }}>{t(`print.margin${side.charAt(0).toUpperCase() + side.slice(1)}`)}</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={settings.margins[side]}
                          onChange={e => update('margins', { ...settings.margins, [side]: parseInt(e.target.value) || 0 })}
                          data-testid={`print-margin-${side}`}
                          className="w-full text-sm text-center rounded-md px-2 py-1.5"
                          style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                        />
                      </div>
                    ))}
                  </div>
                  {/* 预设 */}
                  <div className="flex gap-1 mt-2">
                    <button onClick={() => update('margins', { top: 25, bottom: 25, left: 25, right: 25 })} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text-secondary)' }}>{t('print.marginNormal')}</button>
                    <button onClick={() => update('margins', { top: 15, bottom: 15, left: 15, right: 15 })} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text-secondary)' }}>{t('print.marginNarrow')}</button>
                    <button onClick={() => update('margins', { top: 50, bottom: 50, left: 40, right: 40 })} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text-secondary)' }}>{t('print.marginWide')}</button>
                  </div>
                </div>

                {/* 缩放 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.scale')}</label>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    {[
                      { v: 'actual', label: t('print.scaleActual') },
                      { v: 'fit', label: t('print.scaleFit') },
                      { v: 'shrink', label: t('print.scaleShrink') },
                    ].map(s => (
                      <button
                        key={s.v}
                        onClick={() => update('scaleFit', s.v as any)}
                        className={`text-xs py-1.5 rounded-md border ${settings.scaleFit === s.v ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-gray-200'}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={25}
                      max={200}
                      value={settings.scaleFit === 'actual' ? settings.scale : Math.round(effScale)}
                      onChange={e => update('scale', parseInt(e.target.value))}
                      data-testid="print-scale"
                      className="flex-1"
                      disabled={settings.scaleFit !== 'actual'}
                    />
                    <input
                      type="number"
                      min={25}
                      max={200}
                      value={settings.scaleFit === 'actual' ? settings.scale : Math.round(effScale)}
                      onChange={e => update('scale', Math.max(25, Math.min(200, parseInt(e.target.value) || 100)))}
                      data-testid="print-scale-num"
                      className="w-16 text-sm text-center rounded border px-1 py-0.5"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
                      disabled={settings.scaleFit !== 'actual'}
                    />
                    <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>%</span>
                  </div>
                </div>

                {/* 每版打印页数（round57：word/excel，对标 MS；ppt 用每页幻灯片数） */}
                {(editorType === 'word' || editorType === 'excel') && (
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.pagesPerSheet')}</label>
                    <div className="grid grid-cols-5 gap-2">
                      {[1, 2, 4, 6, 8].map(n => (
                        <button
                          key={n}
                          onClick={() => update('perPage', n as any)}
                          data-testid={`print-perpage-${n}`}
                          className={`text-xs py-1.5 rounded-md border ${settings.perPage === n ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-gray-200'}`}
                          style={settings.perPage === n ? {} : { color: 'var(--color-text)' }}
                        >
                          {t('print.sheetN', { n })}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 双面 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.duplex')}</label>
                  <Dropdown
                    testId="print-duplex"
                    className="w-full text-sm rounded-md px-3 py-2 ribbon-input"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 38 }}
                    value={settings.duplex}
                    onChange={v => update('duplex', v as any)}
                    options={[
                      { label: t('print.duplexNone'), value: 'none' },
                      { label: t('print.duplexLong'), value: 'long' },
                      { label: t('print.duplexShort'), value: 'short' },
                    ]}
                  />
                </div>

                {/* 装订 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.binding')}</label>
                  <Dropdown
                    className="w-full text-sm rounded-md px-3 py-2 ribbon-input"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 38 }}
                    value={settings.binding}
                    onChange={v => update('binding', v as any)}
                    options={[
                      { label: t('print.bindingNone'), value: 'none' },
                      { label: t('print.bindingLeft'), value: 'left' },
                      { label: t('print.bindingTop'), value: 'top' },
                    ]}
                  />
                </div>
              </div>
            )}

            {/* === 高级 Tab === */}
            <div className="space-y-4">
              {/* PPT 专用 */}
              {editorType === 'ppt' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.pptContent')}</label>
                    <Dropdown
                      testId="print-ppt-content"
                      className="w-full text-sm rounded-md px-3 py-2 ribbon-input"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 38 }}
                      value={settings.pptContent}
                      onChange={v => update('pptContent', v as any)}
                      options={[
                        { label: t('print.pptFull'), value: 'full' },
                        { label: t('print.pptHandout'), value: 'handout' },
                        { label: t('print.pptNotes'), value: 'notes' },
                        { label: t('print.pptOutline'), value: 'outline' },
                      ]}
                    />
                  </div>
                  {settings.pptContent !== 'notes' && settings.pptContent !== 'outline' && (
                    <div>
                      <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.slidesPerPage')}</label>
                      <div className="grid grid-cols-3 gap-2">
                        {[1, 2, 3, 4, 6, 9].map(n => (
                          <button
                            key={n}
                            onClick={() => update('slidesPerPage', n as any)}
                            data-testid={`print-slides-${n}`}
                            className={`text-sm py-2 rounded-md border ${settings.slidesPerPage === n ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-gray-200'}`}
                          >
                            {n} {t('print.perPageUnit')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Excel 专用 */}
              {editorType === 'excel' && (
                <>
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="checkbox" checked={settings.printArea} onChange={e => update('printArea', e.target.checked)} />
                    {t('print.excelPrintArea')}
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="checkbox" checked={settings.printTitle} onChange={e => update('printTitle', e.target.checked)} data-testid="print-title-check" />
                    {t('print.excelPrintTitle')}
                  </label>
                  {settings.printTitle && (
                    <div className="ml-6 flex items-center gap-2">
                      <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('print.excelTitleRows')}</span>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={settings.printTitleRows}
                        onChange={e => update('printTitleRows', Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                        data-testid="print-title-rows"
                        className="w-20 text-sm text-center rounded-md px-2 py-1"
                        style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                      />
                      <span className="text-xs" style={{ color: 'var(--color-text-faint)' }}>$1:${settings.printTitleRows}</span>
                    </div>
                  )}
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="checkbox" checked={settings.printGridlines} onChange={e => update('printGridlines', e.target.checked)} data-testid="print-gridlines" />
                    {t('print.excelGridlines')}
                  </label>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.excelComments')}</label>
                    <Dropdown
                      className="w-full text-sm rounded-md px-3 py-2 ribbon-input"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 38 }}
                      value={settings.printComments}
                      onChange={v => update('printComments', v as any)}
                      options={[
                        { label: t('print.excelCommentsNone'), value: 'none' },
                        { label: t('print.excelCommentsEnd'), value: 'end' },
                        { label: t('print.excelCommentsSheet'), value: 'sheet' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.excelPageOrder')}</label>
                    <Dropdown
                      className="w-full text-sm rounded-md px-3 py-2 ribbon-input"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 38 }}
                      value={settings.pageOrder}
                      onChange={v => update('pageOrder', v as any)}
                      options={[
                        { label: t('print.excelOrderDown'), value: 'downRight' },
                        { label: t('print.excelOrderRight'), value: 'rightDown' },
                      ]}
                    />
                  </div>
                </>
              )}

              {/* 质量 (通用) */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.quality')}</label>
                <Dropdown
                  className="w-full text-sm rounded-md px-3 py-2 ribbon-input"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 38 }}
                  value={settings.quality}
                  onChange={v => update('quality', v as any)}
                  options={[
                    { label: t('print.qualityDraft'), value: 'draft' },
                    { label: t('print.qualityNormal'), value: 'normal' },
                    { label: t('print.qualityHigh'), value: 'high' },
                    { label: t('print.qualityPhoto'), value: 'photo' },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* 右侧：预览 */}
          <div className="w-1/2 overflow-auto p-5 flex flex-col items-[safe_center]" style={{ background: 'var(--color-bg-alt)' }} ref={previewRef}>
            <div className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
              {t('print.preview')} · {settings.paperSize} · {settings.orientation === 'portrait' ? t('print.portrait') : t('print.landscape')} · {Math.round(effScale)}%
            </div>
            {/* 纸张预览（word：按页高切片显示当前页；ppt/excel：整幅内容） */}
            <div
              data-testid="print-preview"
              className="bg-white shadow-2xl relative"
              style={{
                width: `${previewW * 1.5}px`,
                // round57：word 非选区模式改多页卡片流（PageFlow 自带纸张卡），
                // 外层与 excel/ppt 一致透明自适应；仅 word 选区模式保留
                // 旧单张固定纸页（选区片段无分页语义）。
                ...((editorType === 'excel' || editorType === 'ppt' || editorType === 'pdf' || (editorType === 'word' && !wordSelMode)) ? { background: 'transparent', boxShadow: 'none', height: 'auto', padding: 0 } : { height: `${previewH * 1.5}px`, padding: `${settings.margins.top * 1.5}px ${settings.margins.right * 1.5}px ${settings.margins.bottom * 1.5}px ${settings.margins.left * 1.5}px` }),
                transform: `scale(${effScale / 100})`,
                transformOrigin: 'top center',
                filter: settings.color === 'color' ? 'none' : 'grayscale(1)',
              }}
            >
              {editorType === 'word' && !wordSelMode ? (
                <PageFlow
                  testId="print-flow"
                  renderContent={() => renderPreview ? renderPreview(settings) : <div className="flex items-center justify-center text-gray-400 text-sm" style={{ height: contentH }}>{t('print.previewEmpty')}</div>}
                  contentH={contentH}
                  paperW={previewW * 1.5}
                  paperH={previewH * 1.5}
                  pad={{ top: settings.margins.top * 1.5, right: settings.margins.right * 1.5, bottom: settings.margins.bottom * 1.5, left: settings.margins.left * 1.5 }}
                  pages={wordPages}
                  perPage={settings.perPage}
                  onCount={handleCount}
                />
              ) : editorType === 'word' ? (
                <div style={{ height: contentH, overflow: 'hidden' }}>
                  <div ref={previewContentRef} style={{ transform: `translateY(${-(currentPage - 1) * contentH}px)` }}>
                    {renderPreview ? renderPreview(settings) : (
                      <div className="h-full flex items-center justify-center text-gray-400 text-sm">{t('print.previewEmpty')}</div>
                    )}
                  </div>
                </div>
              ) : (
                renderPreview ? renderPreview(settings) : (
                  <div className="h-full flex items-center justify-center text-gray-400 text-sm">{t('print.previewEmpty')}</div>
                )
              )}
              {/* 装订线指示 */}
              {settings.binding !== 'none' && (
                <div
                  className="absolute bg-red-200"
                  style={settings.binding === 'left'
                    ? { left: '8px', top: 0, bottom: 0, width: '2px' }
                    : { top: '8px', left: 0, right: 0, height: '2px' }}
                />
              )}
            </div>
            {/* 页码导航（word：真实分页翻页） */}
            {editorType === 'word' && (
              <div className="flex items-center gap-3 mt-4">
                <button
                  data-testid="print-page-prev"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ color: 'var(--color-text)' }}
                >◀</button>
                <span data-testid="print-page-indicator" className="text-sm" style={{ color: 'var(--color-text)' }}>{currentPage} / {pageCount}</span>
                <button
                  data-testid="print-page-next"
                  disabled={currentPage >= pageCount}
                  onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))}
                  className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ color: 'var(--color-text)' }}
                >▶</button>
              </div>
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('print.summary', { pages: editorType === 'word' ? pageCount : 1, copies: settings.copies, paper: settings.paperSize })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              data-testid="print-cancel"
              className="px-4 py-1.5 text-sm rounded-md"
              style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)' }}
            >
              {t('print.cancel')}
            </button>
            <button
              onClick={doPrint}
              data-testid="print-confirm"
              className="px-6 py-1.5 text-sm rounded-md font-medium text-white"
              style={{ background: 'var(--color-primary)' }}
            >
              🖨 {t('print.print')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
