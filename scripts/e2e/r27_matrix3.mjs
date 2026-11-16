// HMR 没刷 —— 用硬重启后再测；同时数 proxy（1=守卫生效）：
import { execSync } from 'child_process'
execSync('pkill -f "vite.*18400"; sleep 1; pkill -f "npm run dev" || true', shell=True)
console.log('restarting vite...')
