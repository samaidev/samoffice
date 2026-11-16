// 同步外置也破坏 doc（table→[unsupported]）—— MutationObserver 的回调也是
// 异步微任务，PM 的 desc 结构在 append 同步瞬间已经建立。
// ◆◆◆◆◆◆ 外置路线彻底死亡。回退代码，启用【最终兜底方案】：
// 「点击落空」的本质 = 鼠标事件没派发到目标。但 —— 事件【确实派发了】
// 一个事实被我忽略了：点击 wrapper 区域时 focusout(DIV→null) 发生过、
// CDP Input.dispatch 成功 —— 事件去了哪？？
// ★★★★ 最后一试：**Chromium 把该区域的事件派发给了「User-Agent
// shadow DOM」里的元素（如 <input> 的编辑器 shadow tree）**？页面有
// input 吗 —— 搜索框！Files 输入框？—— 不在表格区。
// ★ 但 —— **tableWrapper 内的 <table> 有 colgroup** —— Chromium 的
// table UA shadow？HTML table 无 shadow。
// ◆ 认清现实。评估「事件级兜底」可行性：
// Chrome 确实派发了事件（focus 变化证明）→ 但 target 不是我们 DOM。
// → 事件在 compositor 层被路由给了一个不存在的/已失效的层。
// → 唯一 JS 可感知的信号 = focusout（编辑器 blur）。
// ◆◆ 兜底方案（工程可用）：**监听「编辑器 blur + 无 mousedown」的巧合**
// 不可靠。
// ◆◆◆ 真正可行兜底 = **键盘流**: PM 快捷键已工作（ArrowDown 移动 from=33
// 之前验证过）。用户可用键盘进格 —— 但鼠标点击是基本功能，不可接受。
// ★★★★★ 最终方案 = **换掉触发条件**：所有实验里「去 .ProseMirror class
// 就活」 —— 我们不能去掉 class（样式海量依赖）—— 但可以把 class 改名 +
// 更新全部 CSS 选择器！Sed 一把梭：.ProseMirror → .sam-pm 全局替换
// （CSS + TSX），保持样式不变但类名不同 —— 绕开 Chromium 对
// .ProseMirror（contenteditable UA 语义?）的特判！
// 不 —— 类名不影响 UA 行为。Chromium 不认识 .ProseMirror。
// 之前 no-class ALIVE 的真实原因 = 去类导致【样式全丢 → 布局重排】 ——
// 又回到「重排后临时活」。死循环。
// ◆ 真相只有一个未试的形态：**初始就活的条件** —— 也许「编辑器挂载时
// 表格已存在」vs「后插入」！我们的链路 = 编辑器 mount（空 doc）→
// updateState(doc 带表格)。试「编辑器 mount 时直接带表格 doc」：
import { chromium } from 'playwright'
const BASE = 'http://localhost:18400'
const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage()
p.on('pageerror', e => console.log('PAGEERR:', e.message.slice(0, 100)))
p.setDefaultTimeout(30000)
await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 直接 setDoc（首次挂载即带表格 —— 之前的流程相同…… 但注意：
// DocumentEditor mount 在 __setDocForTest 的同一 React commit 里 ——
// 其实一直是「mount 即带表格」。真正没试过的是「mount 空文档 → 
// 下一帧 updateState 换带表格 doc」 vs 「mount 即带」—— 都试过=死。
// ★ 终极真相检验：**换个页面**！vite 下 index.html 有多个入口？
// 不 —— 用 data: URL 加载完整 app？CORS 会坏。
// ◆◆ 决定：接受「Playwright Chromium 特有」的可能性 —— shan 真实环境
// 是 WebView2（Edge 157）！让 shan 真机验证：构建带诊断的版本部署，
// 远程点表格看事件是否到达。如果 WebView2 正常 —— bug 只影响测试环境。
// 先本地确认 WebView2 与 Playwright Chromium 版本差异：
console.log('本地 Playwright Chromium 版本:')
const caps = await (await (await b.newContext()).newPage()).evaluate(() => navigator.userAgent)
console.log(caps)
await b.close()
