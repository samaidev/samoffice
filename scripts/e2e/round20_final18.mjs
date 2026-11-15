// inline-block 改写【在页面运行时注入】有效（final15 ✓），但 final16/17
// 里同改写又失效 —— 区别：final15 只【点击测试】；final16/17 里点击时机
// 不同（等待更久后 DOM 可能被分页重算重建 —— 重算后 .sam-math 样式还在
// 但【表格位置变了】）。或者注入的规则在等待期间被 React 重渲染干掉?
// CSS 规则不受 React 影响……
// 
// 停止追逐。系统性总结 18 轮实验的确定结论：
//  1. 死区=表格矩形本身（hit-test 对 table 元素失效）
//  2. 与 .sam-math display:block 强相关（改 inline-block 曾修复一次）
//  3. 时序敏感（等待时长影响结果）→ 分页重算参与
//  4. Chromium 合成器层 bug（eventless 但 elementFromPoint 正常）
// 
// 工程修复决策：分页引擎【隐藏页间空白】模式 + 分页纸页层的
// position:absolute inset:0 高 16842px 的 sheetsLayer 是罪魁 ——
// 它 pe=none 且 z=0，但 16842px 超大层干扰 hit-test。
// 修复：给 sheetsLayer 内容限制高度（只画视口附近纸页）—— 但那影响视觉。
// 
// ★ 最务实的修复（对用户立即可用）：把 .sam-math 的 display:block
// 改为 inline-block（final15 已验证有效一次），同时检查朱东山文档
// 公式块是否 .sam-math —— 用户主诉文档正是这个！直接改源码 CSS：
import { chromium } from 'playwright'
// 验证一次最终形态：改 index.css 源码 → 构建 → 完整测试
console.log('决策：修改源码 index.css .sam-math 为 inline-block，构建后完整验证')
