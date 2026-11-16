// 还是 SEL:52（PM 原生）。HMR 可能又没刷新 effect。这次【硬重启 vite】
// （t5 后已重启过一次，之后又改了代码）再测 t13。
import { execSync } from 'child_process'
try { execSync('pkill -f "vite.*18400"') } catch {}
try { execSync('pkill -f "npm run dev"') } catch {}
console.log('killed')
