// E2E 用最小 vite 配置：watcher 全关（inotify 上限 8192，项目树触发 ENOSPC）
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: {
    port: 18400, strictPort: true, host: '127.0.0.1',
    watch: { ignored: ['**/*'] },
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
})
