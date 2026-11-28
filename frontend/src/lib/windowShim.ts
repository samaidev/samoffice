// macOS WKWebView 不支持 window.alert（无 UI、直接返回），Wails v2 也没有提供
// runJavaScriptAlertPanel 代理 —— 于是所有用 alert 提示的地方在 Mac 上「点了没反应」。
// alert 的返回值没人用，所以这里用同步的浮动提示替换它，调用点无需改动。

let host: HTMLDivElement | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

function ensureHost(): HTMLDivElement {
  if (host && document.body.contains(host)) return host
  const el = document.createElement('div')
  el.setAttribute('data-sam-toast', '1')
  el.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:48px', 'transform:translateX(-50%)',
    'max-width:min(560px,88vw)', 'padding:10px 14px', 'border-radius:10px',
    'background:rgba(17,24,39,0.94)', 'color:#fff', 'font-size:13px', 'line-height:1.5',
    'box-shadow:0 8px 24px rgba(0,0,0,0.28)', 'z-index:100000', 'pointer-events:none',
    'white-space:pre-wrap', 'word-break:break-word', 'opacity:0', 'transition:opacity .18s ease',
  ].join(';')
  document.body.appendChild(el)
  host = el
  return el
}

export function showAlert(message: string) {
  const text = String(message ?? '')
  if (!text) return
  try {
    const el = ensureHost()
    el.textContent = text
    el.style.opacity = '1'
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => { el.style.opacity = '0' }, Math.min(6000, 1800 + text.length * 40))
  } catch {
    // 极端情况下退化为控制台输出，保证不抛错
    console.warn('[alert]', text)
  }
}

export function installWindowShim() {
  const w = window as unknown as { alert: (msg?: unknown) => void }
  w.alert = (msg?: unknown) => showAlert(msg == null ? '' : String(msg))
}
