import { useState, useEffect, useCallback, useRef } from 'react'
import { createBackend } from './services/backend'
import type { Backend, Document, SpellError } from './types/udm'
import { DocumentEditor } from './editors/document/DocumentEditor'
import { SpreadsheetEditor } from './editors/spreadsheet/SpreadsheetEditor'
import { SlideEditor } from './editors/slide/SlideEditor'

type Tab = 'document' | 'spreadsheet' | 'slide'

const EMPTY_DOC: Document = {
  meta: { title: '未命名文档' },
  blocks: [
    { inline: [{ content: '欢迎使用 GoOffice', bold: true }], style: '', align: '' },
    { inline: [{ content: '一款用 Go + Web 构建的跨平台办公套件' }], style: '', align: '' }
  ]
}

function App() {
  const [backend, setBackend] = useState<Backend | null>(null)
  const [tab, setTab] = useState<Tab>('document')
  const [doc, setDoc] = useState<Document>(EMPTY_DOC)
  const [spellErrors, setSpellErrors] = useState<SpellError[]>([])
  const [lang, setLang] = useState<'en' | 'zh'>('zh')
  const [filePath, setFilePath] = useState('')
  const [toast, setToast] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [spellPanelOpen, setSpellPanelOpen] = useState(false)
  const spellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2500)
  }, [])

  useEffect(() => {
    setBackend(createBackend())
    const checkMobile = () => setIsMobile(window.innerWidth <= 768)
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const triggerSpellCheck = useCallback((text: string) => {
    if (spellTimer.current) clearTimeout(spellTimer.current)
    spellTimer.current = setTimeout(async () => {
      if (!backend || !text.trim()) {
        setSpellErrors([])
        return
      }
      try {
        const errs = await backend.spellCheck(text, lang)
        setSpellErrors(errs)
      } catch (e) {
        console.error('spell check failed', e)
      }
    }, 500)
  }, [backend, lang])

  const handleOpenFile = async () => {
    if (!backend) return
    setMenuOpen(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.docx,.md,.markdown,.xlsx,.pptx'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setLoading(true)
      showToast(`正在打开 ${file.name}...`)
      try {
        const result = await backend.uploadFile(file)
        setDoc(result.document)
        setFilePath(file.name)
        showToast(`已打开 ${file.name}`)
        triggerSpellCheck(JSON.stringify(result.document.blocks))
      } catch (e: any) {
        showToast(`打开失败: ${e.message}`)
      } finally {
        setLoading(false)
      }
    }
    input.click()
  }

  const handleSave = async (format: 'docx' | 'pdf') => {
    if (!backend) return
    setMenuOpen(false)
    setLoading(true)
    showToast(`导出 ${format.toUpperCase()} 中...`)
    try {
      const endpoint = format === 'docx' ? '/api/doc/save' : '/api/doc/export-pdf'
      const mime = format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf'
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc)
      })
      if (resp.ok) {
        const blob = await resp.blob()
        if (blob.type !== mime && blob.size < 500) {
          showToast(`导出失败: ${await blob.text()}`)
          return
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const title = doc.meta?.title || 'untitled'
        a.download = `${title}.${format}`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        showToast(`已导出 ${format.toUpperCase()}`)
      } else {
        showToast(`导出失败: ${await resp.text()}`)
      }
    } catch (e: any) {
      showToast(`导出失败: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleInsertImage = () => {
    setMenuOpen(false)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUri = reader.result as string
        setDoc((d) => ({
          ...d,
          blocks: [...d.blocks, { src: dataUri, width: 400, height: 300, alt: file.name } as any]
        }))
        showToast(`已插入图片: ${file.name}`)
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const handleLearnWord = async (word: string) => {
    if (!backend) return
    await backend.learnWord(word, lang, 'manual')
    showToast(`已加入词典: ${word}`)
    triggerSpellCheck(JSON.stringify(doc.blocks))
  }

  const menuItems = [
    { icon: '📂', label: '打开文件', onClick: handleOpenFile },
    { icon: '📄', label: '存为 docx', onClick: () => handleSave('docx') },
    { icon: '📕', label: '导出 PDF', onClick: () => handleSave('pdf') },
    { icon: '🖼', label: '插入图片', onClick: handleInsertImage },
  ]

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--color-bg)' }}>
      {/* 顶部菜单栏 */}
      <header
        className="text-white px-3 sm:px-5 py-2.5 flex items-center gap-3 flex-shrink-0"
        style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
          boxShadow: '0 2px 8px rgba(79, 70, 229, 0.2)'
        }}
      >
        <div className="font-bold text-base sm:text-lg flex items-center gap-2 flex-shrink-0">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-sm font-bold"
            style={{ background: 'rgba(255,255,255,0.2)', color: 'white' }}
          >Go</div>
          <span className="hidden sm:inline tracking-tight">Office</span>
        </div>

        {/* 桌面端菜单 */}
        {!isMobile && (
          <div className="flex gap-1 items-center">
            {menuItems.map((it) => (
              <button
                key={it.label}
                onClick={it.onClick}
                disabled={loading}
                className="px-3 py-1.5 text-sm rounded-md transition-all hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5"
              >
                <span className="text-xs opacity-80">{it.icon}</span>
                {it.label}
              </button>
            ))}
          </div>
        )}

        {/* 移动端汉堡 */}
        {isMobile && (
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-2 rounded-md hover:bg-white/15"
            aria-label="菜单"
          >
            <div className="w-5 h-0.5 bg-white mb-1.5 rounded"></div>
            <div className="w-5 h-0.5 bg-white mb-1.5 rounded"></div>
            <div className="w-5 h-0.5 bg-white rounded"></div>
          </button>
        )}

        <div className="flex-1" />

        {/* 模式标识 */}
        <div className="text-xs opacity-75 hidden sm:flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${backend?.mode === 'local' ? 'bg-green-300' : 'bg-blue-300'}`}></span>
          {backend?.mode === 'local' ? '本地模式' : '远程模式'}
        </div>

        {/* 拼写错误徽章 */}
        {spellErrors.length > 0 && (
          <button
            onClick={() => setSpellPanelOpen(!spellPanelOpen)}
            className="px-2.5 py-1 text-xs rounded-full font-semibold flex items-center gap-1"
            style={{ background: 'rgba(225, 29, 72, 0.9)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
            {spellErrors.length}
          </button>
        )}
      </header>

      {/* 移动端下拉菜单 */}
      {isMobile && menuOpen && (
        <div className="bg-white shadow-lg flex-shrink-0 border-b border-slate-200 animate-fade-in">
          {menuItems.map((it) => (
            <button
              key={it.label}
              onClick={it.onClick}
              disabled={loading}
              className="block w-full text-left px-4 py-3 text-sm hover:bg-slate-50 border-b border-slate-100 disabled:opacity-50 flex items-center gap-3"
            >
              <span className="text-base">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}

      {/* Tab 切换栏 */}
      <div className="bg-white border-b border-slate-200 px-2 sm:px-5 flex items-center gap-1 flex-shrink-0 overflow-x-auto">
        {([
          { id: 'document', icon: '📄', label: '文档' },
          { id: 'spreadsheet', icon: '📊', label: '表格' },
          { id: 'slide', icon: '🎞', label: '演示' }
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-2 ${
              tab === t.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-sm flex-shrink-0 py-1.5">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as 'en' | 'zh')}
            className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white"
            style={{ minWidth: '70px' }}
          >
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {/* 主编辑区 */}
      <main className="flex-1 overflow-hidden min-h-0 flex">
        {/* 文档/表格/演示主区 */}
        <div className="flex-1 overflow-hidden min-w-0">
          {tab === 'document' && (
            <div className="h-full overflow-auto bg-slate-100">
              <div
                className="max-w-4xl mx-auto bg-white min-h-full"
                style={{ boxShadow: '0 0 20px rgba(15, 23, 42, 0.04)', marginTop: '16px', marginBottom: '16px', borderRadius: '4px' }}
              >
                <DocumentEditor
                  document={doc}
                  spellErrors={spellErrors}
                  onChange={(d) => setDoc(d)}
                  onSpellCheck={triggerSpellCheck}
                />
              </div>
            </div>
          )}
          {tab === 'spreadsheet' && <SpreadsheetEditor title="工作表 1" />}
          {tab === 'slide' && <SlideEditor />}
        </div>

        {/* 拼写检查侧边面板（桌面端固定，移动端浮层） */}
        {spellErrors.length > 0 && (spellPanelOpen || isMobile) && !isMobile && (
          <aside
            className="w-80 bg-white border-l border-slate-200 flex flex-col flex-shrink-0 animate-slide-in"
            style={{ boxShadow: '-4px 0 12px rgba(15, 23, 42, 0.04)' }}
          >
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="badge badge-danger">{spellErrors.length}</span>
                <span className="text-sm font-semibold text-slate-700">拼写检查</span>
              </div>
              <button
                onClick={() => setSpellPanelOpen(false)}
                className="text-slate-400 hover:text-slate-600 px-1.5"
              >✕</button>
            </div>
            <div className="flex-1 overflow-auto">
              {spellErrors.map((e, i) => (
                <div key={i} className="px-4 py-3 border-b border-slate-50 hover:bg-slate-50">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-rose-600 font-mono text-sm font-medium">{e.word}</span>
                    <button
                      onClick={() => handleLearnWord(e.word)}
                      className="text-xs text-indigo-600 hover:text-indigo-700 hover:underline"
                    >+ 词典</button>
                  </div>
                  {e.suggest.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {e.suggest.slice(0, 5).map((s, j) => (
                        <span
                          key={j}
                          className="text-xs px-2 py-0.5 rounded-md"
                          style={{ background: '#f1f5f9', color: '#475569' }}
                        >{s}</span>
                      ))}
                    </div>
                  )}
                  {e.suggest.length === 0 && (
                    <div className="text-xs text-slate-400 italic">无建议</div>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}
      </main>

      {/* 移动端拼写检查浮层 */}
      {spellErrors.length > 0 && spellPanelOpen && isMobile && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: 'rgba(15, 23, 42, 0.4)' }}
          onClick={() => setSpellPanelOpen(false)}
        >
          <div
            className="bg-white w-full max-h-[70vh] flex flex-col rounded-t-xl animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="badge badge-danger">{spellErrors.length}</span>
                <span className="text-sm font-semibold text-slate-700">拼写检查</span>
              </div>
              <button
                onClick={() => setSpellPanelOpen(false)}
                className="text-slate-400 hover:text-slate-600 px-1.5"
              >✕</button>
            </div>
            <div className="flex-1 overflow-auto">
              {spellErrors.map((e, i) => (
                <div key={i} className="px-4 py-3 border-b border-slate-50">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-rose-600 font-mono text-sm font-medium">{e.word}</span>
                    <button
                      onClick={() => handleLearnWord(e.word)}
                      className="text-xs text-indigo-600 hover:underline"
                    >+ 词典</button>
                  </div>
                  {e.suggest.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {e.suggest.slice(0, 5).map((s, j) => (
                        <span key={j} className="text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 底部状态栏 */}
      <footer className="bg-slate-800 text-white text-xs px-3 sm:px-5 py-1.5 flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          {loading && (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
          )}
          <span className="truncate max-w-[200px] sm:max-w-md">
            {filePath || '就绪'}
          </span>
        </div>
        <div className="flex-1" />
        <span className="text-slate-400 hidden sm:inline">
          {spellErrors.length > 0 ? `${spellErrors.length} 个拼写错误` : '无拼写错误'}
        </span>
        <span className="text-slate-500">v0.2.0</span>
      </footer>

      {/* Toast 提示 */}
      {toast && (
        <div className="toast">{toast}</div>
      )}
    </div>
  )
}

export default App
