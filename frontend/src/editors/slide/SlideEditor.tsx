import { useState } from 'react'

interface Slide {
  id: number; title: string; content: string; bg: string
  layout: 'title' | 'content' | 'blank'
  transition: string; notes: string
  shapes: ShapeItem[]; artTexts: ArtTextItem[]
  animations: AnimItem[]
}

interface ShapeItem {
  type: string; x: number; y: number; w: number; h: number
  fill: string; text: string; shadow: boolean; glow: boolean
  gradient: string; rotation: number
}

interface ArtTextItem {
  text: string; x: number; y: number; w: number; h: number
  fontSize: number; color: string; gradient: string
  shadow: boolean; glow: boolean; outline: string; rotation: number
}

interface AnimItem {
  target: string; effect: string; category: string; delay: number
}

type RibbonTab = 'home' | 'insert' | 'design' | 'animations' | 'transition' | 'view'

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

const LAYOUTS = [
  { id: 'title', name: '标题', icon: '🎯' }, { id: 'content', name: '内容', icon: '📝' }, { id: 'blank', name: '空白', icon: '⬜' },
] as const

const PRESET_COLORS = [
  { name: '白', value: '#ffffff' }, { name: '浅灰', value: '#f8fafc' }, { name: '米黄', value: '#fef3c7' },
  { name: '天蓝', value: '#dbeafe' }, { name: '薄荷', value: '#dcfce7' }, { name: '粉红', value: '#fce7f3' },
  { name: '深灰', value: '#1e293b' }, { name: '靛蓝', value: '#312e81' },
]

const TRANSITIONS = [
  { id: '', name: '无' }, { id: 'fade', name: '淡入' }, { id: 'push', name: '推入' },
  { id: 'wipe', name: '擦除' }, { id: 'cover', name: '覆盖' }, { id: 'cut', name: '切换' },
  { id: 'zoom', name: '缩放' }, { id: 'morph', name: '变形' },
]

const SHAPES = [
  { type: 'rect', icon: '▭', name: '矩形' }, { type: 'roundRect', icon: '▢', name: '圆角' },
  { type: 'ellipse', icon: '⬭', name: '椭圆' }, { type: 'triangle', icon: '△', name: '三角' },
  { type: 'diamond', icon: '◇', name: '菱形' }, { type: 'rightArrow', icon: '→', name: '箭头' },
  { type: 'star5', icon: '★', name: '星形' }, { type: 'hexagon', icon: '⬡', name: '六边形' },
  { type: 'pentagon', icon: '⬠', name: '五边形' }, { type: 'heart', icon: '♥', name: '心形' },
  { type: 'cloud', icon: '☁', name: '云形' }, { type: 'callout', icon: '💬', name: '标注' },
]

const ENTRANCE_ANIMS = [
  { effect: 'fade', name: '淡入' }, { effect: 'fly', name: '飞入' },
  { effect: 'zoom', name: '缩放' }, { effect: 'wipe', name: '擦除' }, { effect: 'bounce', name: '弹跳' },
]
const EMPHASIS_ANIMS = [
  { effect: 'pulse', name: '脉冲' }, { effect: 'spin', name: '旋转' },
]
const EXIT_ANIMS = [
  { effect: 'fade', name: '淡出' }, { effect: 'fly', name: '飞出' }, { effect: 'zoom', name: '缩小' },
]

const ART_PRESETS = [
  { name: '渐变紫', color: '#4f46e5', gradient: '4f46e5,818cf8', shadow: true },
  { name: '描边蓝', color: '#3b82f6', outline: '1e40af', glow: true },
  { name: '发光绿', color: '#10b981', glow: true, gradient: '10b981,34d399' },
  { name: '阴影橙', color: '#f59e0b', shadow: true, gradient: 'f59e0b,fbbf24' },
  { name: '反射红', color: '#ef4444', shadow: true, outline: '991b1b' },
  { name: '纯白', color: '#ffffff', shadow: true },
]

export function SlideEditor() {
  const [slides, setSlides] = useState<Slide[]>([
    { id: 1, title: '演示文稿标题', content: '副标题或描述', bg: '#ffffff', layout: 'title', transition: 'fade', notes: '', shapes: [], artTexts: [], animations: [] },
    { id: 2, title: '内容幻灯片', content: '在此添加您的内容', bg: '#ffffff', layout: 'content', transition: '', notes: '', shapes: [], artTexts: [], animations: [] },
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

  const addSlide = () => { setSlides(s => [...s, { id: Date.now(), title: `幻灯片 ${s.length + 1}`, content: '在此添加内容', bg: '#ffffff', layout: 'content', transition: '', notes: '', shapes: [], artTexts: [], animations: [] }]); setActive(slides.length) }
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
    const text = prompt('艺术字内容：', 'GoOffice')
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
    { id: 'home', label: '开始' }, { id: 'insert', label: '插入' }, { id: 'design', label: '设计' },
    { id: 'animations', label: '动画' }, { id: 'transition', label: '切换' }, { id: 'view', label: '视图' },
  ]

  const presentingSlide = slides[presentSlide] || slides[0]

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-alt)' }}>
      {/* Ribbon Tab 栏 */}
      <div className="flex items-center px-2 flex-shrink-0 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        {ribbonTabs.map(t => (
          <button key={t.id} onClick={() => setRibbonTab(t.id)} className="px-4 py-2 text-sm font-medium transition-colors"
            style={{ color: ribbonTab === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)', borderBottom: ribbonTab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent', background: ribbonTab === t.id ? 'var(--color-primary-50)' : 'transparent' }}>{t.label}</button>
        ))}
        <div className="flex-1" />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{active + 1} / {slides.length}</span>
      </div>

      {/* Ribbon 内容区 */}
      <div className="flex items-stretch px-1 py-1 flex-shrink-0 border-b overflow-x-auto" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', minHeight: '64px' }}>
        {ribbonTab === 'home' && (<>
          <RibbonGroup label="幻灯片">
            <RibbonButton icon="+" label="新建" onClick={addSlide} />
            <RibbonButton icon="⎘" label="复制" onClick={() => duplicateSlide(active)} />
            <RibbonButton icon="✕" label="删除" onClick={() => deleteSlide(active)} disabled={slides.length <= 1} />
          </RibbonGroup>
          <RibbonGroup label="布局">
            {LAYOUTS.map(l => <RibbonButton key={l.id} icon={l.icon} label={l.name} onClick={() => updateActive({ layout: l.id as Slide['layout'] })} active={current.layout === l.id} />)}
          </RibbonGroup>
          <RibbonGroup label="字体">
            <RibbonButton icon="B" label="加粗" onClick={() => {}} />
            <RibbonButton icon="🎨" label="颜色" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="段落">
            <RibbonButton icon="⬅" label="左对齐" onClick={() => {}} />
            <RibbonButton icon="⬌" label="居中" onClick={() => {}} />
            <RibbonButton icon="➡" label="右对齐" onClick={() => {}} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'insert' && (<>
          <RibbonGroup label="形状">
            <div className="relative">
              <RibbonButton icon="▭" label="形状" onClick={() => setShowShapePanel(!showShapePanel)} />
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
          <RibbonGroup label="艺术字">
            <div className="relative">
              <RibbonButton icon="🎨" label="艺术字" onClick={() => setShowArtPanel(!showArtPanel)} />
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
          <RibbonGroup label="插图">
            <RibbonButton icon="🖼" label="图片" onClick={() => {}} />
            <RibbonButton icon="📊" label="图表" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="流程图">
            <RibbonButton icon="🔀" label="流程图" onClick={() => {
              const newShapes: ShapeItem[] = [
                { type: 'roundRect', x: 100, y: 200, w: 160, h: 60, fill: '#4f46e5', text: '开始', shadow: true, glow: false, gradient: '', rotation: 0 },
                { type: 'rect', x: 320, y: 200, w: 160, h: 60, fill: '#10b981', text: '处理', shadow: true, glow: false, gradient: '', rotation: 0 },
                { type: 'diamond', x: 540, y: 200, w: 160, h: 60, fill: '#f59e0b', text: '判断', shadow: true, glow: false, gradient: '', rotation: 0 },
                { type: 'roundRect', x: 760, y: 200, w: 160, h: 60, fill: '#ef4444', text: '结束', shadow: true, glow: false, gradient: '', rotation: 0 },
              ]
              updateActive({ shapes: [...current.shapes, ...newShapes] })
            }} />
          </RibbonGroup>
          <RibbonGroup label="链接">
            <RibbonButton icon="🔗" label="超链接" onClick={() => {}} />
            <RibbonButton icon="⚓" label="书签" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="文本">
            <RibbonButton icon="📝" label="脚注" onClick={() => { const n = prompt('备注：', current.notes); if (n !== null) updateActive({ notes: n }) }} active={!!current.notes} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'design' && (<>
          <RibbonGroup label="背景">
            <div className="flex items-center gap-1 px-2">
              {PRESET_COLORS.map(c => (
                <button key={c.value} onClick={() => updateActive({ bg: c.value })} className="w-7 h-7 rounded-md border-2 transition-transform hover:scale-110"
                  style={{ background: c.value, borderColor: current.bg === c.value ? 'var(--color-primary)' : 'var(--color-border)' }} title={c.name} />
              ))}
            </div>
          </RibbonGroup>
          <RibbonGroup label="形状样式">
            <RibbonButton icon="🌈" label="渐变填充" onClick={() => { if (current.shapes.length > 0) updateShape(current.shapes.length - 1, { gradient: '6366f1,818cf8' }) }} />
            <RibbonButton icon="💫" label="发光" onClick={() => { if (current.shapes.length > 0) updateShape(current.shapes.length - 1, { glow: !current.shapes[current.shapes.length-1].glow }) }} active={current.shapes.length > 0 && current.shapes[current.shapes.length-1].glow} />
            <RibbonButton icon="🌑" label="阴影" onClick={() => { if (current.shapes.length > 0) updateShape(current.shapes.length - 1, { shadow: !current.shapes[current.shapes.length-1].shadow }) }} active={current.shapes.length > 0 && current.shapes[current.shapes.length-1].shadow} />
            <RibbonButton icon="🔄" label="旋转" onClick={() => { if (current.shapes.length > 0) updateShape(current.shapes.length - 1, { rotation: (current.shapes[current.shapes.length-1].rotation + 15) % 360 }) }} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'animations' && (<>
          <RibbonGroup label="进入动画">
            <div className="relative">
              <RibbonButton icon="➡" label="进入" onClick={() => setShowAnimPanel(!showAnimPanel)} />
              {showAnimPanel && (
                <div className="absolute top-full left-0 z-30 p-3 rounded-lg shadow-xl animate-fade-in" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="text-[10px] font-bold uppercase mb-2" style={{ color: 'var(--color-text-muted)' }}>进入</div>
                  <div className="grid grid-cols-3 gap-1">
                    {ENTRANCE_ANIMS.map(a => <button key={a.effect} onClick={() => addAnimation(a.effect, 'entrance')} className="px-3 py-1.5 text-xs rounded-md transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{a.name}</button>)}
                  </div>
                  <div className="text-[10px] font-bold uppercase mt-3 mb-2" style={{ color: 'var(--color-text-muted)' }}>强调</div>
                  <div className="grid grid-cols-3 gap-1">
                    {EMPHASIS_ANIMS.map(a => <button key={a.effect} onClick={() => addAnimation(a.effect, 'emphasis')} className="px-3 py-1.5 text-xs rounded-md transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{a.name}</button>)}
                  </div>
                  <div className="text-[10px] font-bold uppercase mt-3 mb-2" style={{ color: 'var(--color-text-muted)' }}>退出</div>
                  <div className="grid grid-cols-3 gap-1">
                    {EXIT_ANIMS.map(a => <button key={a.effect} onClick={() => addAnimation(a.effect, 'exit')} className="px-3 py-1.5 text-xs rounded-md transition-colors hover:bg-slate-100" style={{ color: 'var(--color-text)' }}>{a.name}</button>)}
                  </div>
                </div>
              )}
            </div>
          </RibbonGroup>
          <RibbonGroup label="动画窗格">
            <div className="flex flex-col gap-0.5 max-h-[48px] overflow-y-auto">
              {current.animations.length === 0 ? (
                <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>无动画</span>
              ) : current.animations.map((a, i) => (
                <div key={i} className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                  <span style={{ color: a.category === 'entrance' ? '#10b981' : a.category === 'emphasis' ? '#f59e0b' : '#ef4444' }}>●</span>
                  <span>{a.effect}</span>
                  <button onClick={() => removeAnimation(i)} className="text-[8px] opacity-50 hover:opacity-100">✕</button>
                </div>
              ))}
            </div>
          </RibbonGroup>
          <RibbonGroup label="计时">
            <RibbonButton icon="⏱" label={autoPlay ? `自动${autoPlaySec}s` : '手动'} onClick={() => setAutoPlay(!autoPlay)} active={autoPlay} />
            {autoPlay && (
              <select value={autoPlaySec} onChange={e => setAutoPlaySec(parseInt(e.target.value))} className="text-xs rounded-md px-2 py-1" style={{ width: 50, background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                <option value={3}>3s</option><option value={5}>5s</option><option value={10}>10s</option><option value={15}>15s</option>
              </select>
            )}
          </RibbonGroup>
        </>)}

        {ribbonTab === 'transition' && (<>
          <RibbonGroup label="切换效果">
            <div className="flex items-center gap-1 px-2">
              {TRANSITIONS.map(t => (
                <button key={t.id} onClick={() => updateActive({ transition: t.id })} className="px-3 py-1.5 text-xs rounded-md transition-colors"
                  style={{ background: current.transition === t.id ? 'var(--color-primary-light)' : 'transparent', color: current.transition === t.id ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>{t.name}</button>
              ))}
            </div>
          </RibbonGroup>
          <RibbonGroup label="备注">
            <RibbonButton icon="📝" label="演讲者备注" onClick={() => { const n = prompt('备注：', current.notes); if (n !== null) updateActive({ notes: n }) }} active={!!current.notes} />
          </RibbonGroup>
        </>)}

        {ribbonTab === 'view' && (<>
          <RibbonGroup label="缩放">
            <RibbonButton icon="−" label="缩小" onClick={() => setZoom(Math.max(50, zoom - 25))} />
            <div className="flex flex-col items-center px-2"><span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)' }}>{zoom}%</span></div>
            <RibbonButton icon="+" label="放大" onClick={() => setZoom(Math.min(150, zoom + 25))} />
            <RibbonButton icon="▮" label="100%" onClick={() => setZoom(100)} />
          </RibbonGroup>
          <RibbonGroup label="导航">
            <RibbonButton icon="←" label="上一张" onClick={() => switchSlide(Math.max(0, active - 1))} disabled={active === 0} />
            <RibbonButton icon="→" label="下一张" onClick={() => switchSlide(Math.min(slides.length - 1, active + 1))} disabled={active === slides.length - 1} />
          </RibbonGroup>
          <RibbonGroup label="放映">
            <RibbonButton icon="▶" label="从头开始" onClick={() => { setActive(0); startPresent() }} />
            <RibbonButton icon="▶" label="从当前" onClick={startPresent} />
          </RibbonGroup>
        </>)}
      </div>

      {/* 主体 */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* 左侧缩略图 */}
        <div className="w-40 lg:w-48 flex-shrink-0 overflow-auto p-2 border-r" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>幻灯片</span>
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
          <div key={active} className="bg-white shadow-xl rounded-lg w-full animate-fade-in relative"
            style={{ aspectRatio: '16 / 9', background: current.bg, maxWidth: '900px', boxShadow: '0 20px 40px rgba(15, 23, 42, 0.12)', zoom: `${zoom}%` }}>
            <div className="h-full flex flex-col p-6 sm:p-10 md:p-14 relative overflow-hidden">
              {/* 文字内容 */}
              {current.layout === 'title' && (
                <div className="flex-1 flex flex-col justify-center items-center text-center relative z-10">
                  <input value={current.title} onChange={e => updateActive({ title: e.target.value })} className="text-2xl sm:text-3xl md:text-4xl font-bold text-center outline-none bg-transparent w-full" style={{ letterSpacing: '-0.02em', color: isDark ? '#f1f5f9' : '#0f172a' }} placeholder="点击添加标题" />
                  <input value={current.content} onChange={e => updateActive({ content: e.target.value })} className="text-sm sm:text-base md:text-lg text-center mt-3 outline-none bg-transparent w-full" style={{ color: isDark ? '#cbd5e1' : '#64748b' }} placeholder="点击添加副标题" />
                </div>
              )}
              {current.layout === 'content' && (
                <>
                  <input value={current.title} onChange={e => updateActive({ title: e.target.value })} className="text-xl sm:text-2xl font-bold mb-4 outline-none bg-transparent relative z-10" style={{ color: isDark ? '#f1f5f9' : '#0f172a' }} placeholder="点击添加标题" />
                  <div className="w-12 h-1 rounded mb-4" style={{ background: 'var(--color-primary)' }}></div>
                  <textarea value={current.content} onChange={e => updateActive({ content: e.target.value })} className="flex-1 text-sm sm:text-base outline-none bg-transparent resize-none leading-relaxed relative z-10" style={{ color: isDark ? '#cbd5e1' : '#334155' }} placeholder="点击添加内容" />
                </>
              )}
              {current.layout === 'blank' && (
                <textarea value={current.content} onChange={e => updateActive({ content: e.target.value })} className="flex-1 text-sm outline-none bg-transparent resize-none relative z-10" style={{ color: isDark ? '#f1f5f9' : '#334155' }} placeholder="空白幻灯片" />
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
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>就绪</span>
        <div className="flex-1" />
        <span>幻灯片 #{active + 1} / {slides.length}</span>
        {current.shapes.length > 0 && <span>📊 形状 {current.shapes.length}</span>}
        {current.animations.length > 0 && <span>✨ 动画 {current.animations.length}</span>}
        {current.transition && <span style={{ color: 'var(--color-primary)' }}>切换: {TRANSITIONS.find(t => t.id === current.transition)?.name}</span>}
        {current.notes && <span>📝 备注</span>}
        {autoPlay && <span style={{ color: 'var(--color-primary)' }}>⏱ 自动 {autoPlaySec}s</span>}
        <button onClick={startPresent} className="btn btn-primary btn-sm">▶ 放映</button>
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
