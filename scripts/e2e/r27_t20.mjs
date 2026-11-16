// 全新缓存页面仍死。产品代码的 MC 也死 —— 
// 这推翻了「调度机制」理论。回到数据重审：
//   t16: evaluate 的 MC 建层 → 活
//   t19: 产品代码的 MC 建层 → 死
// 产品与 evaluate 的根本差异还没排除的只剩：
// ★★【React 的并发渲染把 effect 闭包内的代码标记为 'react scope'】
// —— Chrome DevTools 的 "React Scopes"?? 不存在于运行时。
// ★★★ 唯一物理可能：【产品代码建的 proxy 的 handler 里有 viewRef 引用】
// —— 无关到达。
// ◆◆◆ 绝境重生思路：别再研究「为什么死」—— 反过来：
// **让【活的 evaluate 层】出现在产品里** —— 产品的 JS 与 evaluate 的
// JS 同源！唯一区别是执行【上下文标签】。等等 —— 有个从没测过的：
// t16 里 MC 建层是在【页面已活 4.5s 且已点击 1 次】时。
// t19 里产品 MC 建层在【首次点击后 400ms】。
// ★ 时序差异：t16 的成功可能纯粹因为【更晚】！产品层建于
// 「首次交互后 400ms」，t16 层建于「首次交互后 ~2s」。 
// 而且中间隔了【第二次鼠标移动/点击事件】！
// ★★★ 假设：层必须创建于【一次完整的 pointer 事件序列之后】
//（pointerdown+up+click 全部结束且系统空闲）。「交互后 400ms」也许
// 恰逢 PM 的 decoration dispatch 批次 —— 那个批次由首次点击触发！
// （点击 → PM selection 事务 → 分页 recompute → dispatch decorations →
//  React setState → ... 400ms 后可能还在连锁批次里！）
// 修：把建层延迟加到 2000ms 试试（t16 的等效时刻）：
import { execSync } from 'child_process'
let ok = true
try { execSync("grep -q 'viaChannel(() => { if (!disposed) scheduleSync() }, 400)' frontend/src/editors/document/DocumentEditor.tsx", { cwd: '/home/z/my-project/samoffice' }) } catch { ok = false }
console.log('anchor exists:', ok)
