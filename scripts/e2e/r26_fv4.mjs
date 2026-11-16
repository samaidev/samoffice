// ★ 400ms 延迟创建的层 ALIVE！但正式代码的 400ms proxy 却收不到！
// 区别：正式 proxy 建于【DocTableView constructor + 400ms】= 挂载即计时；
// 测试层建于【文档加载完成后 3.5s + N ms】。DocTableView 的 400ms 是从
// 【NodeView 构造】算起 —— 那时整个编辑器刚 mount！
// 而 fv3 的层建在 mount 后 ~4-6.5s。
// ◆ 二分「从挂载起的最小安全延迟」—— 直接对正式代码做延迟参数扫描：
// 用 evaluate 在不同时间检查 proxy 是否可点（等真实 HMR 代码 ——
// 改成可配置不可行）。简化：把正式代码 400ms → 2500ms，重测。
import { execSync } from 'child_process'
execSync("sed -i 's/setTimeout(setup, 400)/setTimeout(setup, 2500)/' frontend/src/editors/document/tablePlugins.ts", { cwd: '/home/z/my-project/samoffice' })
console.log('delay → 2500ms')
