import { useState } from 'react'

interface Slide {
  id: number; title: string; content: string; bg: string
  layout: 'title' | 'content' | 'blank'
  transition: string; notes: string
}

type RibbonTab = 'home' | 'insert' | 'design' | 'transition' | 'view'

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
]

export function SlideEditor() {
  const [slides, setSlides] = useState<Slide[]>([
    { id: 1, title: '演示文稿标题', content: '副标题或描述', bg: '#ffffff', layout: 'title', transition: 'fade', notes: '' },
    { id: 2, title: '内容幻灯片', content: '在此添加您的内容', bg: '#ffffff', layout: 'content', transition: '', notes: '' },
  ])
  const [active, setActive] = useState(0)
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home')
  const [zoom, setZoom] = useState(100)

  const addSlide = () => { setSlides(s => [...s, { id: Date.now(), title: `幻灯片 ${s.length + 1}`, content: '在此添加内容', bg: '#ffffff', layout: 'content', transition: '', notes: '' }]); setActive(slides.length) }
  const deleteSlide = (idx: number) => { if (slides.length <= 1) return; setSlides(s => s.filter((_, i) => i !== idx)); if (active >= idx && active > 0) setActive(active - 1) }
  const duplicateSlide = (idx: number) => { setSlides(s => { const copy = { ...s[idx], id: Date.now() }; const next = [...s]; next.splice(idx + 1, 0, copy); return next }); setActive(idx + 1) }
  const updateActive = (patch: Partial<Slide>) => setSlides(s => s.map((sl, i) => i === active ? { ...sl, ...patch } : sl))
  const switchSlide = (i: number) => { if (i === active) return; setActive(i) }
  const current = slides[active] || slides[0]
  const isDark = current.bg === '#1e293b' || current.bg === '#312e81'

  const ribbonTabs: { id: RibbonTab; label: string }[] = [
    { id: 'home', label: '开始' }, { id: 'insert', label: '插入' }, { id: 'design', label: '设计' }, { id: 'transition', label: '切换' }, { id: 'view', label: '视图' },
  ]

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
            {LAYOUTS.map(l => (
              <RibbonButton key={l.id} icon={l.icon} label={l.name} onClick={() => updateActive({ layout: l.id as Slide['layout'] })} active={current.layout === l.id} />
            ))}
          </RibbonGroup>
          <RibbonGroup label="字体">
            <RibbonButton icon="B" label="加粗" onClick={() => {}} />
            <RibbonButton icon="I" label="斜体" onClick={() => {}} />
            <RibbonButton icon="🎨" label="颜色" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="段落">
            <RibbonButton icon="⬅" label="左对齐" onClick={() => {}} />
            <RibbonButton icon="⬌" label="居中" onClick={() => {}} />
            <RibbonButton icon="➡" label="右对齐" onClick={() => {}} />
          </RibbonGroup>
        </>)}
        {ribbonTab === 'insert' && (<>
          <RibbonGroup label="插图">
            <RibbonButton icon="🖼" label="图片" onClick={() => {}} />
            <RibbonButton icon="📊" label="图表" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="文本">
            <RibbonButton icon="📦" label="文本框" onClick={() => {}} />
            <RibbonButton icon="🎨" label="艺术字" onClick={() => {}} />
          </RibbonGroup>
          <RibbonGroup label="链接">
            <RibbonButton icon="🔗" label="超链接" onClick={() => {}} />
            <RibbonButton icon="⚓" label="书签" onClick={() => {}} />
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
          <RibbonGroup label="主题">
            <RibbonButton icon="🎨" label="自定义" onClick={() => {}} />
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
        </>)}
      </div>

      {/* 主体：左缩略图 + 中画布 */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* 左侧幻灯片列表 */}
        <div className="w-40 lg:w-48 flex-shrink-0 overflow-auto p-2 border-r" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>幻灯片</span>
            <button onClick={addSlide} className="text-sm font-medium px-2 py-0.5 rounded transition-colors" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }} title="新建">+</button>
          </div>
          <div className="space-y-2">
            {slides.map((s, i) => (
              <div key={s.id} onClick={() => switchSlide(i)} className={`group relative p-1.5 border-2 rounded-lg cursor-pointer transition-all ${i === active ? 'shadow-md' : 'hover:shadow-sm'}`}
                style={{ borderColor: i === active ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-surface)' }}>
                <div className="aspect-video rounded overflow-hidden flex flex-col justify-center items-center text-[10px] text-center p-1 relative" style={{ background: s.bg }}>
                  <div className="font-medium truncate w-full leading-tight" style={{ color: (s.bg === '#1e293b' || s.bg === '#312e81') ? '#f1f5f9' : '#0f172a' }}>{s.title}</div>
                  <div className="opacity-50 mt-0.5" style={{ color: (s.bg === '#1e293b' || s.bg === '#312e81') ? '#f1f5f9' : '#0f172a' }}>{i + 1}</div>
                  <div className="absolute top-0.5 left-0.5 text-[8px] opacity-40">{s.layout === 'title' ? '🎯' : s.layout === 'content' ? '📝' : '⬜'}</div>
                </div>
                <div className="absolute -top-2 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={e => { e.stopPropagation(); duplicateSlide(i) }} className="w-5 h-5 rounded-full bg-slate-600 text-white text-[10px] hover:bg-slate-700 flex items-center justify-center" title="复制">⎘</button>
                  {slides.length > 1 && <button onClick={e => { e.stopPropagation(); deleteSlide(i) }} className="w-5 h-5 rounded-full bg-rose-500 text-white text-xs hover:bg-rose-600 flex items-center justify-center" title="删除">×</button>}
                </div>
                <div className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                  style={{ background: i === active ? 'var(--color-primary)' : 'var(--color-bg-alt)', color: i === active ? 'white' : 'var(--color-text-muted)' }}>{i + 1}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 中间画布 */}
        <div className="flex-1 flex items-center justify-center p-3 sm:p-6 md:p-10 overflow-auto min-h-0" style={{ background: 'var(--color-bg-alt)' }}>
          <div key={active} className="bg-white shadow-xl rounded-lg w-full animate-fade-in"
            style={{ aspectRatio: '16 / 9', background: current.bg, maxWidth: '900px', boxShadow: '0 20px 40px rgba(15, 23, 42, 0.12), 0 8px 12px rgba(15, 23, 42, 0.06)', zoom: `${zoom}%` }}>
            <div className="h-full flex flex-col p-6 sm:p-10 md:p-14">
              {current.layout === 'title' && (
                <div className="flex-1 flex flex-col justify-center items-center text-center">
                  <input value={current.title} onChange={e => updateActive({ title: e.target.value })} className="text-2xl sm:text-3xl md:text-4xl font-bold text-center outline-none bg-transparent w-full" style={{ letterSpacing: '-0.02em', color: isDark ? '#f1f5f9' : '#0f172a' }} placeholder="点击添加标题" />
                  <input value={current.content} onChange={e => updateActive({ content: e.target.value })} className="text-sm sm:text-base md:text-lg text-center mt-3 sm:mt-5 outline-none bg-transparent w-full" style={{ color: isDark ? '#cbd5e1' : '#64748b' }} placeholder="点击添加副标题" />
                </div>
              )}
              {current.layout === 'content' && (
                <>
                  <input value={current.title} onChange={e => updateActive({ title: e.target.value })} className="text-xl sm:text-2xl md:text-3xl font-bold mb-4 sm:mb-6 outline-none bg-transparent" style={{ letterSpacing: '-0.01em', color: isDark ? '#f1f5f9' : '#0f172a' }} placeholder="点击添加标题" />
                  <div className="w-12 h-1 rounded mb-4" style={{ background: 'var(--color-primary)' }}></div>
                  <textarea value={current.content} onChange={e => updateActive({ content: e.target.value })} className="flex-1 text-sm sm:text-base md:text-lg outline-none bg-transparent resize-none leading-relaxed" style={{ color: isDark ? '#cbd5e1' : '#334155' }} placeholder="点击添加内容" />
                </>
              )}
              {current.layout === 'blank' && (
                <textarea value={current.content} onChange={e => updateActive({ content: e.target.value })} className="flex-1 text-sm sm:text-base outline-none bg-transparent resize-none" style={{ color: isDark ? '#f1f5f9' : '#334155' }} placeholder="空白幻灯片" />
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
        {current.transition && <span style={{ color: 'var(--color-primary)' }}>切换: {TRANSITIONS.find(t => t.id === current.transition)?.name}</span>}
        {current.notes && <span>📝 有备注</span>}
      </div>
    </div>
  )
}
