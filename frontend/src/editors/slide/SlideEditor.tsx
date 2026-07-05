import { useState } from 'react'

interface Slide {
  id: number
  title: string
  content: string
  bg: string
  layout: 'title' | 'content' | 'blank'
}

const LAYOUTS = [
  { id: 'title', name: '标题', icon: '🎯', desc: '居中标题' },
  { id: 'content', name: '内容', icon: '📝', desc: '标题+内容' },
  { id: 'blank', name: '空白', icon: '⬜', desc: '自由编辑' },
] as const

const PRESET_COLORS = [
  { name: '白', value: '#ffffff' },
  { name: '浅灰', value: '#f8fafc' },
  { name: '米黄', value: '#fef3c7' },
  { name: '天蓝', value: '#dbeafe' },
  { name: '薄荷', value: '#dcfce7' },
  { name: '粉红', value: '#fce7f3' },
  { name: '深灰', value: '#1e293b' },
  { name: '靛蓝', value: '#312e81' },
]

export function SlideEditor() {
  const [slides, setSlides] = useState<Slide[]>([
    { id: 1, title: '演示文稿标题', content: '副标题或描述', bg: '#ffffff', layout: 'title' },
    { id: 2, title: '内容幻灯片', content: '在此添加您的内容', bg: '#ffffff', layout: 'content' }
  ])
  const [active, setActive] = useState(0)
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth <= 768
  )
  const [transition, setTransition] = useState<'none' | 'fade' | 'slide'>('fade')

  const addSlide = () => {
    setSlides((s) => [...s, {
      id: Date.now(),
      title: `幻灯片 ${s.length + 1}`,
      content: '在此添加内容',
      bg: '#ffffff',
      layout: 'content'
    }])
    setActive(slides.length)
  }

  const deleteSlide = (idx: number) => {
    if (slides.length <= 1) return
    setSlides((s) => s.filter((_, i) => i !== idx))
    if (active >= idx && active > 0) setActive(active - 1)
  }

  const duplicateSlide = (idx: number) => {
    setSlides((s) => {
      const copy = { ...s[idx], id: Date.now() }
      const next = [...s]
      next.splice(idx + 1, 0, copy)
      return next
    })
    setActive(idx + 1)
  }

  const updateActive = (patch: Partial<Slide>) => {
    setSlides((s) => s.map((sl, i) => i === active ? { ...sl, ...patch } : sl))
  }

  const switchSlide = (i: number) => {
    if (i === active) return
    setTransition('fade')
    setActive(i)
  }

  const current = slides[active] || slides[0]
  const isDark = current.bg === '#1e293b' || current.bg === '#312e81'

  return (
    <div className="flex h-full flex-col md:flex-row" style={{ background: 'var(--color-bg-alt)' }}>
      {/* 左侧幻灯片列表 */}
      <div
        className="md:w-52 w-full md:border-r border-b md:border-b-0 md:overflow-auto flex md:flex-col gap-2 p-2 md:p-3 overflow-x-auto flex-shrink-0"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between mb-1 flex-shrink-0 px-1">
          <span className="text-xs font-semibold hidden md:inline" style={{ color: 'var(--color-text-secondary)' }}>幻灯片</span>
          <button
            onClick={addSlide}
            className="text-sm font-medium px-2 py-1 rounded transition-colors hover:opacity-80 flex items-center gap-1"
            style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}
            title="新建幻灯片"
          >
            <span className="text-base">+</span>
            <span className="hidden md:inline">新建</span>
          </button>
        </div>
        <div className="flex md:flex-col gap-2">
          {slides.map((s, i) => (
            <div
              key={s.id}
              onClick={() => switchSlide(i)}
              className={`group relative p-1.5 border-2 rounded-lg cursor-pointer transition-all flex-shrink-0 w-28 md:w-auto ${
                i === active ? 'shadow-md' : 'hover:shadow-sm'
              }`}
              style={{
                borderColor: i === active ? 'var(--color-primary)' : 'var(--color-border)',
                background: 'var(--color-surface)'
              }}
            >
              <div
                className="aspect-video rounded overflow-hidden flex flex-col justify-center items-center text-[10px] text-center p-1 relative"
                style={{ background: s.bg }}
              >
                <div
                  className="font-medium truncate w-full leading-tight"
                  style={{ color: (s.bg === '#1e293b' || s.bg === '#312e81') ? '#f1f5f9' : '#0f172a' }}
                >{s.title}</div>
                <div className="opacity-50 mt-0.5" style={{ color: (s.bg === '#1e293b' || s.bg === '#312e81') ? '#f1f5f9' : '#0f172a' }}>{i + 1}</div>
                {/* 布局标识 */}
                <div className="absolute top-0.5 left-0.5 text-[8px] opacity-40">
                  {s.layout === 'title' ? '🎯' : s.layout === 'content' ? '📝' : '⬜'}
                </div>
              </div>
              {/* 悬停操作按钮 */}
              <div className="absolute -top-2 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => { e.stopPropagation(); duplicateSlide(i) }}
                  className="w-5 h-5 rounded-full bg-slate-600 text-white text-[10px] hover:bg-slate-700 flex items-center justify-center"
                  title="复制"
                >⎘</button>
                {slides.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSlide(i) }}
                    className="w-5 h-5 rounded-full bg-rose-500 text-white text-xs hover:bg-rose-600 flex items-center justify-center"
                    title="删除"
                  >×</button>
                )}
              </div>
              {/* 序号徽章 */}
              <div
                className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                style={{
                  background: i === active ? 'var(--color-primary)' : 'var(--color-bg-alt)',
                  color: i === active ? 'white' : 'var(--color-text-muted)'
                }}
              >{i + 1}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 中间画布 */}
      <div
        className="flex-1 flex items-center justify-center p-3 sm:p-6 md:p-10 overflow-auto min-h-0"
        style={{ background: 'var(--color-bg-alt)' }}
      >
        <div
          key={active}
          className="bg-white shadow-xl rounded-lg w-full animate-fade-in"
          style={{
            aspectRatio: '16 / 9',
            background: current.bg,
            maxWidth: '900px',
            boxShadow: '0 20px 40px rgba(15, 23, 42, 0.12), 0 8px 12px rgba(15, 23, 42, 0.06)'
          }}
        >
          <div className="h-full flex flex-col p-6 sm:p-10 md:p-14">
            {current.layout === 'title' && (
              <div className="flex-1 flex flex-col justify-center items-center text-center">
                <input
                  value={current.title}
                  onChange={(e) => updateActive({ title: e.target.value })}
                  className="text-2xl sm:text-3xl md:text-4xl font-bold text-center outline-none bg-transparent w-full"
                  style={{ letterSpacing: '-0.02em', color: isDark ? '#f1f5f9' : '#0f172a' }}
                  placeholder="点击添加标题"
                />
                <input
                  value={current.content}
                  onChange={(e) => updateActive({ content: e.target.value })}
                  className="text-sm sm:text-base md:text-lg text-center mt-3 sm:mt-5 outline-none bg-transparent w-full"
                  style={{ color: isDark ? '#cbd5e1' : '#64748b' }}
                  placeholder="点击添加副标题"
                />
              </div>
            )}
            {current.layout === 'content' && (
              <>
                <input
                  value={current.title}
                  onChange={(e) => updateActive({ title: e.target.value })}
                  className="text-xl sm:text-2xl md:text-3xl font-bold mb-4 sm:mb-6 outline-none bg-transparent"
                  style={{ letterSpacing: '-0.01em', color: isDark ? '#f1f5f9' : '#0f172a' }}
                  placeholder="点击添加标题"
                />
                <div className="w-12 h-1 rounded mb-4" style={{ background: 'var(--color-primary)' }}></div>
                <textarea
                  value={current.content}
                  onChange={(e) => updateActive({ content: e.target.value })}
                  className="flex-1 text-sm sm:text-base md:text-lg outline-none bg-transparent resize-none leading-relaxed"
                  style={{ color: isDark ? '#cbd5e1' : '#334155' }}
                  placeholder="点击添加内容"
                />
              </>
            )}
            {current.layout === 'blank' && (
              <textarea
                value={current.content}
                onChange={(e) => updateActive({ content: e.target.value })}
                className="flex-1 text-sm sm:text-base outline-none bg-transparent resize-none"
                style={{ color: isDark ? '#f1f5f9' : '#334155' }}
                placeholder="空白幻灯片"
              />
            )}
          </div>
        </div>
      </div>

      {/* 右侧属性面板 */}
      <div
        className="md:w-60 w-full md:border-l border-t md:border-t-0 p-3 md:p-4 overflow-auto flex-shrink-0"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <span>🎨</span> 属性
        </div>

        {/* 布局选择 */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>布局</label>
          <div className="grid grid-cols-3 gap-1.5">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                onClick={() => updateActive({ layout: l.id as Slide['layout'] })}
                className={`p-2 rounded-md border text-xs flex flex-col items-center gap-1 transition-all ${
                  current.layout === l.id ? 'scale-105' : 'hover:scale-105'
                }`}
                style={{
                  borderColor: current.layout === l.id ? 'var(--color-primary)' : 'var(--color-border)',
                  background: current.layout === l.id ? 'var(--color-primary-light)' : 'transparent',
                  color: current.layout === l.id ? 'var(--color-primary)' : 'var(--color-text-secondary)'
                }}
              >
                <span className="text-base">{l.icon}</span>
                {l.name}
              </button>
            ))}
          </div>
        </div>

        {/* 背景色 */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>背景色</label>
          <div className="flex gap-2 items-center mb-2">
            <input
              type="color"
              value={current.bg}
              onChange={(e) => updateActive({ bg: e.target.value })}
              className="w-10 h-8 rounded cursor-pointer"
              style={{ border: '1px solid var(--color-border)' }}
            />
            <input
              value={current.bg}
              onChange={(e) => updateActive({ bg: e.target.value })}
              className="flex-1 text-xs font-mono px-2 py-1.5"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            />
          </div>
          <div className="grid grid-cols-8 gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => updateActive({ bg: c.value })}
                className="aspect-square rounded border hover:scale-110 transition-transform"
                style={{ background: c.value, borderColor: 'var(--color-border)' }}
                title={c.name}
              />
            ))}
          </div>
        </div>

        {/* 幻灯片信息 */}
        <div className="pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="text-xs flex justify-between mb-2" style={{ color: 'var(--color-text-muted)' }}>
            <span>当前</span>
            <span className="font-mono font-medium" style={{ color: 'var(--color-text)' }}>#{active + 1} / {slides.length}</span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => switchSlide(Math.max(0, active - 1))}
              disabled={active === 0}
              className="flex-1 btn btn-outline btn-sm"
            >← 上一张</button>
            <button
              onClick={() => switchSlide(Math.min(slides.length - 1, active + 1))}
              disabled={active === slides.length - 1}
              className="flex-1 btn btn-outline btn-sm"
            >下一张 →</button>
          </div>
        </div>

        {/* 操作 */}
        <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <label className="block text-xs font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>操作</label>
          <button
            onClick={() => duplicateSlide(active)}
            className="w-full btn btn-outline btn-sm mb-2"
          >⎘ 复制当前</button>
          {slides.length > 1 && (
            <button
              onClick={() => deleteSlide(active)}
              className="w-full btn btn-outline btn-sm"
              style={{ color: 'var(--color-danger)' }}
            >× 删除当前</button>
          )}
        </div>
      </div>
    </div>
  )
}
