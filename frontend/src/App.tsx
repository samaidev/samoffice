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
    { inline: [{ content: '欢迎使用 GoOffice', bold: true }], style: '', align: '' }
  ]
}

function App() {
  const [backend, setBackend] = useState<Backend | null>(null)
  const [tab, setTab] = useState<Tab>('document')
  const [doc, setDoc] = useState<Document>(EMPTY_DOC)
  const [spellErrors, setSpellErrors] = useState<SpellError[]>([])
  const [lang, setLang] = useState<'en' | 'zh'>('en')
  const [filePath, setFilePath] = useState('')
  const [status, setStatus] = useState<string>('')
  const [menuOpen, setMenuOpen] = useState(false) // 移动端菜单展开
  const [isMobile, setIsMobile] = useState(false)
  const [spellPanelOpen, setSpellPanelOpen] = useState(false)
  const spellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      setStatus(`正在打开 ${file.name}...`)
      try {
        const result = await backend.uploadFile(file)
        setDoc(result.document)
        setFilePath(file.name)
        setStatus(`已打开 ${file.name}`)
        triggerSpellCheck(JSON.stringify(result.document.blocks))
      } catch (e: any) {
        setStatus(`打开失败: ${e.message}`)
      }
    }
    input.click()
  }

  const handleSave = async (format: 'docx' | 'pdf') => {
    if (!backend) return
    setMenuOpen(false)
    setStatus(`导出 ${format.toUpperCase()} 中...`)
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
          const text = await blob.text()
          setStatus(`导出失败: ${text}`)
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
        setStatus(`已导出 ${format.toUpperCase()}`)
      } else {
        setStatus(`导出失败: ${await resp.text()}`)
      }
    } catch (e: any) {
      setStatus(`导出失败: ${e.message}`)
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
        setStatus(`已插入图片: ${file.name}`)
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const handleLearnWord = async (word: string) => {
    if (!backend) return
    await backend.learnWord(word, lang, 'manual')
    setStatus(`已学习: ${word}`)
    triggerSpellCheck(JSON.stringify(doc.blocks))
  }

  const menuItems = [
    { label: '文件', onClick: handleOpenFile },
    { label: '存为 docx', onClick: () => handleSave('docx') },
    { label: '导出 PDF', onClick: () => handleSave('pdf') },
    { label: '插入图片', onClick: handleInsertImage },
  ]

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 顶部菜单栏 */}
      <header className="bg-blue-600 text-white px-3 sm:px-4 py-2 flex items-center gap-2 shadow-md flex-shrink-0">
        <div className="font-bold text-base sm:text-lg flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <span className="bg-white text-blue-600 px-1.5 sm:px-2 py-0.5 rounded text-xs sm:text-sm">Go</span>
          <span className="hidden sm:inline">Office</span>
        </div>

        {/* 桌面端：横向菜单 */}
        {!isMobile && (
          <div className="flex gap-1 flex-wrap">
            {menuItems.map((it) => (
              <button
                key={it.label}
                onClick={it.onClick}
                className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-700 rounded whitespace-nowrap"
              >{it.label}</button>
            ))}
          </div>
        )}

        {/* 移动端：汉堡菜单按钮 */}
        {isMobile && (
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="px-3 py-1.5 bg-blue-500 hover:bg-blue-700 rounded"
            aria-label="菜单"
          >
            <div className="w-4 h-0.5 bg-white mb-1"></div>
            <div className="w-4 h-0.5 bg-white mb-1"></div>
            <div className="w-4 h-0.5 bg-white"></div>
          </button>
        )}

        <div className="flex-1" />
        <div className="text-xs opacity-80 hidden sm:block">
          {backend?.mode === 'local' ? '本地' : '远程'}
        </div>
        {/* 拼写错误快捷按钮（移动端） */}
        {spellErrors.length > 0 && (
          <button
            onClick={() => setSpellPanelOpen(!spellPanelOpen)}
            className="ml-2 px-2 py-1 text-xs bg-red-500 hover:bg-red-600 rounded flex-shrink-0"
          >
            {spellErrors.length} 错
          </button>
        )}
      </header>

      {/* 移动端下拉菜单 */}
      {isMobile && menuOpen && (
        <div className="bg-blue-500 text-white shadow-lg flex-shrink-0">
          {menuItems.map((it) => (
            <button
              key={it.label}
              onClick={it.onClick}
              className="block w-full text-left px-4 py-3 text-sm hover:bg-blue-600 border-b border-blue-400"
            >{it.label}</button>
          ))}
        </div>
      )}

      {/* Tab 切换 */}
      <div className="bg-white border-b px-2 sm:px-4 flex items-center gap-1 sm:gap-2 flex-shrink-0 overflow-x-auto">
        {(['document', 'spreadsheet', 'slide'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 sm:px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${
              tab === t
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'document' ? '📄 文档' : t === 'spreadsheet' ? '📊 表格' : '🎞 演示'}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-1 sm:gap-2 text-sm flex-shrink-0">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as 'en' | 'zh')}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="en">EN</option>
            <option value="zh">中文</option>
          </select>
          {!isMobile && spellErrors.length > 0 && (
            <span className="text-xs text-red-500">{spellErrors.length} 错</span>
          )}
        </div>
      </div>

      {/* 主编辑区 */}
      <main className="flex-1 overflow-hidden min-h-0">
        {tab === 'document' && (
          <div className="h-full overflow-auto bg-white">
            <div className="max-w-4xl mx-auto shadow-md min-h-full">
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
      </main>

      {/* 底部状态栏 */}
      <footer className="bg-gray-800 text-white text-xs px-3 sm:px-4 py-1 flex items-center gap-2 sm:gap-4 flex-shrink-0 overflow-hidden">
        <span className="truncate flex-1 sm:flex-initial">{status || '就绪'}</span>
        {filePath && <span className="text-gray-400 hidden sm:inline">| {filePath}</span>}
        <div className="hidden sm:block flex-1" />
        <span className="flex-shrink-0">v0.1.0</span>
      </footer>

      {/* 拼写错误浮窗（桌面右下角 / 移动端底部全宽） */}
      {spellErrors.length > 0 && (spellPanelOpen || !isMobile) && (
        <div className={`bg-white shadow-xl rounded-lg border max-h-96 overflow-auto z-50 ${
          isMobile
            ? 'fixed inset-x-0 bottom-0 max-w-full rounded-b-none'
            : 'fixed bottom-12 right-4 max-w-sm'
        }`}>
          <div className="px-3 sm:px-4 py-2 border-b bg-red-50 flex items-center justify-between sticky top-0">
            <span className="text-sm font-semibold text-red-700">
              拼写检查 ({spellErrors.length})
            </span>
            <button
              onClick={() => { setSpellErrors([]); setSpellPanelOpen(false) }}
              className="text-gray-400 hover:text-gray-600 px-2"
            >×</button>
          </div>
          <div className="divide-y">
            {spellErrors.slice(0, 10).map((e, i) => (
              <div key={i} className="px-3 sm:px-4 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-red-600 font-mono text-sm">{e.word}</span>
                  <button
                    onClick={() => handleLearnWord(e.word)}
                    className="text-xs text-blue-500 hover:underline flex-shrink-0 ml-2"
                  >+加入词典</button>
                </div>
                {e.suggest.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.suggest.slice(0, 5).map((s, j) => (
                      <span key={j} className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
