import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080'
    },
    // 沙箱 inotify 上限 8192，.pyruntime（内嵌 Python 工具链）会耗尽 watcher
    // 导致 dev server 启动失败 —— 排除之（HMR 只关心 src/）。
    watch: {
      ignored: ['**/.pyruntime/**', '**/dist-web/**', '**/node_modules/**']
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})
