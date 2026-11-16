// near(23~25) 全给 25（正确：cell 内 p 的文本位）！
// 那么 SEL:52 的 dispatch 根本不是这段代码发出的 ——
// 是【点击的 PM 原生行为】（点击 td 文本 → PM 自身 selection 处理
// → 光标到 cell 末尾 52? cell0 的内容范围 24-26，52 超出 —— 
// 52 是【表格后段落】的位置 —— PM 的 posAtCoords 失败回退 doc 末尾?）
// ◆ 也就是说：proxy 的 mousedown handler 可能【没跑】，from=52 是
// PM 处理原生 mousedown 的结果！t8 的 dispatch 劫持记录 SEL:52 —— 
// 但那也可能是 PM 原生 dispatch！
// ★ 判定：preventDefault 了吗？若 handler 跑了 preventDefault → PM
// 收不到原生事件 → PM 不该 dispatch。但 SEL:52 存在 → 要么 handler
// 跑了（dispatch from=52 不可能，near 都给 25）—— 矛盾！
// 结论：handler 【确实没跑】，52 全部来自 PM 原生。proxy mousedown
// 没触发。之前 r27_t8 劫持时机【在点击前】—— dispatch 记录的 SEL:52
// 是 PM 原生的。
// ★ 那为什么 fv22 同名新层能收到 mousedown？！—— fv22 建层于
// 【交互后 evaluate】。管理器建层于【首次交互的 scheduleSync 120ms
// setTimeout 内】—— 也许 120ms 仍在「交互批次」内 → 死层！
// fv17 twin 建于交互后 70ms —— 活…… 但那是 evaluate 的 timer。
// ◆ 管理器的 timer 是 React effect 里的 —— 也许 effect 首次运行时
// 注册的 setTimeout 与 PM flush 关联。
// ★ 修：把 ensureProxy 的执行再延一层（交互后 400ms）且每帧重试
// 直到「验证事件真的到达」—— 或者最稳：用「自身验证重建」循环：
// 建层后发一个合成 mousedown 测试，若 5s 内无响应则【删除重建】。
// 简单点：先试「交互后再等 400ms 建」：
import { execSync } from 'child_process'
let s = execSync('cat frontend/src/editors/document/DocumentEditor.tsx', { encoding: 'utf8' })
const old = `    const onFirst = () => {
      window.document.removeEventListener('pointerdown', onFirst, true)
      if (disposed) return
      scheduleSync()`
const neu = `    const onFirst = () => {
      window.document.removeEventListener('pointerdown', onFirst, true)
      if (disposed) return
      // 建层推迟到交互后 400ms：交互批次内（含紧随的 PM flush）创建的
      // 层会进 hit-test 死名单（r26_fv22/ui5 对照）—— 必须等批次彻底结束
      window.setTimeout(() => { if (!disposed) scheduleSync() }, 400)
      // 兜底：再排一次（若首波 wrapper 还没渲染完）
      window.setTimeout(() => { if (!disposed) scheduleSync() }, 1200)`
if (!s.includes(old)) { console.error('ANCHOR MISSING'); process.exit(1) }
s = s.replace(old, neu)
execSync('cat > frontend/src/editors/document/DocumentEditor.tsx << \'SAMEOF2\'\n' + s + '\nSAMEOF2', { encoding: 'utf8' })
console.log('delay 400/1200 applied')
