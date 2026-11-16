// 模拟查找完全成功（hit r0c0, tn="A1"）—— 但页面上的 addRange 记录=[]。
// 代码看起来正确却没执行 —— 唯一可能：HMR 没有更新 DocumentEditor 的
// 这个 effect（React fast-refresh 对空依赖数组 effect 的保留策略）。
// t1-t3 的页面都是【旧代码】！验证：检查 vite 是否推送过更新 +
// 硬 reload（context addInitScript 不需要 —— goto 新页面即可拿新代码，
// 但 Vite 的模块缓存 + 浏览器缓存可能给旧模块）。
// 直接对比：重启 vite + 新 context 重测。
import { execSync } from 'child_process'
try { execSync('pkill -f "vite.*18400" || true') } catch {}
try { execSync('pkill -f "npm run dev" || true') } catch {}
console.log('vite killed, restarting...')
