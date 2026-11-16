// 都活！与正式 proxy 的差异只剩【mousedown handler 的行为】：
// fv18 的 handler 只计数。正式 handler 有 `if (e.button !== 0) return` 和
// cellAtPoint + preventDefault。但 fv11 full-handler 全有（活）—— 
// 除了一个：**正式 handler 里 `this.cellAtPoint()` 若抛异常或耗时** —— 
// 无关到达（capture 计数先跑）。
// ◆◆◆ 全部手工复刻活、正式死 —— 最后一根稻草：**HMR！**
// 页面上跑的 DocTableView 是【旧版本闭包】（HMR 快速刷新只重载组件，
// class 实例的旧模块仍被 React 引用）。旧版本的 attachClickProxy 是
// 早期形态（transparent 背景 + rAF）！fv9 读到 bg=rgba(0,0,0,0.004)
// —— 0.004 是我们最新代码的值（0.003）？—— 0.004 ≠ 0.003！
// ★ 那是 dbg9 时期手动改的 0.004 残留？—— 不，页面是新开的。
// vite 转换 rgba(0,0,0,0.003) → 计算值 rgba(0,0,0,0.004)? 
// NO —— computed style 的 alpha 精度！0.003*255≈0.765 → 四舍五入 1/255=0.004！
// 说明跑的【就是新代码】。那 0.004 是 computed 精度 —— 代码正确。
// ◆◆◆ 疯狂但必须：**重启 vite + 硬刷新**（清 HMR 状态）再测：
import { execSync } from 'child_process'
execSync('pkill -f "vite --port 18400" || true', { encoding: 'utf8' })
execSync('pkill -f "npm run dev" || true', { encoding: 'utf8' })
console.log('vite killed')
