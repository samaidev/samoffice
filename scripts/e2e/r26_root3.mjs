// rebuilds=0 —— ui12 的 40 是【带 marker 属性的旧统计代码】把
// setAttribute('data-gen') 也算进去了？不管 —— 事实澄清：
// NodeView 不重建、PM 安静。
// 那 ui6 的「gen2 重建」也是假的？！ui6 判据 = dataset.marker 丢失 ——
// setAttribute 后 marker 在 wrapper 上，若 wrapper 没变 marker 应该在。
// ui6 显示 marker 丢了 = wrapper 真换过（那次点击后）。而 root2 静置不换。
// ◆ 结论修正：**点击正文导致 wrapper 重建一次**（点击 → selection 事务 → 
// App setDoc？handleDocChange 只 docChanged —— 点击不改 doc —— 
// 但 applyWindow/captureActive 可能走 setDoc → DocumentEditor 的
// [document] effect → view.updateState(全新 state) → PM 全部 NodeView 重建！）
// —— 每次点击都重建 → 每次重建 NodeView 注册 arm → 死循环依赖点击。
// ★★★ 最终修复定型（绕开全部混沌）：proxy 完全脱离 DocTableView —— 
// 由 DocumentEditor 挂载后【一次性】建立「表格点击管理器」：
//   - window 级 pointerdown(capture) 一次 → 用 requestIdleCallback 建
//     全局层池；此后每帧（节流）扫描所有 .tableWrapper，为无 proxy 的
//     表格建 proxy（建在 wrapper 的 parentElement = PM dom —— 不，
//     死区！建在 pm-host）。
//   - NodeView 重建不影响（proxy 按几何盖 wrapper，与节点身份无关）。
// 先验证核心假设：「点击后建（evaluate 源）」活 —— 已多次证实。
// 直接在 DocumentEditor 实现管理器（React 组件级，不随 PM 重建）：
import { execSync } from 'child_process'
let s = execSync('cat frontend/src/editors/document/tablePlugins.ts', { encoding: 'utf8' })
// 1) 移除 DocTableView 里的 attachClickProxy 调用与相关字段/方法（保留 handle 等）
const cut1 = `    this.attachHandle()
    this.attachClickProxy()
  }`
if (s.includes(cut1)) s = s.replace(cut1, `    this.attachHandle()
  }`)
// 2) 删除 attachClickProxy 起至 cellContentEnd 结束的整个块（用标记切除）
const start = s.indexOf('  /** round26 关键修复（表格点击死区')
const endMark = '  /** 应用 table 节点属性到 <table>'
const end = s.indexOf(endMark)
if (start >= 0 && end > start) {
  s = s.slice(0, start) + s.slice(end)
}
// 3) 删除字段声明
s = s.replace(/  \/\/ round26 点击代理层（见 attachClickProxy 注释）\n  private proxyEl[\s\S]*?private proxySyncTimer: number = 0\n/, '')
// 4) destroy 里的 proxy 清理块删除
s = s.replace(/\n    \/\/ round26：清理点击代理层[\s\S]*?this\.proxyEl\.remove\(\); this\.proxyEl = null \}/, '\n  }')
execSync('cat > frontend/src/editors/document/tablePlugins.ts << \'SAMEOF\'\n' + s + '\nSAMEOF', { encoding: 'utf8' })
console.log('tablePlugins 清理完成')
// 快速语法检查
const tsc = execSync('cd frontend && npx tsc --noEmit --skipLibCheck src/editors/document/tablePlugins.ts 2>&1 | head -5', { encoding: 'utf8', cwd: '/home/z/my-project/samoffice' }).trim()
console.log('tsc:', tsc || 'OK')
