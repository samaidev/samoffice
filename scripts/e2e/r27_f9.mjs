// CAPTURE+BUBBLE 探针都命中 —— mousedown 完整派发到 proxy！
// 但产品 handler（也是 bubble listener）没产生 dispatch。
// → 产品 handler【在派发前就被移除/未挂上】！
// ensureProxy 里 addEventListener 的位置：看代码顺序 —— 
// proxy.addEventListener('mousedown', ...) 在 host.appendChild 之前 —— 挂了。
// ★ 除非 —— 产品 handler 挂的 proxy 与屏上的 proxy 不是同一个元素！
//（管理器建了【2 个 proxy】？f5 只查 querySelector 第一个！）
// 2s 波次建一个、4s 波次 ensureProxy 被 proxies.has 挡住 —— 1 个。
// ★★ 但如果【DocumentEditor 被 React 重新挂载】（StrictMode/HMR/props）：
// 旧 effect cleanup（disposed=true → proxy.remove()）+ 新 effect 新 onFirst
// —— 但 onFirst 需要再次 pointerdown —— 不再有 —— 新实例无 proxy！
// 屏上的 proxy 是【旧实例的】（cleanup remove 了吗？—— disposed 后
// scheduleSync 早退 —— 但已建的 proxy 在 cleanup 里 for remove —— 
// 移除了）。屏上有 proxy = 某实例活着。
// ◆ 探针命中其 mousedown（capture+bubble）—— 元素收到事件 ——
// 它的【产品 handler】也在该元素上 —— 必然执行 —— 除非 handler 里
// viewRef.current 为 null（HMR 旧闭包）→ return —— 【无异常无 dispatch】
// ★★★ 但这是干净 vite（无 HMR）…… StrictMode 双挂载呢？生产 build
// 无 StrictMode？查 main.tsx：
import { execSync } from 'child_process'
console.log(execSync('grep -n "StrictMode" frontend/src/main.tsx', { encoding: 'utf8' }))

// 再看：双挂载下第一实例 effect cleanup 会 remove proxies —— 
// 但 onFirst 已触发过（首个 pointerdown 在第一实例存活期？不 —— 
// 双挂载发生在 mount 时，早于用户点击）—— 点击时只有第二实例的
// onFirst 在监听 → 第二实例建 proxy（viewRef 是第二实例的 → current 有值）
// → handler 应该跑 —— 
// ★★★★ 除非 __setDocForTest 导致 DocumentEditor【key 变化重挂载】！
// （document prop 换 → 编辑器重挂 → 又是单实例 —— 没问题）
// ◆ 直接验证 viewRef：在 handler 里 console.log 产品代码不可改 —— 
// 但可以查【屏上 proxy 是否被 cleanup 后又重建】（proxy 出现时间戳）：
