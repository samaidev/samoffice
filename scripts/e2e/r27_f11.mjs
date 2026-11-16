// proxy 时间线：只在 +5132ms 出现一次（4s 波次后）—— 
// ★★★ 2s 波次（+3132 应有）没建！为什么？
// onFirst 触发于首次 pointerdown（~t=4500+ 一点）—— 2s 后 = +6500?
// 不对 —— 时间线 t0 = MO 挂载时刻。proxy 在 +5132 —— 
// 点击正文在 ~+2600（3000+wait）→ 2s 波次=+4600、4s 波次=+6600。
// +5132 两个都不匹配 —— 而且只有一次。
// ★ 也许 onFirst 触发更早（点击在 +2600，channel(2000)=+4600 —— 
// MO 挂载 +100 —— 差 500ms 内）—— 数值模糊。
// 监听器正确挂在 proxy（mousedown/bub + mouseup/bub）—— 产品 handler 在！
// 但点击后无 dispatch —— handler 执行到某处 return。
// ★★★ 唯一没验证的：handler 里 viewRef.current —— StrictMode 双挂载
// 后【旧 effect 闭包的 viewRef】是【已卸载组件】的 ref → current=null！
// 时间线只一个 proxy（+5132）—— 双挂载的两实例：第一实例 effect
// 挂载即跑（无 pointerdown 前就 cleanup）—— onFirst 从未触发；
// 第二实例的 onFirst 等点击 → 建 proxy。第二实例 viewRef.current 有值。
// —— handler 应正常……
// ◆◆◆ 除非点击落在【第一实例的 onFirst】（两实例都注册了 document
// capture pointerdown！第一实例 cleanup removeEventListener —— 卸载了
// —— 不会）。 
// ★ 直接测：给 viewRef.current 补一个 window.__probeView 看它是否为空
// 不可能（产品闭包）。改用【排除法】：临时在产品 handler 首行加
// window.__dbg = 'handler-entered' —— 一行日志快速定位：
import { execSync } from 'child_process'
let s = execSync('cat frontend/src/editors/document/DocumentEditor.tsx', { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
const old = `      proxy.addEventListener('mousedown', (e: MouseEvent) => {
        if (e.button !== 0) return
        const v = viewRef.current
        if (!v) return`
const neu = `      proxy.addEventListener('mousedown', (e: MouseEvent) => {
        ;(window as any).__r27dbg = { entered: true, btn: e.button, hasView: !!viewRef.current }
        if (e.button !== 0) return
        const v = viewRef.current
        if (!v) { (window as any).__r27dbg.noView = true; return }`
if (!s.includes(old)) { console.error('ANCHOR MISSING'); process.exit(1) }
s = s.replace(old, neu)
open('frontend/src/editors/document/DocumentEditor.tsx', 'w').write(s)
console.log('debug added')
