import { useState } from 'react'

interface Slide {
  id: number
  title: string
  content: string
  bg: string
}

// 演示文稿编辑器 - 简化版
// 左侧缩略图列表 + 中间画布 + 右侧属性面板
export function SlideEditor() {
  const [slides, setSlides] = useState<Slide[]>([
    { id: 1, title: '标题幻灯片', content: '点击此处添加标题', bg: '#ffffff' },
    { id: 2, title: '内容幻灯片', content: '点击此处添加内容', bg: '#ffffff' }
  ])
  const [active, setActive] = useState(0)

  const addSlide = () => {
    setSlides((s) => [...s, {
      id: Date.now(),
      title: `幻灯片 ${s.length + 1}`,
      content: '点击此处添加内容',
      bg: '#ffffff'
    }])
    setActive(slides.length)
  }

  const updateActive = (patch: Partial<Slide>) => {
    setSlides((s) => s.map((sl, i) => i === active ? { ...sl, ...patch } : sl))
  }

  const current = slides[active] || slides[0]

  return (
    <div className="flex h-full bg-gray-100 flex-col md:flex-row">
      {/* 左侧幻灯片列表 */}
      <div className="md:w-48 w-full md:border-r border-b md:border-b-0 bg-white md:overflow-auto flex md:flex-col gap-2 p-2 overflow-x-auto flex-shrink-0">
        <div className="md:px-3 md:py-2 md:border-b bg-gray-50 flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-semibold text-gray-600 hidden md:inline">幻灯片</span>
          <button
            onClick={addSlide}
            className="text-blue-500 hover:text-blue-600 text-lg leading-none flex-shrink-0 ml-auto"
            title="新建幻灯片"
          >+</button>
        </div>
        <div className="flex md:flex-col gap-2">
          {slides.map((s, i) => (
            <div
              key={s.id}
              onClick={() => setActive(i)}
              className={`md:m-2 m-0 p-2 border rounded cursor-pointer md:aspect-video flex flex-col justify-center items-center text-xs flex-shrink-0 w-32 md:w-auto
                ${i === active ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
              style={{ background: s.bg, minWidth: '8rem' }}
            >
              <div className="font-medium truncate w-full text-center">{s.title}</div>
              <div className="text-gray-400 truncate w-full text-center mt-1 md:mt-0">{i + 1}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 中间画布 */}
      <div className="flex-1 flex items-center justify-center p-2 sm:p-4 md:p-8 overflow-auto min-h-0">
        <div
          className="shadow-xl bg-white w-full max-w-2xl"
          style={{ aspectRatio: '4 / 3', background: current.bg }}
        >
          <div className="h-full flex flex-col p-4 sm:p-6 md:p-12">
            <input
              value={current.title}
              onChange={(e) => updateActive({ title: e.target.value })}
              className="text-lg sm:text-2xl md:text-3xl font-bold text-center mb-4 sm:mb-8 outline-none bg-transparent"
              placeholder="点击添加标题"
            />
            <textarea
              value={current.content}
              onChange={(e) => updateActive({ content: e.target.value })}
              className="flex-1 text-sm sm:text-base md:text-lg text-center outline-none bg-transparent resize-none"
              placeholder="点击添加内容"
            />
          </div>
        </div>
      </div>

      {/* 右侧属性面板 */}
      <div className="md:w-56 w-full md:border-l border-t md:border-t-0 bg-white p-3 md:p-4 overflow-auto flex-shrink-0">
        <div className="text-sm font-semibold text-gray-700 mb-3">属性</div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">背景色</label>
            <input
              type="color"
              value={current.bg}
              onChange={(e) => updateActive({ bg: e.target.value })}
              className="w-full h-8 rounded border"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">幻灯片 #{active + 1}</label>
            <div className="text-xs text-gray-400">共 {slides.length} 张</div>
          </div>
        </div>
      </div>
    </div>
  )
}
