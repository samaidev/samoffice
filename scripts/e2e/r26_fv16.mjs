// ★ 关键反转数据：无 sync 写 DEAD、含 sync 写 ALIVE！
// 无 sync 写 = proxy 没有几何（left/top/width/height 都没有）→ 0x0 元素
// 在原点 → 点击点当然不命中（0 尺寸层，物理上不在那）—— 这个 DEAD 是
// 【假阴性】！含 sync 写 ALIVE —— 几何正确时命中。
// 那正式代码（有 syncProxyGeometry 调用）为什么不命中？！
// —— 除非正式的 syncProxyGeometry 没跑或跑了但值错！
// fv9: proxy style.left=126px w=542 —— 跑了且值对。
// ◆◆◆ 但等等 —— fv12 的克隆测试【先 remove 再建】活；
// fv14 出生即死。fv15 现在也活。全部手工都活。
// ◆ 唯一没试的复刻维度：**正式 proxy 是 setTimeout(setup, 4000) 里建的**
// —— 但 fv3/fv13 都 setTimeout 建过（活）。
// ★★★★ 剩最后一个真正差异：**DocTableView.setup 里 syncProxyGeometry 是
// this 方法 —— this.proxyEl 在 appendChild 后赋值 —— 看下我写的顺序**：
// host.appendChild(proxy) 之后 this.proxyEl = proxy —— 对。
// 但 syncProxyGeometry 开头：const proxy = this.proxyEl —— 已赋值 —— OK。
// ◆◆ 直接读源码验证顺序 + 也许 TS 编译问题（vite 报错降级？）：
import { execSync } from 'child_process'
const out = execSync('sed -n "/private attachClickProxy/,/^  }/p" frontend/src/editors/document/tablePlugins.ts', { cwd: '/home/z/my-project/samoffice', encoding: 'utf8' })
console.log(out.slice(0, 2600))
