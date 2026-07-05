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
  const spellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setBackend(createBackend())
  }, [])

  // 拼写检查（防抖 500ms）
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
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.docx,.md,.markdown'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setStatus(`正在打开 ${file.name}...`)
      try {
        const result = await backend.uploadFile(file)
        setDoc(result.document)
        setFilePath(file.name)
        setStatus(`已打开 ${file.name}，${result.warnings?.length || 0} 个警告`)
        triggerSpellCheck(JSON.stringify(result.document.blocks))
      } catch (e: any) {
        setStatus(`打开失败: ${e.message}`)
      }
    }
    input.click()
  }

  const handleSave = async () => {
    if (!backend) return
    setStatus('保存中...')
    try {
      const resp = await fetch('/api/doc/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc)
      })
      if (resp.ok) {
        // 下载文件
        const blob = await resp.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const title = doc.meta?.title || 'untitled'
        a.download = `${title}.docx`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        setStatus('已保存为 docx 文件')
      } else {
        const errText = await resp.text()
        setStatus(`保存失败: ${errText}`)
      }
    } catch (e: any) {
      setStatus(`保存失败: ${e.message}`)
    }
  }

  const handleLearnWord = async (word: string) => {
    if (!backend) return
    await backend.learnWord(word, lang, 'manual')
    setStatus(`已学习: ${word}`)
    // 重新检查
    triggerSpellCheck(JSON.stringify(doc.blocks))
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 顶部菜单栏 */}
      <header className="bg-blue-600 text-white px-4 py-2 flex items-center gap-4 shadow-md">
        <div className="font-bold text-lg flex items-center gap-2">
          <span className="bg-white text-blue-600 px-2 py-0.5 rounded text-sm">Go</span>
          Office
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleOpenFile}
            className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-700 rounded"
          >文件</button>
          <button
            onClick={handleSave}
            className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-700 rounded"
          >保存</button>
          <button className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-700 rounded">编辑</button>
          <button className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-700 rounded">视图</button>
          <button className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-700 rounded">插入</button>
          <button className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-700 rounded">格式</button>
          <button className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-700 rounded">工具</button>
        </div>
        <div className="flex-1" />
        <div className="text-xs opacity-80">
          {backend?.mode === 'local' ? '本地模式 (Wails)' : '远程模式 (HTTP)'}
        </div>
      </header>

      {/* Tab 切换 */}
      <div className="bg-white border-b px-4 flex items-center gap-2">
        {(['document', 'spreadsheet', 'slide'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${
              tab === t
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'document' ? '📄 文档' : t === 'spreadsheet' ? '📊 表格' : '🎞 演示'}
          </button>
        ))}
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">语言:</span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as 'en' | 'zh')}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
          <span className="text-xs text-gray-400">
            {spellErrors.length > 0 && `${spellErrors.length} 个拼写错误`}
          </span>
        </div>
      </div>

      {/* 主编辑区 */}
      <main className="flex-1 overflow-hidden">
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
      <footer className="bg-gray-800 text-white text-xs px-4 py-1 flex items-center gap-4">
        <span>{status || '就绪'}</span>
        {filePath && <span className="text-gray-400">| {filePath}</span>}
        <div className="flex-1" />
        <span>GoOffice v0.1.0</span>
      </footer>

      {/* 拼写错误浮窗 */}
      {spellErrors.length > 0 && (
        <div className="fixed bottom-8 right-8 bg-white shadow-xl rounded-lg border max-w-sm max-h-96 overflow-auto">
          <div className="px-4 py-2 border-b bg-red-50 flex items-center justify-between">
            <span className="text-sm font-semibold text-red-700">
              拼写检查 ({spellErrors.length})
            </span>
            <button
              onClick={() => setSpellErrors([])}
              className="text-gray-400 hover:text-gray-600"
            >×</button>
          </div>
          <div className="divide-y">
            {spellErrors.slice(0, 10).map((e, i) => (
              <div key={i} className="px-4 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-red-600 font-mono">{e.word}</span>
                  <button
                    onClick={() => handleLearnWord(e.word)}
                    className="text-xs text-blue-500 hover:underline"
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
