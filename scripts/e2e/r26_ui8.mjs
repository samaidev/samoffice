// 重建后 evaluate twin 依然活！但同区域「DocTableView 建」的 proxy 死。
// evaluate vs DocTableView —— 彻底排除法：唯一剩余差异 =
// **proxy 创建后【ResizeObserver 的初始回调】在 PM 事务后立即同步
// 触发 syncProxyGeometry**（RO 初始回调是微任务/帧首 —— 在 React
// commit 批处理内）→ 又是「事务栈内写样式」。
// 而 ui5 twin 无 RO。fv10 ro-full 有 RO 但 observe 的 handler 为空 —— 
// 没有写 style！RO 回调里【写 style】才是关键 —— 
// 「在 RO 回调（渲染管线内）写 style 的层」被标记为合成器私有 → 死！
// ★★★ 修法：syncProxyGeometry 的 style 写入移出 RO 回调 —— 
// RO 回调只 schedule 一个 setTimeout（空闲栈）再写。
import { execSync } from 'child_process'
const src = `frontend/src/editors/document/tablePlugins.ts`
let s = execSync(`cat ${src}`, { encoding: 'utf8' })
const old = `        this.proxyRo = new ResizeObserver(() => this.syncProxyGeometry())
        this.proxyRo.observe(this.dom)
        this.proxyRo.observe(pmDom)
        const scroller = pmDom.closest('.overflow-auto')
        if (scroller) {
          this.proxyScrollFn = () => this.syncProxyGeometry()
          scroller.addEventListener('scroll', this.proxyScrollFn, { passive: true })
        }`
const neu = `        // round26 关键：几何写入绝不能在 ResizeObserver 回调（渲染管线内）
        // 同步执行 —— 实测（r26_ui5~8）在渲染批次内写 style 的层会被
        // Chromium 合成器排除出 hit-test（事件永不派发）。RO/scroll 只
        // schedule，真正的 style 写入推迟到事件循环空闲（setTimeout 0）。
        const scheduleSync = () => {
          if (this.proxySyncTimer) return
          this.proxySyncTimer = window.setTimeout(() => {
            this.proxySyncTimer = 0
            this.syncProxyGeometry()
          }, 0)
        }
        this.proxyRo = new ResizeObserver(scheduleSync)
        this.proxyRo.observe(this.dom)
        this.proxyRo.observe(pmDom)
        const scroller = pmDom.closest('.overflow-auto')
        if (scroller) {
          this.proxyScrollFn = scheduleSync
          scroller.addEventListener('scroll', this.proxyScrollFn, { passive: true })
        }`
if (!s.includes(old)) { console.error('ANCHOR NOT FOUND'); process.exit(1) }
s = s.replace(old, neu)
// syncProxyGeometry 的初始直调也要改成延后
const old2 = `        host.appendChild(proxy)
        this.proxyEl = proxy
        this.syncProxyGeometry()`
const neu2 = `        host.appendChild(proxy)
        this.proxyEl = proxy
        // 首次几何写入也延后一帧（同上：避开渲染批次）
        window.setTimeout(() => this.syncProxyGeometry(), 0)`
if (!s.includes(old2)) { console.error('ANCHOR2 NOT FOUND'); process.exit(1) }
s = s.replace(old2, neu2)
// proxySyncTimer 字段 + destroy 清理
const old3 = `  private proxyEl: HTMLElement | null = null
  private proxyRo: ResizeObserver | null = null
  private proxyScrollFn: (() => void) | null = null`
const neu3 = `  private proxyEl: HTMLElement | null = null
  private proxyRo: ResizeObserver | null = null
  private proxyScrollFn: (() => void) | null = null
  private proxySyncTimer: number = 0`
if (!s.includes(old3)) { console.error('ANCHOR3 NOT FOUND'); process.exit(1) }
s = s.replace(old3, neu3)
const old4 = `    if (this.proxyEl) { this.proxyEl.remove(); this.proxyEl = null }
  }
}`
const neu4 = `    if (this.proxySyncTimer) { window.clearTimeout(this.proxySyncTimer); this.proxySyncTimer = 0 }
    if (this.proxyEl) { this.proxyEl.remove(); this.proxyEl = null }
  }
}`
if (!s.includes(old4)) { console.error('ANCHOR4 NOT FOUND'); process.exit(1) }
s = s.replace(old4, neu4)
execSync(`cat > ${src} << 'SAMEOF'\n${s}\nSAMEOF`, { encoding: 'utf8' })
console.log('RO deferred write applied')
