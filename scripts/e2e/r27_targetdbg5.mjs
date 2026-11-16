// 4 行无 ghost。拖到 451（行2 中下）：
// i=0: 451<401? no；i=1: 451<453? YES → target=1！
// 我算错了 —— 451 < 453 成立 —— target=1 → insertAt:
// target(1) > toRow+1(1)? NO（1>1 false）→ insertAt=1 原地区间？
// insertAt(1) >= fromRow(0) && <= toRow+1(1) → 【原地 return】！
// —— 但实测行序变了（R1 到末尾）！说明走的不是「原地」分支。
// ★ 唯一可能：target 到了 4。y=451 不可能……
// ★★★★ 除非 —— onMove 里的 trs 不是这 4 个 —— 【会话里的 wrap】是
// selectRow 前后重建的另一个 wrapper？！NodeView 又重建了！
//（dispatch CellSelection → PM 更新 → NodeView 重建 → 新 wrapper —— 
// 会话闭包里的旧 wrap —— rect 全 0 → target=4 默认！）
// ◆ 与点击代理同样的【闭包失效】问题！wrap 必须实时查找：
import { execSync } from 'child_process'
print = console.log
