// WasmBackend — SamOffice 形态3（浏览器纯静态构建）的第三后端实现。
//
// 与 LocalBackend（Wails 绑定）/ RemoteBackend（HTTP 服务）并列：
//   - 主模块 samoffice.wasm：解析 + docx/xlsx/pptx 生成，首次使用时加载（仅 VITE_WEB_ONLY=1 构建启用）
//   - PDF 子模块 samoffice-pdf.wasm：内嵌 15MB 中文字体，只在导出 PDF 时懒加载
//   - File 字节直通：上传的原始字节缓存在 fileBytes，xlsx 原生读取（readXLSX）按文件名回取，
//     免二次传输，格式（合并/边框/填充）完整保留
//   - “保存”即下载：浏览器模式无磁盘路径概念，四类选项卡各自生成字节后触发浏览器下载
//
// 免字库是设计目标：不 import 词典(sqlite)，拼写检查在 wasm 模式返回空结果，
// 审阅页的拼写按钮在 DocumentEditor 中按 mode 隐藏。
import type { Backend, BackendMode, Document, SpellError, Candidate, Warning } from '../types/udm'

declare global {
  interface Window {
    Go?: any           // wasm_exec.js 注入的 Go 运行时
    samoffice?: any    // 主模块全局对象（cmd/samoffice-wasm）
    samofficePdf?: any // PDF 子模块全局对象（cmd/samoffice-wasm-pdf，懒加载后才有）
  }
}

const MAIN_WASM = 'samoffice.wasm'
const PDF_WASM = 'samoffice-pdf.wasm'
const WASM_EXEC = 'wasm_exec.js'

// 把字节触发为浏览器下载（“保存即下载”）
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// 大数组 base64：分块处理，避免 btoa/atob 在大文件上的栈溢出与二进制截断
function b64encode(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function basename(p: string): string {
  return (p || '').split(/[\\/]/).pop() || ''
}

function sanitizeName(name: string): string {
  return (name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled'
}

// 从“路径或空串”推导下载文件名：有扩展名用原名；否则回退 title/ext
function nameFor(path: string, title: string, ext: string): string {
  const base = basename(path)
  if (base && /\.[A-Za-z0-9]+$/.test(base)) return sanitizeName(base)
  const t = sanitizeName(title || 'untitled')
  return /\.[A-Za-z0-9]+$/.test(t) ? t : `${t}.${ext}`
}

export class WasmBackend implements Backend {
  mode: BackendMode = 'wasm'

  private ready: Promise<void> | null = null
  private pdfReady: Promise<void> | null = null
  // 上传文件名(小写) → 原始字节；readXLSX 直通取用
  private fileBytes = new Map<string, Uint8Array>()

  // 形态3 只在 build:web（VITE_WEB_ONLY=1）产物中启用
  static isWebOnly(): boolean {
    return import.meta.env.VITE_WEB_ONLY === '1'
  }

  // ---------- wasm 运行时加载 ----------

  private loadScriptOnce(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const exist = document.querySelector(`script[data-wasm-src="${src}"]`)
      if (exist) return resolve()
      const s = document.createElement('script')
      s.src = src
      s.dataset.wasmSrc = src
      s.onload = () => resolve()
      s.onerror = () => reject(new Error(`加载 ${src} 失败`))
      document.head.appendChild(s)
    })
  }

  private async instantiate(wasmUrl: string): Promise<void> {
    const go = new window.Go()
    try {
      // 优先 streaming（服务器需返回 application/wasm MIME）；失败回退 arrayBuffer
      const res = await WebAssembly.instantiateStreaming(fetch(wasmUrl), go.importObject)
      go.run(res.instance)
    } catch {
      const buf = await (await fetch(wasmUrl)).arrayBuffer()
      const res = await WebAssembly.instantiate(buf, go.importObject)
      go.run(res.instance)
    }
  }

  // 主模块：首次调用任何能力时加载一次
  private async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.loadScriptOnce(WASM_EXEC)
        await this.instantiate(MAIN_WASM)
        if (!window.samoffice) throw new Error('samoffice.wasm 未注册全局对象')
        console.log('[SamOffice] WASM 主模块就绪', window.samoffice.version())
      })()
      this.ready.catch(() => { this.ready = null }) // 失败允许重试
    }
    return this.ready
  }

  // PDF 子模块：只在导出 PDF 时懒加载（内嵌 15MB 字体，避免拖累首屏）
  private async ensurePdf(): Promise<any> {
    if (!this.pdfReady) {
      this.pdfReady = (async () => {
        await this.loadScriptOnce(WASM_EXEC)
        await this.instantiate(PDF_WASM)
        if (!window.samofficePdf) throw new Error('samoffice-pdf.wasm 未注册全局对象')
        console.log('[SamOffice] WASM PDF 子模块就绪（懒加载完成）', window.samofficePdf.version())
      })()
      this.pdfReady.catch(() => { this.pdfReady = null })
    }
    await this.pdfReady
    return window.samofficePdf
  }

  // ---------- 打开链路 ----------

  async openFile(_path: string): Promise<{ document: Document; warnings: Warning[]; path: string }> {
    throw new Error('readFile not supported in wasm mode: 用 uploadFile 传 File 字节')
  }

  async uploadFile(file: File): Promise<{ document: Document; warnings: Warning[] }> {
    await this.ensureReady()
    const bytes = new Uint8Array(await file.arrayBuffer())
    this.fileBytes.set(file.name.toLowerCase(), bytes)
    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop()!.toLowerCase() : ''
    const r = await window.samoffice.parse(ext, b64encode(bytes))
    if (!r || !r.ok) throw new Error(r?.error || 'wasm parse 失败')
    const doc = typeof r.doc === 'string' ? JSON.parse(r.doc) : r.doc
    // Go 侧 warnings 走 JSON 字符串中转（syscall/js ValueOf 不支持结构体切片）
    let warnings: Warning[] = []
    if (typeof r.warnings === 'string' && r.warnings) {
      try { warnings = JSON.parse(r.warnings) } catch { warnings = [] }
    } else if (Array.isArray(r.warnings)) {
      warnings = r.warnings
    }
    return { document: doc, warnings }
  }

  // 原生 xlsx 读取（合并/边框/填充全保留）：参数与接口一致（路径字符串），
  // 字节从 fileBytes 按文件名回取 —— App.openResult 传 serverPath || path，
  // wasm 模式下上传时已缓存原始字节，这里直通
  async readXLSX(pathOrBytes: string | Uint8Array): Promise<string> {
    await this.ensureReady()
    let bytes: Uint8Array | undefined
    if (typeof pathOrBytes === 'string') {
      const key = pathOrBytes.toLowerCase()
      if (this.fileBytes.has(key)) {
        bytes = this.fileBytes.get(key)
      } else {
        // 兜底：路径与缓存名互为后缀（serverPath/相对路径差异）
        for (const [k, v] of this.fileBytes) {
          if (key.endsWith(k) || k.endsWith(key)) { bytes = v; break }
        }
      }
    } else {
      bytes = pathOrBytes
    }
    if (!bytes) throw new Error(`readXLSX: 找不到文件字节（wasm 模式）: ${pathOrBytes}`)
    const r = await window.samoffice.readXLSXBytes(b64encode(bytes))
    if (!r || !r.ok) throw new Error(r?.error || 'wasm readXLSXBytes 失败')
    return r.workbook
  }

  // ---------- 保存链路（保存即下载） ----------

  async writeDocument(path: string, format: string, document: Document): Promise<void> {
    await this.ensureReady()
    if (format === 'pdf') {
      const bytes = await this.exportPdf(document)
      downloadBlob(new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }), nameFor(path, document?.meta?.title || '', 'pdf'))
      return
    }
    const r = await window.samoffice.renderDocx(JSON.stringify(document))
    if (!r || !r.ok) throw new Error(r?.error || 'wasm renderDocx 失败')
    const bytes = b64decode(r.data)
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    downloadBlob(new Blob([bytes as unknown as BlobPart], { type: mime }), nameFor(path, document?.meta?.title || '', format || 'docx'))
  }

  async writeXLSX(path: string, json: string): Promise<void> {
    await this.ensureReady()
    const r = await window.samoffice.writeXLSX(json)
    if (!r || !r.ok) throw new Error(r?.error || 'wasm writeXLSX 失败')
    const bytes = b64decode(r.data)
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    downloadBlob(new Blob([bytes as unknown as BlobPart], { type: mime }), nameFor(path, '', 'xlsx'))
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    const name = nameFor(path, '', 'txt')
    downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), name)
  }

  async writePPTX(path: string, json: string): Promise<void> {
    await this.ensureReady()
    const r = await window.samoffice.writePPTX(json)
    if (!r || !r.ok) throw new Error(r?.error || 'wasm writePPTX 失败')
    const bytes = b64decode(r.data)
    const mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    downloadBlob(new Blob([bytes as unknown as BlobPart], { type: mime }), nameFor(path, '', 'pptx'))
  }

  // PDF 懒加载导出（handleDownload 的 wasm 分支专用；不在 Backend 接口内）
  async exportPdf(document: Document): Promise<Uint8Array> {
    const mod = await this.ensurePdf()
    const r = await mod.renderPdf(JSON.stringify(document))
    if (!r || !r.ok) throw new Error(r?.error || 'wasm renderPdf 失败')
    return b64decode(r.data)
  }

  // ---------- 不适用能力的契约对齐 ----------

  // 浏览器模式无原生对话框
  async openFileDialog(): Promise<string> { return '' }
  async saveFileDialog(_defaultName: string, _format: string): Promise<string> { return '' }
  async readFile(_path: string): Promise<string> { throw new Error('readFile not supported in wasm mode') }

  // 免字库设计：拼写检查返回空（审阅页按钮在 wasm 模式隐藏）
  async spellCheck(_text: string, _lang: string): Promise<SpellError[]> { return [] }
  async suggest(_word: string, _lang: string, _n = 5): Promise<Candidate[]> { return [] }
  async learnWord(_word: string, _lang: string, _source = 'manual'): Promise<void> { /* noop */ }

  async getStartupArgs(): Promise<string[]> { return [] }
}
