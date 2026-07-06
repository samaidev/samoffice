import { useState, useRef, useEffect } from 'react'
import { useI18n } from '../i18n'

interface PrintDialogProps {
  open: boolean
  onClose: () => void
  /** 编辑器类型 — 决定显示哪些选项 */
  editorType: 'word' | 'ppt' | 'excel'
  /** 预览内容渲染函数 (返回 HTML 字符串或 ReactNode) */
  renderPreview?: (settings: PrintSettings) => React.ReactNode
  /** 实际打印内容的选择器 (用于 window.print) */
  printSelector?: string
}

/** 打印设置 (对标 MS Office 打印对话框) */
export interface PrintSettings {
  // 打印机
  printer: string          // 打印机名 (空=系统默认)
  // 页范围
  pageRange: 'all' | 'current' | 'custom'
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
  duplex: 'none',
  binding: 'none',
  color: 'color',
  quality: 'normal',
  slidesPerPage: 1,
  pptContent: 'full',
  printArea: false,
  printTitle: false,
  printGridlines: false,
  printComments: 'none',
  pageOrder: 'downRight',
}

// 纸张尺寸 (mm)
const PAPER_SIZES: Record<string, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A5: { w: 148, h: 210 },
  Letter: { w: 216, h: 279 },
  Legal: { w: 216, h: 356 },
}

export function PrintDialog({ open, onClose, editorType, renderPreview, printSelector }: PrintDialogProps) {
  const { t } = useI18n()
  const [settings, setSettings] = useState<PrintSettings>(defaultPrintSettings)
  const [activeTab, setActiveTab] = useState<'general' | 'layout' | 'advanced'>('general')
  const previewRef = useRef<HTMLDivElement>(null)

  const update = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) => {
    setSettings(s => ({ ...s, [key]: value }))
  }

  // 实际执行打印
  const doPrint = () => {
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
    const scaleCss = settings.scaleFit === 'fit' ? 'fit' : settings.scaleFit === 'shrink' ? 'shrink' : '100%'
    const colorCss = settings.color === 'color' ? '' : 'filter: grayscale(1);'
    const duplexCss = settings.duplex !== 'none' ? 'break-after: page;' : ''

    style.textContent = `
      @media print {
        @page {
          size: ${paper.w}mm ${paper.h}mm ${orient};
          margin: ${settings.margins.top}mm ${settings.margins.right}mm ${settings.margins.bottom}mm ${settings.margins.left}mm;
        }
        body * { visibility: hidden; }
        ${printSelector || '.print-content'} { visibility: visible; position: absolute; left: 0; top: 0; width: 100%; ${colorCss} }
        ${printSelector || '.print-content'} * { visibility: visible; }
        .no-print { display: none !important; }
      }
    `

    // 添加打印内容类
    if (printSelector) {
      const el = document.querySelector(printSelector)
      el?.classList.add('print-content')
    }

    setTimeout(() => {
      window.print()
      onClose()
    }, 200)
  }

  if (!open) return null

  const paper = PAPER_SIZES[settings.paperSize]
  const previewW = settings.orientation === 'landscape' ? paper.h : paper.w
  const previewH = settings.orientation === 'landscape' ? paper.w : paper.h

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in" style={{ background: 'rgba(15,23,42,0.7)' }}>
      <div className="bg-white rounded-xl shadow-2xl flex flex-col" style={{ width: '1100px', maxWidth: '95vw', maxHeight: '92vh' }} data-testid="print-dialog">
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
                  <select
                    data-testid="print-printer"
                    value={settings.printer}
                    onChange={e => update('printer', e.target.value)}
                    className="w-full text-sm rounded-md px-3 py-2"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  >
                    <option value="">{t('print.defaultPrinter')}</option>
                    <option value="pdf">Save as PDF</option>
                    <option value="microsoft">Microsoft Print to PDF</option>
                    <option value="onenote">OneNote</option>
                  </select>
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
                  <select
                    value={settings.color}
                    onChange={e => update('color', e.target.value as any)}
                    data-testid="print-color"
                    className="w-full text-sm rounded-md px-3 py-2"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  >
                    <option value="color">{t('print.colorMode')}</option>
                    <option value="grayscale">{t('print.grayscale')}</option>
                    <option value="blackwhite">{t('print.blackwhite')}</option>
                  </select>
                </div>
              </div>
            )}

            {/* === 版式 Tab === */}
            {activeTab === 'layout' && (
              <div className="space-y-4">
                {/* 纸张大小 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.paperSize')}</label>
                  <select
                    value={settings.paperSize}
                    onChange={e => update('paperSize', e.target.value as any)}
                    data-testid="print-paper-size"
                    className="w-full text-sm rounded-md px-3 py-2"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  >
                    <option value="A4">A4 (210×297mm)</option>
                    <option value="A3">A3 (297×420mm)</option>
                    <option value="A5">A5 (148×210mm)</option>
                    <option value="Letter">Letter (216×279mm)</option>
                    <option value="Legal">Legal (216×356mm)</option>
                  </select>
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
                      value={settings.scale}
                      onChange={e => update('scale', parseInt(e.target.value))}
                      data-testid="print-scale"
                      className="flex-1"
                      disabled={settings.scaleFit !== 'actual'}
                    />
                    <span className="text-sm w-12 text-right" style={{ color: 'var(--color-text)' }}>{settings.scale}%</span>
                  </div>
                </div>

                {/* 双面 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.duplex')}</label>
                  <select
                    value={settings.duplex}
                    onChange={e => update('duplex', e.target.value as any)}
                    data-testid="print-duplex"
                    className="w-full text-sm rounded-md px-3 py-2"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  >
                    <option value="none">{t('print.duplexNone')}</option>
                    <option value="long">{t('print.duplexLong')}</option>
                    <option value="short">{t('print.duplexShort')}</option>
                  </select>
                </div>

                {/* 装订 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.binding')}</label>
                  <select
                    value={settings.binding}
                    onChange={e => update('binding', e.target.value as any)}
                    className="w-full text-sm rounded-md px-3 py-2"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  >
                    <option value="none">{t('print.bindingNone')}</option>
                    <option value="left">{t('print.bindingLeft')}</option>
                    <option value="top">{t('print.bindingTop')}</option>
                  </select>
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
                    <select
                      value={settings.pptContent}
                      onChange={e => update('pptContent', e.target.value as any)}
                      data-testid="print-ppt-content"
                      className="w-full text-sm rounded-md px-3 py-2"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                    >
                      <option value="full">{t('print.pptFull')}</option>
                      <option value="handout">{t('print.pptHandout')}</option>
                      <option value="notes">{t('print.pptNotes')}</option>
                      <option value="outline">{t('print.pptOutline')}</option>
                    </select>
                  </div>
                  {settings.pptContent === 'handout' && (
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
                            {n}
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
                    <input type="checkbox" checked={settings.printTitle} onChange={e => update('printTitle', e.target.checked)} />
                    {t('print.excelPrintTitle')}
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="checkbox" checked={settings.printGridlines} onChange={e => update('printGridlines', e.target.checked)} data-testid="print-gridlines" />
                    {t('print.excelGridlines')}
                  </label>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.excelComments')}</label>
                    <select
                      value={settings.printComments}
                      onChange={e => update('printComments', e.target.value as any)}
                      className="w-full text-sm rounded-md px-3 py-2"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                    >
                      <option value="none">{t('print.excelCommentsNone')}</option>
                      <option value="end">{t('print.excelCommentsEnd')}</option>
                      <option value="sheet">{t('print.excelCommentsSheet')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.excelPageOrder')}</label>
                    <select
                      value={settings.pageOrder}
                      onChange={e => update('pageOrder', e.target.value as any)}
                      className="w-full text-sm rounded-md px-3 py-2"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                    >
                      <option value="downRight">{t('print.excelOrderDown')}</option>
                      <option value="rightDown">{t('print.excelOrderRight')}</option>
                    </select>
                  </div>
                </>
              )}

              {/* 质量 (通用) */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-muted)' }}>{t('print.quality')}</label>
                <select
                  value={settings.quality}
                  onChange={e => update('quality', e.target.value as any)}
                  className="w-full text-sm rounded-md px-3 py-2"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                >
                  <option value="draft">{t('print.qualityDraft')}</option>
                  <option value="normal">{t('print.qualityNormal')}</option>
                  <option value="high">{t('print.qualityHigh')}</option>
                  <option value="photo">{t('print.qualityPhoto')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* 右侧：预览 */}
          <div className="w-1/2 overflow-auto p-5 flex flex-col items-center" style={{ background: 'var(--color-bg-alt)' }} ref={previewRef}>
            <div className="text-xs mb-3" style={{ color: 'var(--color-text-muted)' }}>
              {t('print.preview')} · {settings.paperSize} · {settings.orientation === 'portrait' ? t('print.portrait') : t('print.landscape')} · {settings.scale}%
            </div>
            {/* 纸张预览 */}
            <div
              data-testid="print-preview"
              className="bg-white shadow-2xl relative"
              style={{
                width: `${previewW * 1.5}px`,
                height: `${previewH * 1.5}px`,
                padding: `${settings.margins.top * 1.5}px ${settings.margins.right * 1.5}px ${settings.margins.bottom * 1.5}px ${settings.margins.left * 1.5}px`,
                transform: `scale(${settings.scale / 100})`,
                transformOrigin: 'top center',
                filter: settings.color === 'color' ? 'none' : 'grayscale(1)',
              }}
            >
              {renderPreview ? renderPreview(settings) : (
                <div className="h-full flex items-center justify-center text-gray-400 text-sm">
                  {t('print.previewEmpty')}
                </div>
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
            {/* 页码导航 */}
            <div className="flex items-center gap-3 mt-4">
              <button className="p-1.5 rounded hover:bg-gray-200" style={{ color: 'var(--color-text)' }}>◀</button>
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>1 / 3</span>
              <button className="p-1.5 rounded hover:bg-gray-200" style={{ color: 'var(--color-text)' }}>▶</button>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-6 py-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('print.summary', { pages: 3, copies: settings.copies, paper: settings.paperSize })}
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
