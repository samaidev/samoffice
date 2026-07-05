import { useState } from 'react'

interface Slide {
  id: number
  title: string
  content: string
  bg: string
  layout: 'title' | 'content' | 'blank'
}

const LAYOUTS = [
  { id: 'title', name: '标题', icon: '🎯' },
  { id: 'content', name: '内容', icon: '📝' },
  { id: 'blank', name: '空白', icon: '⬜' },
] as const

export function SlideEditor() {
  const [slides, setSlides] = useState<Slide[]>([
    {
      id: 1,
      title: '演示文稿标题',
      content: '副标题或描述',
      bg: '#ffffff',
      layout: 'title'
    },
    {
      id: 2,
      title: '内容幻灯片',
      content: '在此添加您的内容',
      bg: '#ffffff',
      layout: 'content'
    }
  ])
  const [active, setActive] = useState(0)
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth <= 768
  )

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

  const updateActive = (patch: Partial<Slide>) => {
    setSlides((s) => s.map((sl, i) => i === active ? { ...sl, ...patch } : sl))
  }

  const current = slides[active] || slides[0]

  return (
    <div className="flex h-full flex-col md:flex-row" style={{ background: 'var(--color-bg)' }}>
      {/* 左侧幻灯片列表 */}
      <div
        className="md:w-52 w-full md:border-r border-b md:border-b-0 bg-white md:overflow-auto flex md:flex-col gap-2 p-2 md:p-3 overflow-x-auto flex-shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between mb-1 flex-shrink-0 px-1">
          <span className="text-xs font-semibold text-slate-600 hidden md:inline">幻灯片</span>
          <button
            onClick={addSlide}
            className="text-indigo-600 hover:text-indigo-700 text-sm font-medium px-2 py-1 rounded hover:bg-indigo-50 transition-colors flex items-center gap-1"
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
              onClick={() => setActive(i)}
              className={`group relative p-1.5 border-2 rounded-lg cursor-pointer transition-all flex-shrink-0 w-28 md:w-auto ${
                i === active
                  ? 'border-indigo-500 shadow-md'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
              style={{ background: 'white' }}
            >
              <div
                className="aspect-video rounded overflow-hidden flex flex-col justify-center items-center text-[10px] text-center p-1"
                style={{ background: s.bg }}
              >
                <div className="font-medium text-slate-800 truncate w-full leading-tight">{s.title}</div>
                <div className="text-slate-400 mt-0.5">{i + 1}</div>
              </div>
              {slides.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSlide(i) }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  title="删除"
                >×</button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 中间画布 */}
      <div
        className="flex-1 flex items-center justify-center p-3 sm:p-6 md:p-10 overflow-auto min-h-0"
        style={{ background: 'var(--color-bg)' }}
      >
        <div
          className="bg-white shadow-xl rounded-lg w-full"
          style={{
            aspectRatio: '16 / 9',
            background: current.bg,
            maxWidth: '900px',
            boxShadow: '0 10px 30px rgba(15, 23, 42, 0.1), 0 4px 6px rgba(15, 23, 42, 0.05)'
          }}
        >
          <div className="h-full flex flex-col p-6 sm:p-10 md:p-14">
            {current.layout === 'title' && (
              <>
                <div className="flex-1 flex flex-col justify-center items-center text-center">
                  <input
                    value={current.title}
                    onChange={(e) => updateActive({ title: e.target.value })}
                    className="text-2xl sm:text-3xl md:text-4xl font-bold text-center outline-none bg-transparent w-full text-slate-900"
                    style={{ letterSpacing: '-0.02em' }}
                    placeholder="点击添加标题"
                  />
                  <input
                    value={current.content}
                    onChange={(e) => updateActive({ content: e.target.value })}
                    className="text-sm sm:text-base md:text-lg text-center mt-3 sm:mt-5 outline-none bg-transparent w-full text-slate-500"
                    placeholder="点击添加副标题"
                  />
                </div>
              </>
            )}
            {current.layout === 'content' && (
              <>
                <input
                  value={current.title}
                  onChange={(e) => updateActive({ title: e.target.value })}
                  className="text-xl sm:text-2xl md:text-3xl font-bold mb-4 sm:mb-6 outline-none bg-transparent text-slate-900"
                  style={{ letterSpacing: '-0.01em' }}
                  placeholder="点击添加标题"
                />
                <div className="w-12 h-1 bg-indigo-500 rounded mb-4"></div>
                <textarea
                  value={current.content}
                  onChange={(e) => updateActive({ content: e.target.value })}
                  className="flex-1 text-sm sm:text-base md:text-lg outline-none bg-transparent resize-none text-slate-700 leading-relaxed"
                  placeholder="点击添加内容"
                />
              </>
            )}
            {current.layout === 'blank' && (
              <textarea
                value={current.content}
                onChange={(e) => updateActive({ content: e.target.value })}
                className="flex-1 text-sm sm:text-base outline-none bg-transparent resize-none text-slate-700"
                placeholder="空白幻灯片"
              />
            )}
          </div>
        </div>
      </div>

      {/* 右侧属性面板 */}
      <div
        className="md:w-60 w-full md:border-l border-t md:border-t-0 bg-white p-3 md:p-4 overflow-auto flex-shrink-0"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <span>🎨</span> 属性
        </div>

        {/* 布局选择 */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-500 mb-2">布局</label>
          <div className="grid grid-cols-3 gap-1.5">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                onClick={() => updateActive({ layout: l.id as Slide['layout'] })}
                className={`p-2 rounded-md border text-xs flex flex-col items-center gap-1 transition-all ${
                  current.layout === l.id
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600'
                }`}
              >
                <span className="text-base">{l.icon}</span>
                {l.name}
              </button>
            ))}
          </div>
        </div>

        {/* 背景色 */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-500 mb-2">背景色</label>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={current.bg}
              onChange={(e) => updateActive({ bg: e.target.value })}
              className="w-10 h-8 rounded border border-slate-200 cursor-pointer"
            />
            <input
              value={current.bg}
              onChange={(e) => updateActive({ bg: e.target.value })}
              className="flex-1 text-xs font-mono px-2 py-1.5 border border-slate-200 rounded"
            />
          </div>
          <div className="flex gap-1.5 mt-2">
            {['#ffffff', '#f8fafc', '#fef3c7', '#dbeafe', '#dcfce7', '#fce7f3'].map((c) => (
              <button
                key={c}
                onClick={() => updateActive({ bg: c })}
                className="w-6 h-6 rounded-full border border-slate-200 hover:scale-110 transition-transform"
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        {/* 幻灯片信息 */}
        <div className="pt-3 border-t border-slate-100">
          <div className="text-xs text-slate-500 flex justify-between">
            <span>当前</span>
            <span className="font-mono font-medium text-slate-700">#{active + 1} / {slides.length}</span>
          </div>
        </div>

        {/* 预设模板 */}
        <div className="mt-4 pt-3 border-t border-slate-100">
          <label className="block text-xs font-medium text-slate-500 mb-2">快速模板</label>
          <button
            onClick={addSlide}
            className="w-full text-xs text-indigo-600 hover:bg-indigo-50 py-2 rounded border border-indigo-200 border-dashed transition-colors"
          >
            + 添加新幻灯片
          </button>
        </div>
      </div>
    </div>
  )
}
