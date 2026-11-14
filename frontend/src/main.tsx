import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import './index.css'

function logError(text: string) {
  let tries = 0
  const t = () => {
    try {
      const w = window as any
      if (w?.go?.main?.App?.LogError) { w.go.main.App.LogError(text); return }
    } catch {}
    if (tries++ < 80) setTimeout(t, 250)
  }
  t()
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    const text = 'BOUNDARY: ' + (err?.stack || err?.message || String(err)) + '\n' + (info?.componentStack || '')
    logError(text)
    console.error(err, info)
  }
  render() {
    if (this.state.err) {
      return <pre style={{ color: '#f44', background: '#111', padding: 16, whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0 }}>{'前端崩溃：\n' + (this.state.err.stack || this.state.err.message)}</pre>
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
)

// 渲染成功后上报（确认 window.go 就绪），用于验证前端是否真正渲染
setTimeout(() => logError('FRONTEND_RENDERED_OK'), 2000)
