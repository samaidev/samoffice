// 仍死。冷静重审全部铁证：
// 1) evaluate 建（任何时刻含事务后 70ms）：活
// 2) DocTableView 建（任何延迟任何形式）：死
// 「同栈同时刻」只差【调用来源】—— 最后一层窗户纸被捅破的方式：
// **把 DocTableView 的 setup 代码原封不动搬到 evaluate 执行**！
// 用页面上的 window.__runSetup = () => setup() 导出 —— 不改产品代码
// 不行。反过来：让 evaluate 直接调用【页面模块里的 DocTableView 逻辑】
// —— 模块打包了。 
// ◆◆◆ 换终极验证法：在 setup 的 setTimeout 回调里用 console.log 打点
// 确认执行 + 然后【在回调内同步建第二个 twin】（同一栈！）：
// 若同栈 twin 活而 proxy 死 → 排除「栈」→ 只剩 DOM 细节；
// 若同栈 twin 也死 → 「栈」就是因子 → 修法 = proxy 创建移到微任务外
//   （如 postMessage/MessageChannel）。
// 改代码加调试（临时）：
import { execSync } from 'child_process'
let s = execSync('cat frontend/src/editors/document/tablePlugins.ts', { encoding: 'utf8' })
const old = `        const proxy = document.createElement('div')
        proxy.className = 'pm-table-clickproxy'`
const neu = `        const proxy = document.createElement('div')
        proxy.className = 'pm-table-clickproxy'
        // r26-debug: 同栈 twin
        try {
          const w = this.dom
          const wr2 = w.getBoundingClientRect(), hr2 = host.getBoundingClientRect()
          const t = document.createElement('div')
          t.dataset.stacktwin = '1'
          t.style.cssText = 'position:absolute;left:' + (wr2.left - hr2.left + 6) + 'px;top:' + (wr2.top - hr2.top) + 'px;width:' + (wr2.width - 12) + 'px;height:' + wr2.height + 'px;z-index:8;background:rgba(0,0,0,0.003)'
          ;(window as any).__stHit = ''
          t.addEventListener('mousedown', () => { (window as any).__stHit = 'stack-twin' })
          host.appendChild(t)
        } catch { /* debug only */ }`
if (!s.includes(old)) { console.error('ANCHOR NOT FOUND'); process.exit(1) }
s = s.replace(old, neu)
execSync('cat > frontend/src/editors/document/tablePlugins.ts << \'SAMEOF\'\n' + s + '\nSAMEOF', { encoding: 'utf8' })
console.log('stack-twin debug injected')
