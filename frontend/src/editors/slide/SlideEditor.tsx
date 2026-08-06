import { useState, useMemo, memo, useEffect, useRef } from 'react'
import { useI18n } from '../../i18n'
import { PrintDialog } from '../../components/PrintDialog'
import { Dropdown } from '../../components/Dropdown'
import { SlideData, SlideShape } from '../../lib/openroute'

interface Slide {
  id: number; title: string; content: string; bg: string
  layout: 'title' | 'section' | 'content' | 'blank'
  transition: string; notes: string
  shapes: ShapeItem[]; artTexts: ArtTextItem[]
  animations: AnimItem[]
}

// 静态常量在组件外定义，避免每次渲染重建 (perf: 首屏性能优化)
const SHAPE_DEFS = [
  { type: 'rect', icon: '▭' }, { type: 'roundRect', icon: '▢' },
  { type: 'ellipse', icon: '⬭' }, { type: 'triangle', icon: '△' },
  { type: 'diamond', icon: '◇' }, { type: 'rightArrow', icon: '→' },
  { type: 'star5', icon: '★' }, { type: 'hexagon', icon: '⬡' },
  { type: 'pentagon', icon: '⬠' }, { type: 'heart', icon: '♥' },
  { type: 'cloud', icon: '☁' }, { type: 'callout', icon: '💬' },
] as const

const LAYOUT_DEFS = [
  { id: 'title', icon: '🎯' }, { id: 'content', icon: '📝' }, { id: 'blank', icon: '⬜' },
] as const

const PRESET_COLOR_DEFS = [
  '#ffffff', '#f8fafc', '#fef3c7', '#dbeafe', '#dcfce7', '#fce7f3', '#1e293b', '#312e81',
] as const

const TRANSITION_DEFS = [
  '', 'fade', 'push', 'wipe', 'cover', 'cut', 'zoom', 'morph',
] as const

const ENTRANCE_ANIM_DEFS = ['fade', 'fly', 'zoom', 'wipe', 'bounce'] as const
const EMPHASIS_ANIM_DEFS = ['pulse', 'spin'] as const
const EXIT_ANIM_DEFS = ['fade', 'fly', 'zoom'] as const

const ART_PRESET_DEFS = [
  { color: '#4f46e5', gradient: '4f46e5,818cf8', shadow: true },
  { color: '#3b82f6', outline: '1e40af', glow: true },
  { color: '#10b981', glow: true, gradient: '10b981,34d399' },
  { color: '#f59e0b', shadow: true, gradient: 'f59e0b,fbbf24' },
  { color: '#ef4444', shadow: true, outline: '991b1b' },
  { color: '#ffffff', shadow: true },
] as const

interface ShapeItem {
  type: string; x: number; y: number; w: number; h: number
  fill: string; text: string; shadow: boolean; glow: boolean
  gradient: string; rotation: number
  // 现代扩展
  stroke?: string; strokeWidth?: number
  fontSize?: number; fontBold?: boolean; fontColor?: string; font?: string
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
  indent?: number
  bullet?: boolean
  numbered?: boolean
  media?: { type: 'video' | 'audio'; src: string; poster?: string }
  vAlign?: 'top' | 'middle' | 'bottom'
  isFootnote?: boolean
  glowColor?: string; glowRadius?: number
}

interface ArtTextItem {
  text: string; x: number; y: number; w: number; h: number
  fontSize: number; color: string; gradient: string
  shadow: boolean; glow: boolean; outline: string; rotation: number
}

interface AnimItem {
  target: string; effect: string; category: string; delay: number; sound?: string
}

type RibbonTab = 'home' | 'insert' | 'design' | 'modern' | 'animations' | 'transition' | 'view'

function RibbonButton({ icon, label, onClick, active, disabled, title, ...rest }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title || label} {...rest}
      className="flex flex-col items-center justify-center gap-0.5 px-1.5 py-1 rounded-md transition-colors min-w-[44px] disabled:opacity-40"
      style={{ background: active ? 'var(--color-primary-light)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = 'var(--color-bg-alt)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
      <span style={{ fontSize: '15px', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '10px', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  )
}
function RibbonGroup({ label, children }: any) {
  return (
    <div className="flex flex-col items-center px-2 border-r ribbon-group" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-1 py-1 flex-1">{children}</div>
      <div className="text-[10px] font-medium pb-0.5 whitespace-nowrap" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  )
}
function MenuItem({ label, icon, onClick, disabled, danger }: any) {
  return (
    <button disabled={disabled} onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40"
      style={{ color: danger ? '#e11d48' : 'var(--color-text)', background: 'transparent' }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--color-bg-alt)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      <span style={{ width: 16, textAlign: 'center', opacity: 0.8 }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

export function SlideEditor({ initialSlides, onSlidesChange }: { initialSlides?: SlideData[]; onSlidesChange?: (slides: SlideData[]) => void }) {
  const { t } = useI18n()

  // 将真实 PPTX 解析出的 EMU 形状转换为内部 ShapeItem（画布 808×454 逻辑，x/8 → px）
  const emuShapesToItems = (shapes?: SlideShape[], pageW = 12192000, pageH = 6858000): ShapeItem[] => {
    if (!shapes || !shapes.length) return []
    const SX = 6464 / pageW // 808px 宽 = 6464 单位 (x/8)
    const SY = 3632 / pageH // 454px 高 = 3632 单位 (y/4.5)
    return shapes.map((s) => {
      const isPic = s.kind === 'pic'
      const fill = isPic && s.img ? `url("${s.img}")` : (s.fill || '')
      return {
        type: 'rect',
        x: (s.x || 0) * SX,
        y: (s.y || 0) * SY,
        w: (s.cx || 0) * SX,
        h: (s.cy || 0) * SY,
        fill,
        text: isPic ? '' : (s.text || ''),
        shadow: false,
        glow: false,
        gradient: '',
        rotation: 0,
        fontSize: s.sizePt ? Math.round(s.sizePt * 914400 * 808 / (72 * pageW)) : undefined,
        fontBold: !!s.bold,
        fontColor: s.color || undefined,
        textAlign: s.align === 'l' ? 'left' : s.align === 'r' ? 'right' : s.align === 'c' ? 'center' : undefined,
        vAlign: s.vanchor === 't' ? 'top' : s.vanchor === 'b' ? 'bottom' : s.vanchor === 'ctr' ? 'middle' : undefined,
      }
    })
  }
  const LAYOUTS = useMemo(() => LAYOUT_DEFS.map(l => ({ ...l, name: t(`slide.layout.${l.id}`) })), [t])
  const PRESET_COLORS = useMemo(() => PRESET_COLOR_DEFS.map((v, i) => ({ value: v, name: t(['color.white','color.lightGray','color.beige','color.skyBlue','color.mint','color.pink','color.darkGray','color.indigo'][i]) })), [t])
  const TRANSITIONS = useMemo(() => TRANSITION_DEFS.map(id => ({ id, name: id === '' ? t('transition.none') : t(`transition.${id === 'cut' ? 'switch' : id}`) })), [t])
  const SHAPES = useMemo(() => SHAPE_DEFS.map(s => ({ ...s, name: t(`slide.shape.${s.type === 'roundRect' ? 'rounded' : s.type === 'rightArrow' ? 'arrow' : s.type === 'star5' ? 'star' : s.type}`) })), [t])
  const ENTRANCE_ANIMS = useMemo(() => ENTRANCE_ANIM_DEFS.map(e => ({ effect: e, name: e === 'fade' ? t('anim.fadeIn') : e === 'fly' ? t('anim.flyIn') : e === 'zoom' ? t('anim.zoom') : e === 'wipe' ? t('anim.wipe') : t('anim.bounce') })), [t])
  const EMPHASIS_ANIMS = useMemo(() => EMPHASIS_ANIM_DEFS.map(e => ({ effect: e, name: e === 'pulse' ? t('anim.pulse') : t('anim.spin') })), [t])
  const EXIT_ANIMS = useMemo(() => EXIT_ANIM_DEFS.map((e, i) => ({ effect: e, name: e === 'fade' ? t('anim.fadeOut') : e === 'fly' ? t('anim.flyOut') : t('anim.shrink') })), [t])
  const ART_PRESETS = useMemo(() => ART_PRESET_DEFS.map((p, i) => ({ name: t(['art.purple','art.blue','art.green','art.orange','art.red','art.white'][i]), color: p.color, gradient: (p as any).gradient || '', shadow: !!(p as any).shadow, glow: !!(p as any).glow, outline: (p as any).outline || '' })), [t])

  const [slides, setSlides] = useState<Slide[]>(() => {
    if (initialSlides && initialSlides.length) {
      return initialSlides.map((s, i) => {
        const pageW = (s.pageW && s.pageW > 0 ? s.pageW : 12192000) as number
        const pageH = (s.pageH && s.pageH > 0 ? s.pageH : 6858000) as number
        return {
          id: i + 1,
          title: s.title || (i === 0 ? t('slide.titleDefault') : t('slide.contentSlide')),
          content: s.content || (i === 0 ? t('slide.subtitleDefault') : t('slide.contentPlaceholder')),
          bg: s.bg || '#ffffff',
          layout: (i === 0 && !s.content ? 'title' : 'content') as Slide['layout'],
          transition: i === 0 ? 'fade' : '',
          notes: s.notes || '',
          shapes: emuShapesToItems(s.shapes, pageW, pageH),
          artTexts: [],
          animations: [],
        }
      })
    }
    return [
      { id: 1, title: t('slide.titleDefault'), content: t('slide.subtitleDefault'), bg: '#ffffff', layout: 'title', transition: 'fade', notes: '', shapes: [], artTexts: [], animations: [] },
      { id: 2, title: t('slide.contentSlide'), content: t('slide.contentPlaceholder'), bg: '#ffffff', layout: 'content', transition: '', notes: '', shapes: [], artTexts: [], animations: [] },
    ]
  })
  const [active, setActive] = useState(0)
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home')
  const [zoom, setZoom] = useState(100)
  const [autoPlay, setAutoPlay] = useState(false)
  const [autoPlaySec, setAutoPlaySec] = useState(5)
  const [presenting, setPresenting] = useState(false)
  const [presentSlide, setPresentSlide] = useState(0)
  const [showShapePanel, setShowShapePanel] = useState(false)
  const [showAnimPanel, setShowAnimPanel] = useState(false)
  const [pendingSound, setPendingSound] = useState<string>('none')
  const [showArtPanel, setShowArtPanel] = useState(false)
  // 二级颜色弹出菜单 — 统一 click 触发，避免 hover 残留导致重叠
  const [showColorPopup, setShowColorPopup] = useState(false)
  const [showInsertSlide, setShowInsertSlide] = useState(false)
  // 弹出面板互斥：同时只允许一个面板打开，避免多个弹出菜单重叠
  type PanelName = 'shape' | 'anim' | 'art' | 'color'
  const openPanel = (which: PanelName) => {
    setShowShapePanel(which === 'shape' ? !showShapePanel : false)
    setShowAnimPanel(which === 'anim' ? !showAnimPanel : false)
    setShowArtPanel(which === 'art' ? !showArtPanel : false)
    setShowColorPopup(which === 'color' ? !showColorPopup : false)
  }
  const closeAllPanels = () => { setShowShapePanel(false); setShowAnimPanel(false); setShowArtPanel(false); setShowColorPopup(false); setShowInsertSlide(false) }
  const anyPanelOpen = showShapePanel || showAnimPanel || showArtPanel || showColorPopup || showInsertSlide
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [selectedEl, setSelectedEl] = useState<{ type: 'shape' | 'art'; index: number } | null>(null)
  const [dragInfo, setDragInfo] = useState<{ startX: number; startY: number; origX: number; origY: number; mode: 'move' | 'resize' | 'rotate' } | null>(null)
  // 右键上下文菜单 + 剪切板（对标 MS PPT 元素右键菜单）
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; type: 'shape' | 'art'; index: number } | null>(null)
  const clipboardRef = useRef<{ type: 'shape' | 'art'; data: ShapeItem | ArtTextItem } | null>(null)
  // 文本内联编辑（双击元素编辑文字，对标 MS PPT）
  const [editing, setEditing] = useState<{ type: 'shape' | 'art'; index: number } | null>(null)
  const editAreaRef = useRef<HTMLTextAreaElement | null>(null)

  // 撤销/重做历史栈
  const [past, setPast] = useState<Slide[][]>([])
  const [future, setFuture] = useState<Slide[][]>([])
  const recordHistory = (snapshot: Slide[]) => { setPast(p => [...p, snapshot]); setFuture([]) }
  const undo = () => {
    if (!past.length) return
    const prev = past[past.length - 1]
    setPast(p => p.slice(0, -1))
    setFuture(f => [slides, ...f])
    setSlides(prev)
  }
  const redo = () => {
    if (!future.length) return
    const next = future[0]
    setFuture(f => f.slice(1))
    setPast(p => [...p, slides])
    setSlides(next)
  }

  const insertSlide = (at: number, layout: 'title' | 'section' | 'blank' | 'content') => {
    recordHistory(slides)
    const n = slides.length + 1
    let slide: Slide
    if (layout === 'title') {
      slide = { id: Date.now(), title: t('slide.titleSlide'), content: t('slide.subtitleHere'), bg: '#1e293b', layout: 'title', transition: '', notes: '', shapes: [], artTexts: [], animations: [] }
    } else if (layout === 'section') {
      slide = { id: Date.now(), title: t('slide.sectionSlide'), content: '', bg: '#312e81', layout: 'section', transition: '', notes: '', shapes: [], artTexts: [], animations: [] }
    } else if (layout === 'blank') {
      slide = { id: Date.now(), title: t('slide.slideN', { n }), content: '', bg: '#ffffff', layout: 'blank', transition: '', notes: '', shapes: [], artTexts: [], animations: [] }
    } else {
      slide = { id: Date.now(), title: t('slide.slideN', { n }), content: t('slide.addContentHere'), bg: '#ffffff', layout: 'content', transition: '', notes: '', shapes: [], artTexts: [], animations: [] }
    }
    setSlides(s => { const next = [...s]; next.splice(at + 1, 0, slide); return next })
    setActive(at + 1)
    setShowInsertSlide(false)
  }
  const addSlide = () => insertSlide(slides.length - 1, 'content')
  const deleteSlide = (idx: number) => { if (slides.length <= 1) return; recordHistory(slides); setSlides(s => s.filter((_, i) => i !== idx)); if (active >= idx && active > 0) setActive(active - 1) }
  const duplicateSlide = (idx: number) => { recordHistory(slides); setSlides(s => { const copy = { ...s[idx], id: Date.now() }; const next = [...s]; next.splice(idx + 1, 0, copy); return next }); setActive(idx + 1) }
  const updateActive = (patch: Partial<Slide>) => { recordHistory(slides); setSlides(s => s.map((sl, i) => i === active ? { ...sl, ...patch } : sl)) }
  const switchSlide = (i: number) => { if (i === active) return; setActive(i) }
  const current = slides[active] || slides[0]
  const isDark = current.bg === '#1e293b' || current.bg === '#312e81'

  // 把内部 Slide[]（px 坐标）转换为可保存的 SlideData[]（EMU 坐标），供 App 保存 pptx
  const slidesToData = useMemo(() => {
    const PAGE_W = 12192000
    const PAGE_H = 6858000
    const SX = PAGE_W / 6464 // EMU per px (x/8 → 6464 单位 = 808px)
    const SY = PAGE_H / 3632 // EMU per px (y/4.5 → 3632 单位 = 454px)
    const toEMUx = (px: number) => Math.round(px * SX)
    const toEMUy = (py: number) => Math.round(py * SY)
    return (src: Slide[]): SlideData[] => src.map((s) => {
      const shapes: SlideShape[] = []
      for (const sh of s.shapes) {
        const isPic = typeof sh.fill === 'string' && sh.fill.startsWith('url(')
        let img: string | undefined
        if (isPic) {
          const m = sh.fill.match(/^url\(\s*["']?(.*?)["']?\s*\)$/)
          img = m ? m[1] : undefined
        }
        shapes.push({
          kind: isPic ? 'pic' : 'text',
          type: sh.type,
          x: toEMUx(sh.x),
          y: toEMUy(sh.y),
          cx: toEMUx(sh.w),
          cy: toEMUy(sh.h),
          fill: isPic ? undefined : (sh.fill || ''),
          text: sh.text,
          color: sh.fontColor,
          sizePt: sh.fontSize,
          bold: sh.fontBold,
          align: sh.textAlign === 'left' ? 'l' : sh.textAlign === 'right' ? 'r' : sh.textAlign === 'center' ? 'c' : 'l',
          vanchor: sh.vAlign === 'top' ? 't' : sh.vAlign === 'bottom' ? 'b' : 'ctr',
          img,
        })
      }
      // 艺术字也作为文本形状保存
      for (const art of s.artTexts) {
        shapes.push({
          kind: 'text',
          type: 'rect',
          x: toEMUx(art.x),
          y: toEMUy(art.y),
          cx: toEMUx(art.w),
          cy: toEMUy(art.h),
          fill: '',
          text: art.text,
          color: art.color,
          sizePt: art.fontSize,
          bold: true,
          align: 'c',
          vanchor: 'ctr',
        })
      }
      return {
        title: s.title,
        content: s.content,
        notes: s.notes,
        bg: s.bg,
        shapes,
        pageW: PAGE_W,
        pageH: PAGE_H,
      }
    })
  }, [])

  // 幻灯片变化时回传给 App（用于保存）
  useEffect(() => {
    onSlidesChange?.(slidesToData(slides))
  }, [slides, onSlidesChange, slidesToData])

  // 形状操作
  const addShape = (type: string) => {
    recordHistory(slides)
    const newShape: ShapeItem = { type, x: 200 + Math.random()*100, y: 200 + Math.random()*100, w: 200, h: 120, fill: '#4f46e5', text: '', shadow: false, glow: false, gradient: '', rotation: 0 }
    updateActive({ shapes: [...current.shapes, newShape] })
    setShowShapePanel(false)
  }
  const removeShape = (idx: number) => { recordHistory(slides); updateActive({ shapes: current.shapes.filter((_, i) => i !== idx) }) }
  const updateShape = (idx: number, patch: Partial<ShapeItem>, record = true) => {
    if (record) recordHistory(slides)
    const newShapes = current.shapes.map((s, i) => i === idx ? { ...s, ...patch } : s)
    updateActive({ shapes: newShapes })
  }

  // 艺术字操作
  const addArtText = (preset: any) => {
    const text = prompt(t('slide.prompt.wordArt'), 'SamOffice')
    if (!text) return
    recordHistory(slides)
    const newArt: ArtTextItem = {
      text, x: 100, y: 100, w: 400, h: 80,
      fontSize: 36, color: preset.color, gradient: preset.gradient || '',
      shadow: preset.shadow || false, glow: preset.glow || false, outline: preset.outline || '', rotation: 0,
    }
    updateActive({ artTexts: [...current.artTexts, newArt] })
    setShowArtPanel(false)
  }
  const removeArtText = (idx: number) => { recordHistory(slides); updateActive({ artTexts: current.artTexts.filter((_, i) => i !== idx) }) }
  const updateArtText = (idx: number, patch: Partial<ArtTextItem>, record = true) => {
    if (record) recordHistory(slides)
    const newArts = current.artTexts.map((a, i) => i === idx ? { ...a, ...patch } : a)
    updateActive({ artTexts: newArts })
  }

  // 叠放层次（z-order，对标 MS PPT：置于顶层/底层、上移/下移一层）
  const reorderShape = (idx: number, to: 'front' | 'back' | 'forward' | 'backward') => {
    recordHistory(slides)
    const shapes = [...current.shapes]
    const [item] = shapes.splice(idx, 1)
    if (to === 'front') shapes.push(item)
    else if (to === 'back') shapes.unshift(item)
    else if (to === 'forward') shapes.splice(Math.min(idx + 1, shapes.length), 0, item)
    else if (to === 'backward') shapes.splice(Math.max(idx - 1, 0), 0, item)
    updateActive({ shapes })
  }
  const reorderArt = (idx: number, to: 'front' | 'back' | 'forward' | 'backward') => {
    recordHistory(slides)
    const arts = [...current.artTexts]
    const [item] = arts.splice(idx, 1)
    if (to === 'front') arts.push(item)
    else if (to === 'back') arts.unshift(item)
    else if (to === 'forward') arts.splice(Math.min(idx + 1, arts.length), 0, item)
    else if (to === 'backward') arts.splice(Math.max(idx - 1, 0), 0, item)
    updateActive({ artTexts: arts })
  }

  // 剪切 / 复制 / 粘贴（元素级，对标 MS PPT 右键菜单）
  const copySelected = () => {
    if (!selectedEl) return
    if (selectedEl.type === 'shape') clipboardRef.current = { type: 'shape', data: { ...current.shapes[selectedEl.index] } }
    else clipboardRef.current = { type: 'art', data: { ...current.artTexts[selectedEl.index] } }
  }
  const cutSelected = () => {
    if (!selectedEl) return
    copySelected()
    if (selectedEl.type === 'shape') removeShape(selectedEl.index)
    else removeArtText(selectedEl.index)
    setSelectedEl(null)
  }
  const pasteClipboard = () => {
    const clip = clipboardRef.current
    if (!clip) return
    recordHistory(slides)
    if (clip.type === 'shape') {
      const copy = { ...(clip.data as ShapeItem), x: (clip.data as ShapeItem).x + 16, y: (clip.data as ShapeItem).y + 16 }
      const shapes = [...current.shapes, copy]
      updateActive({ shapes })
      setSelectedEl({ type: 'shape', index: shapes.length - 1 })
    } else {
      const copy = { ...(clip.data as ArtTextItem), x: (clip.data as ArtTextItem).x + 16, y: (clip.data as ArtTextItem).y + 16 }
      const arts = [...current.artTexts, copy]
      updateActive({ artTexts: arts })
      setSelectedEl({ type: 'art', index: arts.length - 1 })
    }
  }

  // 内联文本编辑：双击文字元素进入编辑，对标 MS PPT 直接改字
  const isTextEditable = (type: 'shape' | 'art', index: number) => {
    if (type === 'art') return true
    const sh = current.shapes[index]
    return sh && !sh.media // 图片/视频等媒体无文字
  }
  const startEdit = (type: 'shape' | 'art', index: number, e?: React.MouseEvent) => {
    if (!isTextEditable(type, index)) return
    e?.stopPropagation()
    setSelectedEl({ type, index })
    setEditing({ type, index })
    setTimeout(() => {
      editAreaRef.current?.focus()
      editAreaRef.current?.select()
    }, 0)
  }
  const commitEdit = () => {
    if (!editing) return
    const val = editAreaRef.current?.value ?? ''
    if (editing.type === 'shape') {
      const sh = current.shapes[editing.index]
      if (sh) updateShape(editing.index, { text: val } as any)
    } else {
      updateArtText(editing.index, { text: val })
    }
    setEditing(null)
  }

  // 声音特效引擎（Web Audio 合成，无需外部资源）
  const playSound = (type?: string) => {
    if (!type || type === 'none') return
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      const ac = (playSound as any)._ac || ((playSound as any)._ac = new Ctx())
      const now = ac.currentTime
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.connect(gain); gain.connect(ac.destination)
      const presets: Record<string, { f: number; f2: number; d: number; t: OscillatorType }> = {
        click: { f: 880, f2: 440, d: 0.08, t: 'square' },
        laser: { f: 1200, f2: 200, d: 0.18, t: 'sawtooth' },
        chime: { f: 660, f2: 990, d: 0.4, t: 'sine' },
        applause: { f: 300, f2: 120, d: 0.3, t: 'triangle' },
        whoosh: { f: 200, f2: 800, d: 0.25, t: 'sine' },
      }
      const p = presets[type] || presets.click
      osc.type = p.t
      osc.frequency.setValueAtTime(p.f, now)
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, p.f2), now + p.d)
      gain.gain.setValueAtTime(0.001, now)
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, now + p.d)
      osc.start(now); osc.stop(now + p.d + 0.02)
    } catch { /* 忽略音频错误 */ }
  }

  // 动画操作
  const addAnimation = (effect: string, category: string) => {
    recordHistory(slides)
    const targetIdx = selectedEl?.type === 'shape' ? selectedEl.index : current.shapes.length - 1
    const target = `shape_${targetIdx}`
    const newAnim: AnimItem = { target, effect, category, delay: current.animations.length * 300, sound: pendingSound }
    updateActive({ animations: [...current.animations, newAnim] })
    setShowAnimPanel(false)
  }
  const removeAnimation = (idx: number) => { recordHistory(slides); updateActive({ animations: current.animations.filter((_, i) => i !== idx) }) }

  // 放映控制
  const [presentAnimStep, setPresentAnimStep] = useState(0)
  const startPresent = () => { setPresenting(true); setPresentSlide(active); setPresentAnimStep(0) }
  const entranceAnimOf = (slide: Slide) => slide.animations.filter(a => a.category === 'entrance')
  const nextPresent = () => {
    const ent = entranceAnimOf(presentingSlide)
    if (presentAnimStep < ent.length) {
      const step = presentAnimStep
      setPresentAnimStep(step + 1)
      playSound(ent[step]?.sound)
    } else if (presentSlide < slides.length - 1) {
      setPresentSlide(presentSlide + 1); setPresentAnimStep(0)
    } else {
      setPresenting(false)
    }
  }
  const prevPresent = () => { if (presentAnimStep > 0) setPresentAnimStep(0); else if (presentSlide > 0) { setPresentSlide(presentSlide - 1); setPresentAnimStep(0) } }

  const ribbonTabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: t('slide.ribbon.home') }, { id: 'insert', label: t('slide.ribbon.insert') }, { id: 'design', label: t('slide.ribbon.design') },
    { id: 'modern', label: 'Modern' }, { id: 'animations', label: t('slide.ribbon.animation') }, { id: 'transition', label: t('slide.ribbon.transition') }, { id: 'view', label: t('slide.ribbon.view') },
  ]

  const presentingSlide = slides[presentSlide] || slides[0]

  // 全局拖拽/缩放/旋转处理 (mouse capture on window so movement outside the element still tracks)
  useEffect(() => {
    if (!dragInfo || !selectedEl) return
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragInfo.startX
      const dy = e.clientY - dragInfo.startY
      if (selectedEl.type === 'shape') {
        if (dragInfo.mode === 'move') {
          updateShape(selectedEl.index, { x: Math.max(0, dragInfo.origX + dx * 8), y: Math.max(0, dragInfo.origY + dy * 8) }, false)
        } else if (dragInfo.mode === 'resize') {
          updateShape(selectedEl.index, { w: Math.max(20, dragInfo.origX + dx * 8), h: Math.max(20, dragInfo.origY + dy * 8) }, false)
        } else if (dragInfo.mode === 'rotate') {
          updateShape(selectedEl.index, { rotation: dragInfo.origX + dx }, false)
        }
      } else {
        if (dragInfo.mode === 'move') {
          updateArtText(selectedEl.index, { x: Math.max(0, dragInfo.origX + dx * 8), y: Math.max(0, dragInfo.origY + dy * 8) }, false)
        } else if (dragInfo.mode === 'rotate') {
          updateArtText(selectedEl.index, { rotation: dragInfo.origX + dx }, false)
        }
      }
    }
    const onUp = () => { setDragInfo(null) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [dragInfo, selectedEl, active])

  // Escape 关闭所有弹出面板 或 退出放映模式；Ctrl+Z/Ctrl+Y 撤销重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (presenting) { setPresenting(false); e.preventDefault(); return }
        if (anyPanelOpen) { closeAllPanels(); e.preventDefault() }
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anyPanelOpen, presenting, past.length, future.length])

  // 点击/滚动/ESC 关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null) }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])


  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-alt)', position: 'relative' }}>
      {/* Ribbon Tab 栏 — 可横向滚动，右侧页码固定 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', position: 'relative', zIndex: 45 }}>
        <div className="ribbon-tab-scroll">
          {ribbonTabs.map(t => (
            <button key={t.id} onClick={() => { closeAllPanels(); setRibbonTab(t.id) }} data-testid={`ribbon-tab-${t.id}`} className="ribbon-tab-btn px-2 sm:px-4 py-2 text-sm font-medium transition-colors"
              style={{ color: ribbonTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === t.id ? 'var(--color-primary-50)' : 'transparent' }}>{t.label}</button>
          ))}
        </div>
        <span className="text-xs flex-shrink-0 px-2" data-testid="slide-page-indicator" style={{ color: 'var(--color-text-muted)' }}>{active + 1} / {slides.length}</span>
      </div>

      {/* 点击外部关闭弹出面板的透明遮罩 — absolute 限制在编辑器根容器内，
          避免覆盖 header 的 tab 切换栏和 Files 菜单 */}
      {anyPanelOpen && (
        <div className="absolute inset-0" style={{ zIndex: 40 }} onClick={() => closeAllPanels()} />
      )}

      {/* Ribbon 内容区 */}
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b w-full ribbon-scroll" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '64px', position: 'relative', zIndex: 45 }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('slide.edit')}>
            <RibbonButton icon="↶" label={t('slide.undo')} onClick={undo} disabled={!past.length} />
            <RibbonButton icon="↷" label={t('slide.redo')} onClick={redo} disabled={!future.length} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.slides')}>
            <div className="relative">
              <RibbonButton icon="＋" label={t('slide.new')} onClick={() => setShowInsertSlide(v => !v)} />
              {showInsertSlide && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', padding: '0.5rem', zIndex: 50, width: 220 }}>
                  <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('slide.insertSlideTip')}</div>
                  <div className="grid grid-cols-2 gap-1">
                    <button onClick={() => insertSlide(active, 'title')} className="ribbon-menu-item" style={{ textAlign: 'left' }}>
                      <div className="font-semibold text-sm">🎬 {t('slide.layoutTitle')}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('slide.layoutTitleDesc')}</div>
                    </button>
                    <button onClick={() => insertSlide(active, 'section')} className="ribbon-menu-item" style={{ textAlign: 'left' }}>
                      <div className="font-semibold text-sm">📑 {t('slide.layoutSection')}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('slide.layoutSectionDesc')}</div>
                    </button>
                    <button onClick={() => insertSlide(active, 'content')} className="ribbon-menu-item" style={{ textAlign: 'left' }}>
                      <div className="font-semibold text-sm">📄 {t('slide.layoutContent')}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('slide.layoutContentDesc')}</div>
                    </button>
                    <button onClick={() => insertSlide(active, 'blank')} className="ribbon-menu-item" style={{ textAlign: 'left' }}>
                      <div className="font-semibold text-sm">⬜ {t('slide.layoutBlank')}</div>
                      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('slide.layoutBlankDesc')}</div>
                    </button>
                  </div>
                </div>
              )}
            </div>
            <RibbonButton icon="⎘" label={t('slide.copy')} onClick={() => duplicateSlide(active)} />
            <RibbonButton icon="✕" label={t('slide.delete')} onClick={() => deleteSlide(active)} disabled={slides.length <= 1} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.layoutGroup')}>
            {LAYOUTS.map(l => <RibbonButton key={l.id} icon={l.icon} label={l.name} onClick={() => updateActive({ layout: l.id as Slide['layout'] })} active={current.layout === l.id} />)}
          </RibbonGroup>
          <RibbonGroup label={t('slide.font')}>
            <RibbonButton icon="B" label={t('slide.bold')} onClick={() => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; updateShape(selectedEl.index, { fontBold: !sh.fontBold }) } else { alert('加粗已应用于选中元素') } }} />
            <div className="relative">
              <RibbonButton icon="🎨" label={t('slide.color')} onClick={() => openPanel('color')} />
              {showColorPopup && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', padding: '0.5rem', zIndex: 50 }}>
                  <div className="grid grid-cols-4 gap-1">
                    {['#4f46e5','#ef4444','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899','#000000'].map(c => (
                      <button key={c} onClick={() => {
                        if (!selectedEl) { alert('请先选择元素'); closeAllPanels(); return }
                        if (selectedEl.type === 'shape') updateShape(selectedEl.index, { fontColor: c })
                        else updateArtText(selectedEl.index, { color: c })
                        closeAllPanels()
                      }} className="w-6 h-6 rounded-md border transition-transform hover:scale-110" style={{ background: c, borderColor: 'var(--color-border)' }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
            {/* 字号调整：放大 / 缩小 */}
            <RibbonButton icon="A+" label={t('slide.fontSizeUp')} onClick={() => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; updateShape(selectedEl.index, { fontSize: (sh.fontSize || 16) + 2 }) } else { const at = current.artTexts[selectedEl.index]; updateArtText(selectedEl.index, { fontSize: (at.fontSize || 36) + 2 }) } }} />
            <RibbonButton icon="A-" label={t('slide.fontSizeDown')} onClick={() => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; updateShape(selectedEl.index, { fontSize: Math.max(6, (sh.fontSize || 16) - 2) }) } else { const at = current.artTexts[selectedEl.index]; updateArtText(selectedEl.index, { fontSize: Math.max(8, (at.fontSize || 36) - 2) }) } }} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.paragraph')}>
            {/* 行距 */}
            <div className="flex items-center gap-0.5">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('slide.lineSpacing')}</span>
              <select value={current.shapes[selectedEl?.type === 'shape' ? selectedEl.index : 0]?.lineHeight || 1} onChange={(e) => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') updateShape(selectedEl.index, { lineHeight: parseFloat(e.target.value) || 1 }) }} className="text-xs rounded-md px-1 py-1 ribbon-input" style={{ width: 64, height: 26, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                <option value="1">1.0</option>
                <option value="1.15">1.15</option>
                <option value="1.5">1.5</option>
                <option value="2">2.0</option>
                <option value="2.5">2.5</option>
              </select>
            </div>
            {/* 缩进 */}
            <RibbonButton icon="→|" label={t('slide.indentMore')} onClick={() => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; updateShape(selectedEl.index, { indent: (sh.indent || 0) + 1 }) } }} />
            <RibbonButton icon="|←" label={t('slide.indentLess')} onClick={() => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; updateShape(selectedEl.index, { indent: Math.max(0, (sh.indent || 0) - 1) }) } }} />
            {/* 项目符号 / 编号 */}
            <RibbonButton icon="•" label={t('slide.bulletList')} onClick={() => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; updateShape(selectedEl.index, { bullet: !sh.bullet, numbered: false }) } }} />
            <RibbonButton icon="1." label={t('slide.numberedList')} onClick={() => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') { const sh = current.shapes[selectedEl.index]; updateShape(selectedEl.index, { numbered: !sh.numbered, bullet: false }) } }} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.paragraph')}>
            <RibbonButton icon="⬅" label={t('slide.alignLeft')} onClick={() => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') { updateShape(selectedEl.index, { textAlign: 'left' }) } else { alert('左对齐已应用于选中元素') } }} />
            <RibbonButton icon="⬌" label={t('slide.alignCenter')} onClick={() => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') { updateShape(selectedEl.index, { textAlign: 'center' }) } else { alert('居中对齐已应用于选中元素') } }} />
            <RibbonButton icon="➡" label={t('slide.alignRight')} onClick={() => { if (!selectedEl) { alert('请先选择元素'); return }; if (selectedEl.type === 'shape') { updateShape(selectedEl.index, { textAlign: 'right' }) } else { alert('右对齐已应用于选中元素') } }} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'insert' && (<>
          <RibbonGroup label={t('slide.shapes')}>
            <div className="relative">
              <RibbonButton icon="▭" label={t('slide.shapes')} onClick={() => openPanel('shape')} />
              {showShapePanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-4 gap-2">
                    {SHAPES.map(s => (
                      <button key={s.type} onClick={() => addShape(s.type)} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 60 }}>
                        <span style={{ fontSize: '20px' }}>{s.icon}</span>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{s.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.wordArt')}>
            <div className="relative">
              <RibbonButton icon="🎨" label={t('slide.wordArt')} onClick={() => openPanel('art')} />
              {showArtPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, right: 'auto', zIndex: 50 }}>
                  <div className="grid grid-cols-3 gap-2">
                    {ART_PRESETS.map(p => (
                      <button key={p.name} onClick={() => addArtText(p)} className="flex flex-col items-center gap-1 p-2 rounded-md transition-colors hover:bg-slate-100" style={{ minWidth: 80 }}>
                        <span style={{ fontSize: '18px', fontWeight: 700, color: p.color, textShadow: p.shadow ? '2px 2px 4px rgba(0,0,0,0.3)' : 'none' }}>Aa</span>
                        <span style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.illustration')}>
            <RibbonButton icon="🖼" label={t('slide.image')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.onchange = () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  const newShape: ShapeItem = {
                    type: 'rect', x: 200, y: 150, w: 240, h: 180,
                    fill: `url(${reader.result})`,
                    text: '', shadow: false, glow: false, gradient: '', rotation: 0,
                  }
                  updateActive({ shapes: [...current.shapes, newShape] })
                }
                reader.readAsDataURL(file)
              }
              input.click()
            }} />
            <RibbonButton icon="📊" label={t('slide.chart')} onClick={() => alert(t('slide.chart'))} />
            <RibbonButton icon="🎬" label={t('slide.video')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'video/*'
              input.onchange = () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  recordHistory(slides)
                  updateActive({ shapes: [...current.shapes, { type: 'rect', x: 160, y: 120, w: 480, h: 270, fill: '', text: '', shadow: false, glow: false, gradient: '', rotation: 0, media: { type: 'video', src: String(reader.result) } } as ShapeItem] })
                }
                reader.readAsDataURL(file)
              }
              input.click()
            }} />
            <RibbonButton icon="🔊" label={t('slide.audio')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'audio/*'
              input.onchange = () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  recordHistory(slides)
                  updateActive({ shapes: [...current.shapes, { type: 'rect', x: 280, y: 200, w: 240, h: 48, fill: '#1f2937', text: file.name, shadow: false, glow: false, gradient: '', rotation: 0, fontColor: '#ffffff', fontSize: 11, media: { type: 'audio', src: String(reader.result) } } as ShapeItem] })
                }
                reader.readAsDataURL(file)
              }
              input.click()
            }} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.flowchart')}>
            <RibbonButton icon="🔀" label={t('slide.flowchart')} onClick={() => {
              const newShapes: ShapeItem[] = [
                { type: 'roundRect', x: 20, y: 200, w: 150, h: 60, fill: '#4f46e5', text: t('slide.flow.start'), shadow: true, glow: false, gradient: '', rotation: 0, fontColor: '#ffffff', fontSize: 12, textAlign: 'center' },
                { type: 'rect', x: 220, y: 200, w: 150, h: 60, fill: '#10b981', text: t('slide.flow.process'), shadow: true, glow: false, gradient: '', rotation: 0, fontColor: '#ffffff', fontSize: 12, textAlign: 'center' },
                { type: 'diamond', x: 420, y: 200, w: 150, h: 60, fill: '#f59e0b', text: t('slide.flow.decision'), shadow: true, glow: false, gradient: '', rotation: 0, fontColor: '#ffffff', fontSize: 12, textAlign: 'center' },
                { type: 'roundRect', x: 620, y: 200, w: 160, h: 60, fill: '#ef4444', text: t('slide.flow.end'), shadow: true, glow: false, gradient: '', rotation: 0, fontColor: '#ffffff', fontSize: 12, textAlign: 'center' },
              ]
              updateActive({ shapes: [...current.shapes, ...newShapes] })
            }} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.link')}>
            <RibbonButton icon="🔗" label={t('slide.hyperlink')} onClick={() => { const url = prompt('URL:'); if (url) window.open(url, '_blank') }} />
            <RibbonButton icon="⚓" label={t('slide.bookmark')} onClick={() => alert(t('slide.bookmark'))} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.text')}>
            <RibbonButton icon="📝" label={t('slide.footnote')} onClick={() => {
              const n = prompt(t('slide.prompt.notes'), current.notes || '')
              if (n === null) return
              const txt = n.trim()
              if (!txt) return
              const shapes = current.shapes || []
              const idx = shapes.findIndex(s => s.isFootnote)
              if (idx >= 0) {
                updateShape(idx, { text: txt })
              } else {
                updateActive({ shapes: [...shapes, { type: 'rect', x: 16, y: 432, w: 776, h: 16, fill: '', text: txt, fontSize: 10, fontBold: false, fontColor: '#64748b', textAlign: 'left', isFootnote: true } as ShapeItem] })
              }
            }} active={!!current.notes} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'design' && (<>
          {/* MS Office 风格主题 */}
          <RibbonGroup label={t('slide.theme')}>
            <div className="flex items-center gap-1 px-1">
              {[
                { id: 'office', name: 'Office', bg: '#ffffff', c1: '#1F4E79', c2: '#2E75B6' },
                { id: 'facets', name: 'Facets', bg: '#0F172A', c1: '#6366F1', c2: '#22D3EE' },
                { id: 'gallery', name: 'Gallery', bg: '#431407', c1: '#F59E0B', c2: '#EC4899' },
                { id: 'slice', name: 'Slice', bg: '#0C4A6E', c1: '#06B6D4', c2: '#FBBF24' },
                { id: 'depth', name: 'Depth', bg: '#064E3B', c1: '#10B981', c2: '#84CC16' },
              ].map(th => (
                <button key={th.id} onClick={() => updateActive({ bg: th.bg })} className="w-12 h-12 rounded-lg border-2 flex flex-col items-center justify-center text-[8px]"
                  style={{ background: th.bg, borderColor: current.bg === th.bg ? 'var(--color-primary)' : 'var(--color-border)', color: th.bg === '#ffffff' ? '#000' : '#fff' }}
                  title={th.name}>
                  <div style={{ background: th.c1, width: '80%', height: '4px', borderRadius: '2px', marginBottom: '2px' }} />
                  <div style={{ background: th.c2, width: '80%', height: '4px', borderRadius: '2px' }} />
                </button>
              ))}
            </div>
          </RibbonGroup>
          {/* MS Office 风格变体 */}
          <RibbonGroup label={t('slide.variants')}>
            <div className="flex items-center gap-1 px-1">
              {['#1F4E79', '#2E75B6', '#5B9BD5', '#9DC3E6'].map(c => (
                <button key={c} onClick={() => updateActive({ bg: c })} className="w-8 h-8 rounded-md border-2"
                  style={{ background: c, borderColor: current.bg === c ? 'var(--color-primary)' : 'var(--color-border)' }} />
              ))}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.background')}>
            <div className="flex items-center gap-1 px-2">
              {PRESET_COLORS.map(c => (
                <button key={c.value} onClick={() => updateActive({ bg: c.value })} className="w-7 h-7 rounded-md border-2 transition-transform hover:scale-110"
                  style={{ background: c.value, borderColor: current.bg === c.value ? 'var(--color-primary)' : 'var(--color-border)' }} title={c.name} />
              ))}
            </div>
            <RibbonButton icon="🎨" label={t('slide.bgFormat')} onClick={() => {
              const color = prompt(t('slide.bgFormatPrompt'), current.bg)
              if (color) updateActive({ bg: color })
            }} title={t('slide.bgFormatTitle')} />
            <RibbonButton icon="🖼" label={t('slide.bgImage')} onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = 'image/*'
              input.onchange = () => {
                const file = input.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => updateActive({ bg: `url(${reader.result})` })
                reader.readAsDataURL(file)
              }
              input.click()
            }} title={t('slide.bgImageTitle')} />
          </RibbonGroup>
          {/* MS Office 风格幻灯片大小 */}
          <RibbonGroup label={t('slide.slideSize')}>
            <RibbonButton icon="📺" label={t('slide.widescreen')} onClick={() => alert(t('slide.widescreen'))} active={true} title={t('slide.widescreenTitle')} />
            <RibbonButton icon="🖥" label={t('slide.standard')} onClick={() => alert(t('slide.standard'))} title={t('slide.standardTitle')} />
            <RibbonButton icon="⚙️" label={t('slide.customSize')} onClick={() => { const w = prompt(t('slide.customSize') + ' width:', '960'); const h = prompt('height:', '540'); if (w && h) alert(t('slide.customSize') + ': ' + w + 'x' + h) }} title={t('slide.customSizeTitle')} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.shapeStyle')}>
            <RibbonButton icon="🌈" label={t('slide.gradient')} onClick={() => { if (current.shapes.length > 0) updateShape(current.shapes.length - 1, { gradient: '6366f1,818cf8' }) }} />
            <RibbonButton icon="💫" label={t('slide.glow')} onClick={() => { if (current.shapes.length > 0) updateShape(current.shapes.length - 1, { glow: !current.shapes[current.shapes.length-1].glow }) }} active={current.shapes.length > 0 && current.shapes[current.shapes.length-1].glow} />
            <RibbonButton icon="🌑" label={t('slide.shadow')} onClick={() => { if (current.shapes.length > 0) updateShape(current.shapes.length - 1, { shadow: !current.shapes[current.shapes.length-1].shadow }) }} active={current.shapes.length > 0 && current.shapes[current.shapes.length-1].shadow} />
            <RibbonButton icon="🔄" label={t('slide.rotate')} onClick={() => { if (current.shapes.length > 0) updateShape(current.shapes.length - 1, { rotation: (current.shapes[current.shapes.length-1].rotation + 15) % 360 }) }} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'modern' && (<>
          {/* 主题预设 */}
          <RibbonGroup label="Theme">
            <div className="flex items-center gap-1 px-1">
              {[
                { id: 'aurora', name: 'Aurora', bg: '#0B1120', c1: '#6366F1', c2: '#22D3EE' },
                { id: 'midnight', name: 'Midnight', bg: '#020617', c1: '#818CF8', c2: '#F472B6' },
                { id: 'ocean', name: 'Ocean', bg: '#0C4A6E', c1: '#06B6D4', c2: '#FBBF24' },
                { id: 'sunset', name: 'Sunset', bg: '#431407', c1: '#F59E0B', c2: '#EC4899' },
                { id: 'minimal', name: 'Minimal', bg: '#FFFFFF', c1: '#0F172A', c2: '#6366F1' },
              ].map(th => (
                <button key={th.id} onClick={() => updateActive({ bg: th.bg })} className="w-12 h-12 rounded-lg border-2 transition-transform hover:scale-110 flex flex-col items-center justify-center text-[8px] font-bold"
                  style={{ background: th.bg, borderColor: current.bg === th.bg ? 'var(--color-primary)' : 'var(--color-border)', color: th.bg === '#FFFFFF' ? '#0F172A' : '#F8FAFC' }}
                  title={th.name}>
                  <span style={{ color: th.c1 }}>●</span>
                  <span style={{ color: th.c2 }}>●</span>
                </button>
              ))}
            </div>
          </RibbonGroup>

          {/* 渐变背景 */}
          <RibbonGroup label="Gradient BG">
            <div className="flex items-center gap-1 px-1">
              {[
                { name: 'Indigo', colors: '0B1120,131C30' },
                { name: 'Aurora', colors: '1e1b4b,312e81' },
                { name: 'Ocean', colors: '0C4A6E,0E7490' },
                { name: 'Sunset', colors: '431407,9A3412' },
                { name: 'Forest', colors: '064E3B,065F46' },
              ].map(g => (
                <button key={g.name} onClick={() => {
                  // 渐变背景通过两个色叠加近似: 用第一色作 bg
                  const c1 = g.colors.split(',')[0]
                  updateActive({ bg: '#' + c1 })
                }} className="w-10 h-10 rounded-md border-2 transition-transform hover:scale-110"
                  style={{ background: `linear-gradient(135deg, #${g.colors.split(',')[0]}, #${g.colors.split(',')[1]})`, borderColor: 'var(--color-border)' }}
                  title={g.name + ' 渐变'} />
              ))}
            </div>
          </RibbonGroup>

          {/* 现代组件 */}
          <RibbonGroup label="Components">
            <RibbonButton icon="📊" label="KPI Card" onClick={() => {
              const x = 200 + current.shapes.length * 50
              updateActive({
                shapes: [...current.shapes,
                  { type: 'roundRect', x, y: 200, w: 300, h: 180, fill: '#1A2540', stroke: '#334155', strokeWidth: 2, text: '10x', fontSize: 28, fontBold: true, fontColor: '#818CF8', font: 'Space Grotesk', shadow: true, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                  { type: 'rect', x: x + 30, y: 230, w: 60, h: 8, fill: '#6366F1', stroke: '', strokeWidth: 0, text: '', fontSize: 0, fontBold: false, fontColor: '', font: '', shadow: false, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                  { type: 'rect', x, y: 310, w: 300, h: 30, fill: '', stroke: '', strokeWidth: 0, text: 'PERF GAIN', fontSize: 10, fontBold: true, fontColor: '#94A3B8', font: 'Inter', shadow: false, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                ]
              })
            }} />
            <RibbonButton icon="💡" label="Glass Card" onClick={() => {
              const x = 200 + current.shapes.length * 30
              updateActive({
                shapes: [...current.shapes,
                  { type: 'roundRect', x, y: 200, w: 350, h: 200, fill: '#1A2540', stroke: '#334155', strokeWidth: 2, text: 'Glass Card', fontSize: 16, fontBold: true, fontColor: '#F8FAFC', font: 'Space Grotesk', shadow: true, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                ]
              })
            }} />
            <RibbonButton icon="📝" label="Code Block" onClick={() => {
              const x = 200 + current.shapes.length * 30
              updateActive({
                shapes: [...current.shapes,
                  { type: 'roundRect', x, y: 200, w: 400, h: 150, fill: '#0B1120', stroke: '#1e293b', strokeWidth: 2, text: 'fmt.Println("Hello")', fontSize: 12, fontBold: false, fontColor: '#86EFAC', font: 'Consolas', shadow: false, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                ]
              })
            }} />
            <RibbonButton icon="🏷️" label="Pill" onClick={() => {
              const x = 200 + current.shapes.length * 30
              updateActive({
                shapes: [...current.shapes,
                  { type: 'roundRect', x, y: 200, w: 120, h: 30, fill: '#6366F1', stroke: '', strokeWidth: 0, text: 'NEW', fontSize: 9, fontBold: true, fontColor: '#FFFFFF', font: 'Inter', shadow: false, glow: false, glowColor: '', glowRadius: 0, gradient: '', rotation: 0 },
                ]
              })
            }} />
            <RibbonButton icon="✨" label="Glow Text" onClick={() => {
              const x = 200 + current.shapes.length * 30
              updateActive({
                shapes: [...current.shapes,
                  { type: 'rect', x, y: 200, w: 400, h: 60, fill: '', stroke: '', strokeWidth: 0, text: 'Glow Title', fontSize: 28, fontBold: true, fontColor: '#F8FAFC', font: 'Space Grotesk', shadow: false, glow: true, glowColor: '#6366F1', glowRadius: 60000, gradient: '', rotation: 0 },
                ]
              })
            }} />
          </RibbonGroup>

          {/* 玻璃质感 */}
          <RibbonGroup label="Effects">
            <RibbonButton icon="🔮" label="Glass" onClick={() => { if (current.shapes.length > 0) updateShape(current.shapes.length - 1, { glow: !current.shapes[current.shapes.length-1].glow }) }} active={current.shapes.length > 0 && current.shapes[current.shapes.length-1].glow} />
            <RibbonButton icon="🌗" label="Shadow" onClick={() => { if (current.shapes.length > 0) updateShape(current.shapes.length - 1, { shadow: !current.shapes[current.shapes.length-1].shadow }) }} active={current.shapes.length > 0 && current.shapes[current.shapes.length-1].shadow} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'animations' && (<>
          <RibbonGroup label={t('slide.entranceAnim')}>
            <div className="relative">
              <RibbonButton icon="➡" label={t('slide.enter')} onClick={() => openPanel('anim')} />
              {showAnimPanel && (
                <div className="absolute top-full ribbon-popup" style={{ left: 0, top: '100%', zIndex: 50 }}>
                  <div className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('slide.enter')}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {ENTRANCE_ANIMS.map(a => <button key={a.effect} onClick={() => addAnimation(a.effect, 'entrance')} className="px-3 py-1.5 text-xs rounded-md transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{a.name}</button>)}
                  </div>
                  <div className="text-[10px] font-bold uppercase mt-3 mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('slide.emphasis')}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {EMPHASIS_ANIMS.map(a => <button key={a.effect} onClick={() => addAnimation(a.effect, 'emphasis')} className="px-3 py-1.5 text-xs rounded-md transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{a.name}</button>)}
                  </div>
                  <div className="text-[10px] font-bold uppercase mt-3 mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('slide.exit')}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {EXIT_ANIMS.map(a => <button key={a.effect} onClick={() => addAnimation(a.effect, 'exit')} className="px-3 py-1.5 text-xs rounded-md transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{a.name}</button>)}
                  </div>
                  <div className="text-[10px] font-bold uppercase mt-3 mb-2" style={{ color: 'var(--color-text-muted)' }}>{t('slide.sound')}</div>
                  <div className="flex items-center gap-1">
                    <select value={pendingSound} onChange={(e) => setPendingSound(e.target.value)} className="text-xs rounded-md px-1 py-1 ribbon-input" style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                      <option value="none">{t('slide.soundNone')}</option>
                      <option value="click">{t('slide.soundClick')}</option>
                      <option value="laser">{t('slide.soundLaser')}</option>
                      <option value="chime">{t('slide.soundChime')}</option>
                      <option value="applause">{t('slide.soundApplause')}</option>
                      <option value="whoosh">{t('slide.soundWhoosh')}</option>
                    </select>
                    <button onClick={() => playSound(pendingSound)} className="px-2 py-1 text-xs rounded-md" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>▶</button>
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.animPane')}>
            <div className="flex flex-col gap-0.5 max-h-[48px] overflow-y-auto">
              {current.animations.length === 0 ? (
                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{t('slide.noAnim')}</span>
              ) : current.animations.map((a, i) => (
                <div key={i} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: a.category === 'entrance' ? '#10b981' : a.category === 'emphasis' ? '#f59e0b' : '#ef4444' }}>●</span>
                  <span>{a.effect}</span>
                  <button onClick={() => removeAnimation(i)} className="text-[8px] opacity-50 hover:opacity-100">✕</button>
                </div>
              ))}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.timing')}>
            <RibbonButton icon="⏱" label={autoPlay ? `${t('slide.auto')}${autoPlaySec}s` : t('slide.manual')} onClick={() => setAutoPlay(!autoPlay)} active={autoPlay} />
            {autoPlay && (
              <Dropdown
                className="text-xs rounded-md px-2 py-1 ribbon-input"
                style={{ width: 60, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', height: 26 }}
                value={String(autoPlaySec)}
                onChange={v => setAutoPlaySec(parseInt(v))}
                options={[
                  { label: '3s', value: '3' },
                  { label: '5s', value: '5' },
                  { label: '10s', value: '10' },
                  { label: '15s', value: '15' },
                ]}
              />
            )}
          </RibbonGroup>
        </>)}

        {ribbonTab === 'transition' && (<>
          <RibbonGroup label={t('slide.transitionEffect')}>
            <div className="flex items-center gap-1 px-2">
              {TRANSITIONS.map(t => (
                <button key={t.id} onClick={() => updateActive({ transition: t.id })} className="px-3 py-1.5 text-xs rounded-md transition-colors"
                  style={{ background: current.transition === t.id ? 'var(--color-primary-light)' : 'transparent', color: current.transition === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>{t.name}</button>
              ))}
            </div>
          </RibbonGroup>
          <RibbonGroup label={t('slide.notes')}>
            <RibbonButton icon="📝" label={t('slide.speakerNotes')} onClick={() => { const n = prompt(t('slide.prompt.notes'), current.notes); if (n !== null) updateActive({ notes: n }) }} active={!!current.notes} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'view' && (<>
          <RibbonGroup label={t('slide.zoom')}>
            <RibbonButton icon="−" label={t('slide.zoomOut')} onClick={() => setZoom(Math.max(50, zoom - 25))} />
            <div className="flex flex-col items-center px-2"><span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)' }}>{zoom}%</span></div>
            <RibbonButton icon="+" label={t('slide.zoomIn')} onClick={() => setZoom(Math.min(150, zoom + 25))} />
            <RibbonButton icon="▮" label="100%" onClick={() => setZoom(100)} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.navigation')}>
            <RibbonButton icon="←" label={t('slide.prev')} onClick={() => switchSlide(Math.max(0, active - 1))} disabled={active === 0} />
            <RibbonButton icon="→" label={t('slide.next')} onClick={() => switchSlide(Math.min(slides.length - 1, active + 1))} disabled={active === slides.length - 1} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.slideshow')}>
            <RibbonButton icon="▶" label={t('slide.fromStart')} onClick={() => { setActive(0); startPresent() }} />
            <RibbonButton icon="▶" label={t('slide.fromCurrent')} onClick={startPresent} />
          </RibbonGroup>
          {/* MS Office 风格打印 */}
          <RibbonGroup label={t('print.title')}>
            <RibbonButton icon="🖨" label={t('doc.printPreview')} onClick={() => setPrintDialogOpen(true)} data-testid="ppt-print-btn" title={t('print.title')} />
          </RibbonGroup>
        </>)}
      </div>

      {/* 打印对话框 */}
      <PrintDialog
        open={printDialogOpen}
        onClose={() => setPrintDialogOpen(false)}
        editorType="ppt"
        printSelector=".slide-canvas"
        renderPreview={(settings) => {
          const per = settings.slidesPerPage || 1
          const showNotes = settings.pptContent === 'notes'
          const showOutline = settings.pptContent === 'outline'
          // 网格列数（对标 MS PPT 讲义布局：2→1列, 3→3列, 4→2列, 6→3列, 9→3列）
          const cols = per <= 1 ? 1 : per === 2 ? 1 : per === 3 ? 3 : per === 4 ? 2 : per === 6 ? 3 : 3
          // 缩略图缩放（画布 808x454 → 约 86px 宽）
          const K = 0.106

          const clipFor = (type: string) => {
            switch (type) {
              case 'rect': return 'inset(0 0 0 0)'
              case 'roundRect': return 'inset(12% 8% 12% 8% round 18px)'
              case 'ellipse': return 'ellipse(50% 50% at 50% 50%)'
              case 'triangle': return 'polygon(50% 6%, 94% 94%, 6% 94%)'
              case 'diamond': return 'polygon(50% 4%, 96% 50%, 50% 96%, 4% 50%)'
              case 'rightArrow': return 'polygon(0% 35%, 62% 35%, 62% 8%, 100% 50%, 62% 92%, 62% 65%, 0% 65%)'
              case 'star5': return 'polygon(50% 4%, 61% 38%, 98% 38%, 68% 60%, 79% 95%, 50% 73%, 21% 95%, 32% 60%, 2% 38%, 39% 38%)'
              case 'hexagon': return 'polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%)'
              case 'pentagon': return 'polygon(50% 6%, 96% 40%, 78% 95%, 22% 95%, 4% 40%)'
              case 'heart': return 'path("M50,88 C0,55 8,5 50,30 C92,5 100,55 50,88 Z")'
              case 'cloud': return 'path("M25,70 a18,18 0 1,1 18,-22 a16,16 0 1,1 30,8 a16,16 0 1,1 -6,24 Z")'
              case 'callout': return 'path("M12,8 h64 a8,8 0 0,1 8,8 v34 a8,8 0 0,1 -8,8 h-30 l-14,16 v-16 h-20 a8,8 0 0,1 -8,-8 v-34 a8,8 0 0,1 8,-8 Z")'
              default: return 'inset(0 0 0 0)'
            }
          }

          // 单张幻灯片缩略图（真实渲染形状 / 文字 / 图片）
          const SlideMini = ({ slide }: { slide: Slide }) => {
            const isDark = slide.bg === '#1e293b' || slide.bg === '#312e81'
            return (
              <div
                style={{
                  width: 808 * K, height: 454 * K, overflow: 'hidden', position: 'relative',
                  background: slide.bg, border: '1px solid #e5e7eb', color: isDark ? '#f1f5f9' : '#0f172a',
                  flex: '0 0 auto',
                }}
              >
                <div style={{ width: 808, height: 454, transform: `scale(${K})`, transformOrigin: 'top left', position: 'relative' }}>
                  <div style={{ position: 'absolute', inset: 0, padding: 40, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    {slide.title && <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.12 }}>{slide.title}</div>}
                    {slide.content && <div style={{ fontSize: 18, marginTop: 8, whiteSpace: 'pre-wrap', opacity: 0.85 }}>{slide.content}</div>}
                  </div>
                  {slide.shapes.map((sh, i) => {
                    const isPic = typeof sh.fill === 'string' && sh.fill.startsWith('url(')
                    const left = sh.x / 8, top = sh.y / 8, w = sh.w / 8, h = sh.h / 8
                    if (isPic) {
                      const m = sh.fill.match(/^url\(\s*["']?(.*?)["']?\s*\)$/)
                      return <img key={i} src={m ? m[1] : ''} alt="" style={{ position: 'absolute', left, top, width: w, height: h, objectFit: 'cover' }} />
                    }
                    return (
                      <div key={i} style={{ position: 'absolute', left, top, width: w, height: h, display: 'flex', alignItems: sh.vAlign === 'top' ? 'flex-start' : sh.vAlign === 'bottom' ? 'flex-end' : 'center', justifyContent: sh.textAlign === 'left' ? 'flex-start' : sh.textAlign === 'right' ? 'flex-end' : 'center', textAlign: sh.textAlign || 'left', padding: 6, clipPath: clipFor(sh.type), overflow: 'hidden', background: sh.fill || 'transparent', color: sh.fontColor, fontWeight: sh.fontBold ? 700 : 400 }}>
                        <span style={{ fontSize: Math.max(8, (sh.fontSize || 18) / 2.2) }}>{sh.text}</span>
                      </div>
                    )
                  })}
                  {slide.artTexts.map((at, i) => (
                    <div key={'a' + i} style={{ position: 'absolute', left: at.x / 8, top: at.y / 8, color: at.color, fontWeight: 700, fontSize: Math.max(8, at.fontSize / 2.2), textAlign: 'center', maxWidth: at.w / 8, lineHeight: 1.05 }}>
                      {at.text}
                    </div>
                  ))}
                </div>
              </div>
            )
          }

          if (showNotes) {
            return (
              <div className="space-y-2">
                {slides.map((s, i) => (
                  <div key={i} className="p-2 border rounded" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                    <div className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{s.title || `Slide ${i + 1}`}</div>
                    <div className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-text-muted)' }}>{s.notes || '—'}</div>
                  </div>
                ))}
              </div>
            )
          }
          if (showOutline) {
            return (
              <div className="space-y-1">
                {slides.map((s, i) => (
                  <div key={i} className="text-xs" style={{ color: 'var(--color-text)' }}>{i + 1}. {s.title || `Slide ${i + 1}`}</div>
                ))}
              </div>
            )
          }

          // 每页纸排 per 张，多页纸纵向堆叠（对标 MS PPT 讲义视图）
          const papers: Slide[][] = []
          for (let i = 0; i < slides.length; i += per) papers.push(slides.slice(i, i + per))
          return (
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {papers.map((paper, pi) => (
                <div key={pi} style={{ background: '#fff', border: '1px solid #d1d5db', boxShadow: '0 1px 3px rgba(0,0,0,0.12)', padding: 8, position: 'relative' }}>
                  <div className="flex flex-wrap justify-center" style={{ gap: 6, gridTemplateColumns: `repeat(${cols}, auto)` }}>
                    {paper.map((s, i) => <SlideMini key={i} slide={s} />)}
                    {Array.from({ length: per - paper.length }).map((_, k) => (
                      <div key={'e' + k} style={{ width: 808 * K, height: 454 * K, flex: '0 0 auto' }} />
                    ))}
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 9, color: '#6b7280', marginTop: 4 }}>- {pi + 1} -</div>
                </div>
              ))}
            </div>
          )
        }}
      />

      {/* 主体 */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* 左侧缩略图 */}
        <div className="w-40 lg:w-48 flex-shrink-0 overflow-auto p-2 border-r" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{t('slide.slides')}</span>
            <button onClick={addSlide} className="text-sm font-medium px-2 py-0.5 rounded" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>+</button>
          </div>
          <div className="space-y-2">
            {slides.map((s, i) => (
              <div key={s.id} onClick={() => switchSlide(i)} className={`group relative p-1.5 border-2 rounded-lg cursor-pointer transition-all ${i === active ? 'shadow-md' : 'hover:shadow-sm'}`}
                style={{ borderColor: i === active ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="aspect-video rounded overflow-hidden flex flex-col justify-center items-center text-[10px] text-center p-1 relative" style={{ background: s.bg }}>
                  <div className="font-medium truncate w-full leading-tight" style={{ color: (s.bg === '#1e293b' || s.bg === '#312e81') ? '#f1f5f9' : '#0f172a' }}>{s.title}</div>
                  {s.shapes.length > 0 && <div className="text-[8px] mt-0.5" style={{ color: isDark ? '#94a3b8' : '#64748b' }}>📊{s.shapes.length}</div>}
                  {s.animations.length > 0 && <div className="text-[8px]" style={{ color: isDark ? '#94a3b8' : '#64748b' }}>✨{s.animations.length}</div>}
                  <div className="opacity-50 mt-0.5" style={{ color: (s.bg === '#1e293b' || s.bg === '#312e81') ? '#f1f5f9' : '#0f172a' }}>{i + 1}</div>
                </div>
                <div className="absolute -top-2 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={e => { e.stopPropagation(); duplicateSlide(i) }} className="w-5 h-5 rounded-full bg-slate-600 text-white text-[10px] flex items-center justify-center">⎘</button>
                  {slides.length > 1 && <button onClick={e => { e.stopPropagation(); deleteSlide(i) }} className="w-5 h-5 rounded-full bg-rose-500 text-white text-xs flex items-center justify-center">×</button>}
                </div>
                <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: i === active ? 'var(--color-primary)' : 'var(--color-bg-alt)', color: i === active ? 'white' : 'var(--color-text-muted)' }}>{i + 1}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 中间画布 */}
        <div className="flex-1 flex items-center justify-center p-3 sm:p-6 overflow-auto min-h-0" style={{ background: 'var(--color-bg-alt)' }}>
          <div className="bg-white shadow-xl rounded-lg animate-fade-in relative overflow-hidden"
            style={{ width: 808, height: 454, background: current.bg, boxShadow: '0 20px 40px rgba(15, 23, 42, 0.12)', transform: `scale(${zoom / 100})`, transformOrigin: 'center', flexShrink: 0 }}>
            <div className="absolute inset-0 flex flex-col p-6 sm:p-10 md:p-14 relative" onMouseDown={() => setSelectedEl(null)}>
              {/* 文字内容 */}
              {current.layout === 'title' && (
                <div className="flex-1 flex flex-col justify-center items-center text-center relative z-10">
                  <input value={current.title} onChange={e => updateActive({ title: e.target.value })} className="text-2xl sm:text-3xl md:text-4xl font-bold text-center outline-none bg-transparent w-full" style={{ letterSpacing: '-0.02em', color: isDark ? '#f1f5f9' : '#0f172a' }} placeholder={t('slide.placeholder.title')} />
                  <input value={current.content} onChange={e => updateActive({ content: e.target.value })} className="text-sm sm:text-base md:text-lg text-center mt-3 outline-none bg-transparent w-full" style={{ color: isDark ? '#cbd5e1' : '#64748b' }} placeholder={t('slide.placeholder.subtitle')} />
                </div>
              )}
              {current.layout === 'content' && (
                <>
                  <input value={current.title} onChange={e => updateActive({ title: e.target.value })} className="text-xl sm:text-2xl font-bold mb-4 outline-none bg-transparent relative z-10" style={{ color: isDark ? '#f1f5f9' : '#0f172a' }} placeholder={t('slide.placeholder.title')} />
                  <div className="w-12 h-1 rounded mb-4" style={{ background: 'var(--color-primary)' }}></div>
                  <textarea value={current.content} onChange={e => updateActive({ content: e.target.value })} className="flex-1 text-sm sm:text-base outline-none bg-transparent resize-none leading-relaxed relative z-10" style={{ color: isDark ? '#cbd5e1' : '#334155' }} placeholder={t('slide.placeholder.content')} />
                </>
              )}
              {current.layout === 'blank' && (
                <textarea value={current.content} onChange={e => updateActive({ content: e.target.value })} className="flex-1 text-sm outline-none bg-transparent resize-none relative z-10" style={{ color: isDark ? '#f1f5f9' : '#334155' }} placeholder={t('slide.placeholder.blank')} />
              )}

              {/* 形状渲染层 — zIndex 20 > 文字内容 z-10，确保形状可点击选中/拖拽 */}
              {current.shapes.map((sh, i) => (
                <div key={i} className="absolute flex items-center justify-center group cursor-move"
                  onMouseDown={(e) => { if (editing?.type === 'shape' && editing?.index === i) return; e.stopPropagation(); setSelectedEl({ type: 'shape', index: i }); recordHistory(slides); setDragInfo({ startX: e.clientX, startY: e.clientY, origX: sh.x, origY: sh.y, mode: 'move' }) }}
                  onDoubleClick={(e) => { e.stopPropagation(); startEdit('shape', i) }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedEl({ type: 'shape', index: i }); setContextMenu({ x: e.clientX, y: e.clientY, type: 'shape', index: i }) }}
                  style={{
                    left: `${sh.x / 8}px`, top: `${sh.y / 8}px`, width: `${sh.w / 8}px`, height: `${sh.h / 8}px`,
                    transform: sh.rotation ? `rotate(${sh.rotation}deg)` : '',
                    zIndex: 20,
                    outline: selectedEl?.type === 'shape' && selectedEl?.index === i ? '2px solid var(--color-primary)' : 'none',
                    outlineOffset: '2px',
                  }}>
                  {/* 形状内容层 — clip-path 只作用于形状本身，不影响手柄 */}
                  <div className="absolute inset-0 flex flex-col" style={{
                    justifyContent: sh.vAlign === 'top' ? 'flex-start' : sh.vAlign === 'bottom' ? 'flex-end' : 'center',
                    background: sh.gradient ? `linear-gradient(135deg, #${sh.gradient.split(',')[0]}, #${sh.gradient.split(',')[1]})` : sh.fill,
                    backgroundSize: sh.fill.startsWith('url') ? 'cover' : undefined,
                    backgroundRepeat: sh.fill.startsWith('url') ? 'no-repeat' : undefined,
                    backgroundPosition: sh.fill.startsWith('url') ? 'center' : undefined,
                    borderRadius: sh.type === 'roundRect' ? '8px' : sh.type === 'ellipse' ? '50%' : '0',
                    clipPath: sh.type === 'triangle' ? 'polygon(50% 0, 100% 100%, 0 100%)' :
                             sh.type === 'diamond' ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' :
                             sh.type === 'rightArrow' ? 'polygon(0 30%, 60% 30%, 60% 0, 100% 50%, 60% 100%, 60% 70%, 0 70%)' :
                             sh.type === 'star5' ? 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' :
                             sh.type === 'hexagon' ? 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)' :
                             sh.type === 'pentagon' ? 'polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)' :
                             sh.type === 'heart' ? 'path("M50 90 L10 50 A20 20 0 0 1 50 30 A20 20 0 0 1 90 50 Z")' :
                             sh.type === 'cloud' ? 'ellipse(50% 50% at 50% 50%)' :
                             sh.type === 'callout' ? 'polygon(0 0, 100% 0, 100% 70%, 60% 70%, 50% 100%, 40% 70%, 0 70%)' :
                             undefined,
                    boxShadow: sh.shadow ? '0 4px 12px rgba(0,0,0,0.2)' : 'none',
                    filter: sh.glow ? `drop-shadow(0 0 8px ${sh.fill})` : 'none',
                    border: sh.type === 'rect' || sh.type === 'roundRect' ? '1px solid rgba(0,0,0,0.1)' : 'none',
                    color: sh.fontColor || (sh.fill && !sh.fill.startsWith('url') ? '#ffffff' : '#1f2937'),
                    fontSize: sh.fontSize ? `${sh.fontSize}px` : '12px',
                    fontWeight: sh.fontBold ? 700 : 400,
                    textAlign: sh.textAlign || 'center',
                    lineHeight: sh.lineHeight || 1.2,
                    paddingLeft: sh.indent ? `${sh.indent * 12}px` : undefined,
                    width: '100%',
                    display: 'block',
                  }}>
                    {sh.media && sh.media.type === 'video' && (
                      <video src={sh.media.src} controls style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000', pointerEvents: 'none' }} />
                    )}
                    {sh.media && sh.media.type === 'audio' && (
                      <div className="w-full h-full flex items-center px-2"><audio src={sh.media.src} controls style={{ width: '100%', pointerEvents: 'none' }} /></div>
                    )}
                    {editing?.type === 'shape' && editing?.index === i ? (
                      <textarea ref={editAreaRef} defaultValue={sh.text} onBlur={commitEdit} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); commitEdit() } }} className="w-full h-full outline-none bg-transparent resize-none" style={{ color: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', textAlign: (sh.textAlign || 'center') as any, lineHeight: 'inherit', background: 'rgba(255,255,255,0.15)', padding: 2 }} />
                    ) : sh.text && !(sh.media && (sh.media.type === 'video' || sh.media.type === 'audio')) && (<span style={{ pointerEvents: 'none', display: 'block', textShadow: sh.fill && !sh.fill.startsWith('url') ? '0 1px 2px rgba(0,0,0,0.3)' : 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {sh.bullet
                        ? sh.text.split('\n').map((line, li) => <div key={li} style={{ display: 'flex', gap: 6 }}><span>•</span><span style={{ flex: 1 }}>{line || ' '}</span></div>)
                        : sh.numbered
                        ? sh.text.split('\n').map((line, li) => <div key={li} style={{ display: 'flex', gap: 6 }}><span>{li + 1}.</span><span style={{ flex: 1 }}>{line || ' '}</span></div>)
                        : sh.text}
                    </span>)}
                  </div>
                  <button onClick={() => removeShape(i)} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-rose-500 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center">×</button>
                  {selectedEl?.type === 'shape' && selectedEl?.index === i && <>
                    <div onMouseDown={(e) => { e.stopPropagation(); recordHistory(slides); setDragInfo({ startX: e.clientX, startY: e.clientY, origX: sh.w, origY: sh.h, mode: 'resize' }) }} className="absolute -bottom-1 -right-1 w-3 h-3 bg-white border-2 rounded-full cursor-se-resize" style={{ borderColor: 'var(--color-primary)', zIndex: 22 }} />
                    <div onMouseDown={(e) => { e.stopPropagation(); recordHistory(slides); setDragInfo({ startX: e.clientX, startY: e.clientY, origX: sh.rotation || 0, origY: 0, mode: 'rotate' }) }} className="absolute -top-6 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 rounded-full cursor-grab" style={{ borderColor: 'var(--color-primary)', zIndex: 22 }} />
                  </>}
                </div>
              ))}

              {/* 艺术字渲染层 — zIndex 21 > 文字内容 z-10 */}
              {current.artTexts.map((at, i) => (
                <div key={i} className="absolute group cursor-move" onMouseDown={(e) => { if (editing?.type === 'art' && editing?.index === i) return; e.stopPropagation(); setSelectedEl({ type: 'art', index: i }); recordHistory(slides); setDragInfo({ startX: e.clientX, startY: e.clientY, origX: at.x, origY: at.y, mode: 'move' }) }} onDoubleClick={(e) => { e.stopPropagation(); startEdit('art', i) }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setSelectedEl({ type: 'art', index: i }); setContextMenu({ x: e.clientX, y: e.clientY, type: 'art', index: i }) }} style={{ left: `${at.x / 8}px`, top: `${at.y / 8}px`, transform: at.rotation ? `rotate(${at.rotation}deg)` : '', zIndex: 21, outline: selectedEl?.type === 'art' && selectedEl?.index === i ? '2px solid var(--color-primary)' : 'none', outlineOffset: '4px' }}>
                  {editing?.type === 'art' && editing?.index === i ? (
                    <textarea ref={editAreaRef} defaultValue={at.text} onBlur={commitEdit} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); commitEdit() } }} className="outline-none bg-transparent resize-none" style={{ fontSize: `${at.fontSize / 2.5}px`, fontWeight: 700, color: at.color, textAlign: 'center', background: 'rgba(255,255,255,0.15)', padding: 2, minWidth: 80 }} />
                  ) : (
                  <span style={{
                    fontSize: `${at.fontSize / 2.5}px`, fontWeight: 700,
                    color: at.color,
                    background: at.gradient ? `linear-gradient(135deg, #${at.gradient.split(',')[0]}, #${at.gradient.split(',')[1]})` : undefined,
                    WebkitBackgroundClip: at.gradient ? 'text' : undefined,
                    WebkitTextFillColor: at.gradient ? 'transparent' : undefined,
                    textShadow: at.shadow ? '2px 2px 6px rgba(0,0,0,0.3)' : 'none',
                    filter: at.glow ? `drop-shadow(0 0 6px ${at.color})` : 'none',
                    WebkitTextStroke: at.outline ? `1px #${at.outline}` : 'none',
                  }}>{at.text}</span>
                  )}
                  <button onClick={() => removeArtText(i)} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-rose-500 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center">×</button>
                  {selectedEl?.type === 'art' && selectedEl?.index === i && <div onMouseDown={(e) => { e.stopPropagation(); recordHistory(slides); setDragInfo({ startX: e.clientX, startY: e.clientY, origX: at.rotation || 0, origY: 0, mode: 'rotate' }) }} className="absolute -top-6 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 rounded-full cursor-grab" style={{ borderColor: 'var(--color-primary)' }} />}
                </div>
              ))}

              {/* 动画指示器 */}
              {current.animations.length > 0 && (
                <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]" style={{ background: 'rgba(79,70,229,0.1)', color: 'var(--color-primary)' }}>
                  ✨ {current.animations.length}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="px-3 py-1.5 text-xs flex items-center gap-3 flex-shrink-0" style={{ background: 'var(--color-surface)', borderTop: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>{t('slide.ready')}</span>
        <div className="flex-1" />
        <span>{t('slide.slideNum')} #{active + 1} / {slides.length}</span>
        {current.shapes.length > 0 && <span>📊 {t('slide.shapesCount')} {current.shapes.length}</span>}
        {current.animations.length > 0 && <span>✨ {t('slide.animsCount')} {current.animations.length}</span>}
        {current.transition && <span style={{ color: 'var(--color-primary)' }}>{t('slide.transitionLabel')}{TRANSITIONS.find(t => t.id === current.transition)?.name}</span>}
        {current.notes && <span>📝 {t('slide.notes')}</span>}
        {autoPlay && <span style={{ color: 'var(--color-primary)' }}>⏱ {t('slide.auto')} {autoPlaySec}s</span>}
        <button onClick={startPresent} className="btn btn-primary btn-sm">▶ {t('slide.play')}</button>
      </div>

      {/* 元素右键上下文菜单 — 对标 MS PPT（复制/剪切/粘贴、叠放层次等） */}
      {contextMenu && (
        <div className="fixed z-[100]" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="min-w-[180px] py-1 rounded-md shadow-lg border text-sm" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <MenuItem label={t('slide.editText')} icon="✎" onClick={() => { startEdit(contextMenu.type, contextMenu.index); setContextMenu(null) }} />
            <div className="my-1 h-px" style={{ background: 'var(--color-border)' }} />
            <MenuItem label={t('slide.cut')} icon="✂" onClick={() => { cutSelected(); setContextMenu(null) }} />
            <MenuItem label={t('slide.copy')} icon="⧉" onClick={() => { copySelected(); setContextMenu(null) }} />
            <MenuItem label={t('slide.paste')} icon="📋" disabled={!clipboardRef.current} onClick={() => { pasteClipboard(); setContextMenu(null) }} />
            <div className="my-1 h-px" style={{ background: 'var(--color-border)' }} />
            <div className="px-3 py-1 text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{t('slide.layer')}</div>
            <MenuItem label={t('slide.bringToFront')} icon="⤒" onClick={() => { if (contextMenu.type === 'shape') reorderShape(contextMenu.index, 'front'); else reorderArt(contextMenu.index, 'front'); setContextMenu(null) }} />
            <MenuItem label={t('slide.bringForward')} icon="↑" onClick={() => { if (contextMenu.type === 'shape') reorderShape(contextMenu.index, 'forward'); else reorderArt(contextMenu.index, 'forward'); setContextMenu(null) }} />
            <MenuItem label={t('slide.sendBackward')} icon="↓" onClick={() => { if (contextMenu.type === 'shape') reorderShape(contextMenu.index, 'backward'); else reorderArt(contextMenu.index, 'backward'); setContextMenu(null) }} />
            <MenuItem label={t('slide.sendToBack')} icon="⤓" onClick={() => { if (contextMenu.type === 'shape') reorderShape(contextMenu.index, 'back'); else reorderArt(contextMenu.index, 'back'); setContextMenu(null) }} />
            <div className="my-1 h-px" style={{ background: 'var(--color-border)' }} />
            <MenuItem label={t('slide.delete')} icon="🗑" danger onClick={() => { if (contextMenu.type === 'shape') removeShape(contextMenu.index); else removeArtText(contextMenu.index); setContextMenu(null); setSelectedEl(null) }} />
          </div>
        </div>
      )}

      {/* 全屏放映模式 */}
      {presenting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: '#000' }} onClick={nextPresent}>
          <div style={{ transform: `scale(${Math.min(window.innerWidth / 808, window.innerHeight / 454)})`, transformOrigin: 'center' }}>
          <div key={presentSlide} className={`relative overflow-hidden sl-trans-${presentingSlide.transition || 'none'}`} style={{ width: 808, height: 454, background: presentingSlide.bg }}>
            <div className="absolute inset-0 flex flex-col justify-center items-center p-12 text-center">
              <h1 className="text-5xl font-bold mb-6" style={{ color: (presentingSlide.bg === '#1e293b' || presentingSlide.bg === '#312e81') ? '#f1f5f9' : '#0f172a' }}>{presentingSlide.title}</h1>
              {presentingSlide.content && <p className="text-xl" style={{ color: (presentingSlide.bg === '#1e293b' || presentingSlide.bg === '#312e81') ? '#cbd5e1' : '#64748b' }}>{presentingSlide.content}</p>}
              {presentingSlide.shapes.map((sh, i) => {
                const ent = entranceAnimOf(presentingSlide)
                const entIdx = ent.findIndex(a => a.target === `shape_${i}`)
                const revealed = entIdx === -1 || entIdx < presentAnimStep
                const justRevealed = entIdx === presentAnimStep - 1
                const effect = entIdx >= 0 ? ent[entIdx].effect : ''
                const animClass = justRevealed ? `sl-anim-${effect}` : ''
                return (
                <div key={i} className={`absolute flex flex-col ${animClass}`} style={{
                  left: `${sh.x / 8}px`, top: `${sh.y / 8}px`, width: `${sh.w / 8}px`, height: `${sh.h / 8}px`,
                  justifyContent: sh.vAlign === 'top' ? 'flex-start' : sh.vAlign === 'bottom' ? 'flex-end' : 'center',
                  opacity: revealed ? undefined : 0,
                  background: sh.gradient ? `linear-gradient(135deg, #${sh.gradient.split(',')[0]}, #${sh.gradient.split(',')[1]})` : sh.fill,
                  borderRadius: sh.type === 'roundRect' ? '8px' : sh.type === 'ellipse' ? '50%' : '0',
                  clipPath: sh.type === 'triangle' ? 'polygon(50% 0, 100% 100%, 0 100%)' : sh.type === 'diamond' ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' : sh.type === 'rightArrow' ? 'polygon(0 30%, 60% 30%, 60% 0, 100% 50%, 60% 100%, 60% 70%, 0 70%)' : sh.type === 'star5' ? 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' : undefined,
                  boxShadow: sh.shadow ? '0 4px 12px rgba(0,0,0,0.2)' : 'none', color: sh.fontColor || (sh.fill && !sh.fill.startsWith('url') ? '#fff' : '#1f2937'), fontSize: sh.fontSize ? `${sh.fontSize}px` : '18px', fontWeight: sh.fontBold ? 700 : 400, textAlign: sh.textAlign || 'center', lineHeight: sh.lineHeight || 1.2, paddingLeft: sh.indent ? `${sh.indent * 12}px` : undefined, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>{sh.media && sh.media.type === 'video' && (
                  <video src={sh.media.src} controls autoPlay={false} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
                )}
                {sh.media && sh.media.type === 'audio' && (
                  <div className="w-full h-full flex items-center px-2"><audio src={sh.media.src} controls style={{ width: '100%' }} /></div>
                )}
                {!sh.media && (sh.bullet
                  ? sh.text.split('\n').map((line, li) => <div key={li} style={{ display: 'flex', gap: 6 }}><span>•</span><span style={{ flex: 1 }}>{line || ' '}</span></div>)
                  : sh.numbered
                  ? sh.text.split('\n').map((line, li) => <div key={li} style={{ display: 'flex', gap: 6 }}><span>{li + 1}.</span><span style={{ flex: 1 }}>{line || ' '}</span></div>)
                  : sh.text)}</div>
                )
              })}
              {presentingSlide.artTexts.map((at, i) => (
                <div key={i} className="absolute" style={{ left: `${at.x / 8}px`, top: `${at.y / 8}px`, transform: at.rotation ? `rotate(${at.rotation}deg)` : '' }}>
                  <span style={{ fontSize: `${at.fontSize / 2}px`, fontWeight: 700, color: at.color, textShadow: at.shadow ? '2px 2px 6px rgba(0,0,0,0.3)' : 'none' }}>{at.text}</span>
                </div>
              ))}
            </div>
            {/* 放映控制栏 */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <button onClick={e => { e.stopPropagation(); prevPresent() }} className="text-white text-sm px-2" disabled={presentSlide === 0}>←</button>
              <span className="text-white text-xs">{presentSlide + 1} / {slides.length}</span>
              <button onClick={e => { e.stopPropagation(); nextPresent() }} className="text-white text-sm px-2" disabled={presentSlide === slides.length - 1}>→</button>
              <button onClick={e => { e.stopPropagation(); setPresenting(false) }} className="text-white text-sm px-2">✕</button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
