// ★★★★★ 克隆层（同 style 同位置）命中！正式 proxy 不命中！
// 两者唯一剩余差异 = 【创建时机】。正式 proxy 建于 NodeView+2.5s
//（编辑器 mount 后 ~2.5s）；克隆建于 setDoc 后 ~4s+点击前 300ms。
// fv3 已证 400ms 手工延迟活 —— 那是从【我的 evaluate】计时。
// NodeView 的 2.5s 从【React mount】计 —— mount 后 2.5s ≈ setDoc 后
// 1.5s（setDoc 在 mount 前? 不 —— setDoc 触发 mount！）。
// 时序：setDoc → React render → DocumentEditor mount → NodeView ctor
// (+2.5s timeout) → proxy 创建。而我的所有「活」实验都在 setDoc 后 3.5s+。
// NodeView+2.5s ≈ setDoc 后 ~2.6s —— 接近 3.5s 但略早。
// ◆ 也许「危险窗口」是 [mount, mount+3s] —— 正式 2.5s 在窗口内，
// 3.5s+ 在窗口外。把正式延迟改 4s 重测：
import { execSync } from 'child_process'
execSync("sed -i 's/setTimeout(setup, 2500)/setTimeout(setup, 4000)/' frontend/src/editors/document/tablePlugins.ts", { cwd: '/home/z/my-project/samoffice' })
console.log('delay → 4000ms')
