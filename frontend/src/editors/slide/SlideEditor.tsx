import { useState, useMemo, memo } from 'react'
import { useI18n } from '../../i18n'

interface Slide {
  id: number; title: string; content: string; bg: string
  layout: 'title' | 'content' | 'blank'
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
  glowColor?: string; glowRadius?: number
}

interface ArtTextItem {
  text: string; x: number; y: number; w: number; h: number
  fontSize: number; color: string; gradient: string
  shadow: boolean; glow: boolean; outline: string; rotation: number
}

interface AnimItem {
  target: string; effect: string; category: string; delay: number
}

type RibbonTab = 'home' | 'insert' | 'design' | 'modern' | 'animations' | 'transition' | 'view'

function RibbonButton({ icon, label, onClick, active, disabled, title }: any) {
  return (
    <button onClick={onClick} disabled={disabled} title={title || label}
      className="flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded-md transition-colors min-w-[48px] disabled:opacity-40"
      style={{ background: active ? 'var(--color-primary-light)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
      onMouseEnter={e => { if (!disabled && !active) e.currentTarget.style.background = 'var(--color-bg-alt)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
      <span style={{ fontSize: '16px', lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: '10px', fontWeight: 500 }}>{label}</span>
    </button>
  )
}
function RibbonGroup({ label, children }: any) {
  return (
    <div className="flex flex-col items-center px-2 border-r" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-0.5 py-1 flex-1">{children}</div>
      <div className="text-[10px] font-medium pb-0.5" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
    </div>
  )
}

export function SlideEditor() {
  const { t } = useI18n()

  // 仅在 t 变化时重建 (perf: 避免每次渲染重建静态数组)
  const LAYOUTS = useMemo(() => LAYOUT_DEFS.map(l => ({ ...l, name: t(`slide.layout.${l.id}`) })), [t])
  const PRESET_COLORS = useMemo(() => PRESET_COLOR_DEFS.map((v, i) => ({ value: v, name: t(['color.white','color.lightGray','color.beige','color.skyBlue','color.mint','color.pink','color.darkGray','color.indigo'][i]) })), [t])
  const TRANSITIONS = useMemo(() => TRANSITION_DEFS.map(id => ({ id, name: id === '' ? t('transition.none') : t(`transition.${id === 'cut' ? 'switch' : id}`) })), [t])
  const SHAPES = useMemo(() => SHAPE_DEFS.map(s => ({ ...s, name: t(`slide.shape.${s.type === 'roundRect' ? 'rounded' : s.type === 'rightArrow' ? 'arrow' : s.type === 'star5' ? 'star' : s.type}`) })), [t])
  const ENTRANCE_ANIMS = useMemo(() => ENTRANCE_ANIM_DEFS.map(e => ({ effect: e, name: e === 'fade' ? t('anim.fadeIn') : e === 'fly' ? t('anim.flyIn') : e === 'zoom' ? t('anim.zoom') : e === 'wipe' ? t('anim.wipe') : t('anim.bounce') })), [t])
  const EMPHASIS_ANIMS = useMemo(() => EMPHASIS_ANIM_DEFS.map(e => ({ effect: e, name: e === 'pulse' ? t('anim.pulse') : t('anim.spin') })), [t])
  const EXIT_ANIMS = useMemo(() => EXIT_ANIM_DEFS.map((e, i) => ({ effect: e, name: e === 'fade' ? t('anim.fadeOut') : e === 'fly' ? t('anim.flyOut') : t('anim.shrink') })), [t])
  const ART_PRESETS = useMemo(() => ART_PRESET_DEFS.map((p, i) => ({ name: t(['art.purple','art.blue','art.green','art.orange','art.red','art.white'][i]), color: p.color, gradient: (p as any).gradient || '', shadow: !!(p as any).shadow, glow: !!(p as any).glow, outline: (p as any).outline || '' })), [t])

  const [slides, setSlides] = useState<Slide[]>([
    { id: 1, title: t('slide.titleDefault'), content: t('slide.subtitleDefault'), bg: '#ffffff', layout: 'title', transition: 'fade', notes: '', shapes: [], artTexts: [], animations: [] },
    { id: 2, title: t('slide.contentSlide'), content: t('slide.contentPlaceholder'), bg: '#ffffff', layout: 'content', transition: '', notes: '', shapes: [], artTexts: [], animations: [] },
  ])
  const [active, setActive] = useState(0)
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home')
  const [zoom, setZoom] = useState(100)
  const [autoPlay, setAutoPlay] = useState(false)
  const [autoPlaySec, setAutoPlaySec] = useState(5)
  const [presenting, setPresenting] = useState(false)
  const [presentSlide, setPresentSlide] = useState(0)
  const [showShapePanel, setShowShapePanel] = useState(false)
  const [showAnimPanel, setShowAnimPanel] = useState(false)
  const [showArtPanel, setShowArtPanel] = useState(false)

  const addSlide = () => { setSlides(s => [...s, { id: Date.now(), title: t('slide.slideN', { n: s.length + 1 }), content: t('slide.addContentHere'), bg: '#ffffff', layout: 'content', transition: '', notes: '', shapes: [], artTexts: [], animations: [] }]); setActive(slides.length) }
  const deleteSlide = (idx: number) => { if (slides.length <= 1) return; setSlides(s => s.filter((_, i) => i !== idx)); if (active >= idx && active > 0) setActive(active - 1) }
  const duplicateSlide = (idx: number) => { setSlides(s => { const copy = { ...s[idx], id: Date.now() }; const next = [...s]; next.splice(idx + 1, 0, copy); return next }); setActive(idx + 1) }
  const updateActive = (patch: Partial<Slide>) => setSlides(s => s.map((sl, i) => i === active ? { ...sl, ...patch } : sl))
  const switchSlide = (i: number) => { if (i === active) return; setActive(i) }
  const current = slides[active] || slides[0]
  const isDark = current.bg === '#1e293b' || current.bg === '#312e81'

  // 形状操作
  const addShape = (type: string) => {
    const newShape: ShapeItem = { type, x: 200 + Math.random()*100, y: 200 + Math.random()*100, w: 200, h: 120, fill: '#4f46e5', text: '', shadow: false, glow: false, gradient: '', rotation: 0 }
    updateActive({ shapes: [...current.shapes, newShape] })
    setShowShapePanel(false)
  }
  const removeShape = (idx: number) => { updateActive({ shapes: current.shapes.filter((_, i) => i !== idx) }) }
  const updateShape = (idx: number, patch: Partial<ShapeItem>) => {
    const newShapes = current.shapes.map((s, i) => i === idx ? { ...s, ...patch } : s)
    updateActive({ shapes: newShapes })
  }

  // 艺术字操作
  const addArtText = (preset: any) => {
    const text = prompt(t('slide.prompt.wordArt'), 'GoOffice')
    if (!text) return
    const newArt: ArtTextItem = {
      text, x: 100, y: 100, w: 400, h: 80,
      fontSize: 36, color: preset.color, gradient: preset.gradient || '',
      shadow: preset.shadow || false, glow: preset.glow || false, outline: preset.outline || '', rotation: 0,
    }
    updateActive({ artTexts: [...current.artTexts, newArt] })
    setShowArtPanel(false)
  }
  const removeArtText = (idx: number) => { updateActive({ artTexts: current.artTexts.filter((_, i) => i !== idx) }) }

  // 动画操作
  const addAnimation = (effect: string, category: string) => {
    const target = `shape_${current.shapes.length}` // 简化：指向最后一个形状
    const newAnim: AnimItem = { target, effect, category, delay: current.animations.length * 300 }
    updateActive({ animations: [...current.animations, newAnim] })
    setShowAnimPanel(false)
  }
  const removeAnimation = (idx: number) => { updateActive({ animations: current.animations.filter((_, i) => i !== idx) }) }

  // 放映控制
  const startPresent = () => { setPresenting(true); setPresentSlide(active) }
  const nextPresent = () => { if (presentSlide < slides.length - 1) setPresentSlide(presentSlide + 1); else setPresenting(false) }
  const prevPresent = () => { if (presentSlide > 0) setPresentSlide(presentSlide - 1) }

  const ribbonTabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: t('slide.ribbon.home') }, { id: 'insert', label: t('slide.ribbon.insert') }, { id: 'design', label: t('slide.ribbon.design') },
    { id: 'modern', label: 'Modern' }, { id: 'animations', label: t('slide.ribbon.animation') }, { id: 'transition', label: t('slide.ribbon.transition') }, { id: 'view', label: t('slide.ribbon.view') },
  ]

  const presentingSlide = slides[presentSlide] || slides[0]

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-alt)' }}>
      {/* Ribbon Tab 栏 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {ribbonTabs.map(t => (
          <button key={t.id} onClick={() => setRibbonTab(t.id)} data-testid={`ribbon-tab-${t.id}`} className="px-4 py-2 text-sm font-medium transition-colors"
            style={{ color: ribbonTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === t.id ? 'var(--color-primary-50)' : 'transparent' }}>{t.label}</button>
        ))}
        <div className="flex-1" />
        <span className="text-xs" data-testid="slide-page-indicator" style={{ color: 'var(--color-text-muted)' }}>{active + 1} / {slides.length}</span>
      </div>

      {/* Ribbon 内容区 */}
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b overflow-x-auto" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '64px' }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label={t('slide.slides')}>
            <RibbonButton icon="+" label={t('slide.new')} onClick={addSlide} />
            <RibbonButton icon="⎘" label={t('slide.copy')} onClick={() => duplicateSlide(active)} />
            <RibbonButton icon="✕" label={t('slide.delete')} onClick={() => deleteSlide(active)} disabled={slides.length <= 1} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.layoutGroup')}>
            {LAYOUTS.map(l => <RibbonButton key={l.id} icon={l.icon} label={l.name} onClick={() => updateActive({ layout: l.id as Slide['layout'] })} active={current.layout === l.id} />)}
          </RibbonGroup>
          <RibbonGroup label={t('slide.font')}>
            <RibbonButton icon="B" label={t('slide.bold')} onClick={() => {}} />
            <RibbonButton icon="🎨" label={t('slide.color')} onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.paragraph')}>
            <RibbonButton icon="⬅" label={t('slide.alignLeft')} onClick={() => {}} />
            <RibbonButton icon="⬌" label={t('slide.alignCenter')} onClick={() => {}} />
            <RibbonButton icon="➡" label={t('slide.alignRight')} onClick={() => {}} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'insert' && (<>
          <RibbonGroup label={t('slide.shapes')}>
            <div className="relative">
              <RibbonButton icon="▭" label={t('slide.shapes')} onClick={() => setShowShapePanel(!showShapePanel)} />
              {showShapePanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
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
              <RibbonButton icon="🎨" label={t('slide.wordArt')} onClick={() => setShowArtPanel(!showArtPanel)} />
              {showArtPanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
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
            <RibbonButton icon="🖼" label={t('slide.image')} onClick={() => {}} />
            <RibbonButton icon="📊" label={t('slide.chart')} onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.flowchart')}>
            <RibbonButton icon="🔀" label={t('slide.flowchart')} onClick={() => {
              const newShapes: ShapeItem[] = [
                { type: 'roundRect', x: 100, y: 200, w: 160, h: 60, fill: '#4f46e5', text: t('slide.flow.start'), shadow: true, glow: false, gradient: '', rotation: 0 },
                { type: 'rect', x: 320, y: 200, w: 160, h: 60, fill: '#10b981', text: t('slide.flow.process'), shadow: true, glow: false, gradient: '', rotation: 0 },
                { type: 'diamond', x: 540, y: 200, w: 160, h: 60, fill: '#f59e0b', text: t('slide.flow.decision'), shadow: true, glow: false, gradient: '', rotation: 0 },
                { type: 'roundRect', x: 760, y: 200, w: 160, h: 60, fill: '#ef4444', text: t('slide.flow.end'), shadow: true, glow: false, gradient: '', rotation: 0 },
              ]
              updateActive({ shapes: [...current.shapes, ...newShapes] })
            }} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.link')}>
            <RibbonButton icon="🔗" label={t('slide.hyperlink')} onClick={() => {}} />
            <RibbonButton icon="⚓" label={t('slide.bookmark')} onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label={t('slide.text')}>
            <RibbonButton icon="📝" label={t('slide.footnote')} onClick={() => { const n = prompt(t('slide.prompt.notes'), current.notes); if (n !== null) updateActive({ notes: n }) }} active={!!current.notes} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'design' && (<>
          <RibbonGroup label={t('slide.background')}>
            <div className="flex items-center gap-1 px-2">
              {PRESET_COLORS.map(c => (
                <button key={c.value} onClick={() => updateActive({ bg: c.value })} className="w-7 h-7 rounded-md border-2 transition-transform hover:scale-110"
                  style={{ background: c.value, borderColor: current.bg === c.value ? 'var(--color-primary)' : 'var(--color-border)' }} title={c.name} />
              ))}
            </div>
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
              <RibbonButton icon="➡" label={t('slide.enter')} onClick={() => setShowAnimPanel(!showAnimPanel)} />
              {showAnimPanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
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
              <select value={autoPlaySec} onChange={e => setAutoPlaySec(parseInt(e.target.value))} className="text-xs rounded-md px-2 py-1" style={{ width: 50, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                <option value={3}>3s</option><option value={5}>5s</option><option value={10}>10s</option><option value={15}>15s</option>
              </select>
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
        </>)}
      </div>

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
          <div className="bg-white shadow-xl rounded-lg w-full animate-fade-in relative"
            style={{ aspectRatio: '16 / 9', background: current.bg, maxWidth: '900px', boxShadow: '0 20px 40px rgba(15, 23, 42, 0.12)', zoom: `${zoom}%` }}>
            <div className="h-full flex flex-col p-6 sm:p-10 md:p-14 relative overflow-hidden">
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

              {/* 形状渲染层 */}
              {current.shapes.map((sh, i) => (
                <div key={i} className="absolute flex items-center justify-center group"
                  style={{
                    left: `${sh.x / 8}px`, top: `${sh.y / 4.5}px`, width: `${sh.w / 8}px`, height: `${sh.h / 4.5}px`,
                    transform: sh.rotation ? `rotate(${sh.rotation}deg)` : '',
                    background: sh.gradient ? `linear-gradient(135deg, #${sh.gradient.split(',')[0]}, #${sh.gradient.split(',')[1]})` : sh.fill,
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
                    color: '#ffffff', fontSize: '12px', fontWeight: 600, zIndex: 5,
                  }}>
                  {sh.text && <span style={{ pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}>{sh.text}</span>}
                  <button onClick={() => removeShape(i)} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-rose-500 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center">×</button>
                </div>
              ))}

              {/* 艺术字渲染层 */}
              {current.artTexts.map((at, i) => (
                <div key={i} className="absolute group" style={{ left: `${at.x / 8}px`, top: `${at.y / 4.5}px`, transform: at.rotation ? `rotate(${at.rotation}deg)` : '', zIndex: 6 }}>
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
                  <button onClick={() => removeArtText(i)} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-rose-500 text-white text-xs opacity-0 group-hover:opacity-100 flex items-center justify-center">×</button>
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

      {/* 全屏放映模式 */}
      {presenting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: '#000' }} onClick={nextPresent}>
          <div className="w-full h-full relative" style={{ background: presentingSlide.bg, maxWidth: '100vw', maxHeight: '100vh', aspectRatio: '16/9' }}>
            <div className="h-full flex flex-col justify-center items-center p-12 text-center">
              <h1 className="text-5xl font-bold mb-6" style={{ color: (presentingSlide.bg === '#1e293b' || presentingSlide.bg === '#312e81') ? '#f1f5f9' : '#0f172a' }}>{presentingSlide.title}</h1>
              {presentingSlide.content && <p className="text-xl" style={{ color: (presentingSlide.bg === '#1e293b' || presentingSlide.bg === '#312e81') ? '#cbd5e1' : '#64748b' }}>{presentingSlide.content}</p>}
              {presentingSlide.shapes.map((sh, i) => (
                <div key={i} className="absolute flex items-center justify-center" style={{
                  left: `${sh.x / 8 * 2}px`, top: `${sh.y / 4.5 * 2}px`, width: `${sh.w / 8 * 2}px`, height: `${sh.h / 4.5 * 2}px`,
                  background: sh.gradient ? `linear-gradient(135deg, #${sh.gradient.split(',')[0]}, #${sh.gradient.split(',')[1]})` : sh.fill,
                  borderRadius: sh.type === 'roundRect' ? '8px' : sh.type === 'ellipse' ? '50%' : '0',
                  clipPath: sh.type === 'triangle' ? 'polygon(50% 0, 100% 100%, 0 100%)' : sh.type === 'diamond' ? 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' : sh.type === 'rightArrow' ? 'polygon(0 30%, 60% 30%, 60% 0, 100% 50%, 60% 100%, 60% 70%, 0 70%)' : sh.type === 'star5' ? 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' : undefined,
                  boxShadow: sh.shadow ? '0 4px 12px rgba(0,0,0,0.2)' : 'none', color: '#fff', fontSize: '18px', fontWeight: 600,
                }}>{sh.text}</div>
              ))}
              {presentingSlide.artTexts.map((at, i) => (
                <div key={i} className="absolute" style={{ left: `${at.x / 8 * 2}px`, top: `${at.y / 4.5 * 2}px`, transform: at.rotation ? `rotate(${at.rotation}deg)` : '' }}>
                  <span style={{ fontSize: `${at.fontSize}px`, fontWeight: 700, color: at.color, textShadow: at.shadow ? '2px 2px 6px rgba(0,0,0,0.3)' : 'none' }}>{at.text}</span>
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
      )}
    </div>
  )
}
