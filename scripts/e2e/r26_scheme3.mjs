// from=1 且 doc 已破坏（外置残留 —— 之前的 setupExternalHost 代码还在
// HMR 里生效，把 wrapper 移走破坏了 doc！）。先回退外置代码再测代理层。
// 回退 = git checkout tablePlugins.ts —— 但那会丢掉今天的全部修改？
// tablePlugins.ts 今天的修改只有外置（无其它）—— 安全回退。
import { execSync } from 'child_process'
execSync('git checkout -- frontend/src/editors/document/tablePlugins.ts', { cwd: '/home/z/my-project/samoffice' })
console.log('tablePlugins.ts 已回退')
