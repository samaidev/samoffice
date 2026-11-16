// 按下时 stillCell=false —— 谁把 CellSelection 压掉了？
// 放行路径：proxy return（无 pd）→ PM 的 DOMObserver 处理原生 mousedown
// → PM 的 tableEditing 插件（mousedown → 若无修饰键【收起 CellSelection 为
// 光标】—— prosemirror-tables 的正常行为！Word 的行为：按住拖动 selected
// 内容 = 移动 —— 需要拖拽期间保持）。
// ◆ Word 交互实为：拖动【行选区】时 mousemove 超阈值进入移动模式。
// PM tables 会先把选区压成光标（mousedown 默认）—— 我们必须【在
// proxy 放行前拦截 mousemove 起拖】—— 即 mousedown 时如果 CellSelection
// 且点击在选区内 → preventDefault（阻止 PM 压塌）+ 自己处理拖拽
//（行拖拽插件的 mousedown 已经注册在 PM handleDOMEvents —— 但
// preventDefault 的话 PM 插件还触发吗？handleDOMEvents 触发于事件
// 派发到 view.dom —— proxy 在外层拦截后事件根本到不了 view.dom！
// ★ 修正设计：proxy 的 mousedown 里【CellSelection 选区内】→ 
// preventDefault + 手动驱动行拖拽（把行拖拽逻辑从 PM 插件搬到
// window 级，由 proxy 直接调用）。
// 简化实现：proxy mousedown 遇 CellSelection → preventDefault →
// 直接跑 window 级 mousemove/mouseup 行拖拽会话（复用 tablePlugins
// 的 createRowDragPlugin 逻辑 —— 改为导出的 startRowDragSession）。
import { execSync } from 'child_process'
print = console.log
