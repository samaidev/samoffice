import type { Backend, Document, SpellError, Candidate, Warning } from '../types/udm'

// 检测是否在 Wails 本地环境
declare global {
  interface Window {
    go?: {
      main?: {
        App?: {
          OpenFile: (path: string) => Promise<{ document: Document; warnings: Warning[]; path: string }>
          SpellCheck: (text: string, lang: string) => Promise<SpellError[]>
          Suggest: (word: string, lang: string, n: number) => Promise<Candidate[]>
          LearnWord: (word: string, lang: string, source: string) => Promise<void>
          HTTPPort: () => Promise<number>
          GetStartupArgs: () => Promise<string[]>
          OpenFileDialog: () => Promise<string>
          ReadFile: (path: string) => Promise<string>
          SaveFileDialog: (defaultName: string, format: string) => Promise<string>
          WriteDocument: (path: string, format: string, document: Document) => Promise<void>
        }
      }
    }
  }
}

// RemoteBackend 通过 HTTP API 与服务端通信
export class RemoteBackend implements Backend {
  mode: 'local' | 'remote' = 'remote'
  baseUrl: string

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl
  }

  async openFile(path: string): Promise<{ document: Document; warnings: Warning[]; path: string }> {
    const url = `${this.baseUrl}/api/doc/local?path=${encodeURIComponent(path)}`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`openFile: ${r.status} ${await r.text()}`)
    return r.json()
  }

  async getStartupArgs(): Promise<string[]> { return [] }

  async uploadFile(file: File): Promise<{ document: Document; warnings: Warning[] }> {
    const form = new FormData()
    form.append('file', file)
    const r = await fetch(`${this.baseUrl}/api/doc/open`, { method: 'POST', body: form })
    if (!r.ok) throw new Error(`uploadFile: ${r.status} ${await r.text()}`)
    return r.json()
  }

  async spellCheck(text: string, lang: string): Promise<SpellError[]> {
    const url = `${this.baseUrl}/api/dict/check?text=${encodeURIComponent(text)}&lang=${lang}`
    const r = await fetch(url)
    if (!r.ok) return []
    const data = await r.json()
    return data.errors || []
  }

  async suggest(word: string, lang: string, n = 5): Promise<Candidate[]> {
    const url = `${this.baseUrl}/api/dict/suggest?word=${encodeURIComponent(word)}&lang=${lang}&n=${n}`
    const r = await fetch(url)
    if (!r.ok) return []
    const data = await r.json()
    return data.candidates || []
  }

  async learnWord(word: string, lang: string, source = 'manual'): Promise<void> {
    await fetch(`${this.baseUrl}/api/dict/learn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, lang, source })
    })
  }

  // 远程模式无原生对话框，返回 '' 让调用方回退到浏览器下载
  async openFileDialog(): Promise<string> { return '' }
  async saveFileDialog(_defaultName: string, _format: string): Promise<string> { return '' }
  async readFile(_path: string): Promise<string> { throw new Error('readFile not supported in remote mode') }
  async writeDocument(_path: string, _format: string, _document: Document): Promise<void> {
    throw new Error('writeDocument not supported in remote mode')
  }
}

// LocalBackend 通过 Wails Binding 与本地 Go 进程通信
export class LocalBackend implements Backend {
  mode: 'local' | 'remote' = 'local'

  private get app() {
    return window.go?.main?.App
  }

  static isAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.go?.main?.App
  }

  async openFile(path: string): Promise<{ document: Document; warnings: Warning[]; path: string }> {
    if (!this.app) throw new Error('Wails binding not available')
    return this.app.OpenFile(path)
  }

  async getStartupArgs(): Promise<string[]> {
    if (!this.app || !this.app.GetStartupArgs) return []
    try {
      const args = await this.app.GetStartupArgs()
      return Array.isArray(args) ? args : []
    } catch {
      return []
    }
  }

  async uploadFile(_file: File): Promise<{ document: Document; warnings: Warning[] }> {
    throw new Error('Local mode uses openFile(path), not uploadFile')
  }

  async spellCheck(text: string, lang: string): Promise<SpellError[]> {
    if (!this.app) return []
    return this.app.SpellCheck(text, lang)
  }

  async suggest(word: string, lang: string, n = 5): Promise<Candidate[]> {
    if (!this.app) return []
    return this.app.Suggest(word, lang, n)
  }

  async learnWord(word: string, lang: string, source = 'manual'): Promise<void> {
    if (!this.app) return
    await this.app.LearnWord(word, lang, source)
  }

  async openFileDialog(): Promise<string> {
    if (!this.app) return ''
    return this.app.OpenFileDialog()
  }

  async readFile(path: string): Promise<string> {
    if (!this.app) throw new Error('Wails binding not available')
    return this.app.ReadFile(path)
  }

  async saveFileDialog(defaultName: string, format: string): Promise<string> {
    if (!this.app) return ''
    return this.app.SaveFileDialog(defaultName, format)
  }

  async writeDocument(path: string, format: string, document: Document): Promise<void> {
    if (!this.app) throw new Error('Wails binding not available')
    return this.app.WriteDocument(path, format, document)
  }
}

// 自动选择 backend
export function createBackend(): Backend {
  if (LocalBackend.isAvailable()) {
    console.log('[SamOffice] Using LocalBackend (Wails)')
    return new LocalBackend()
  }
  console.log('[SamOffice] Using RemoteBackend (HTTP)')
  return new RemoteBackend()
}
