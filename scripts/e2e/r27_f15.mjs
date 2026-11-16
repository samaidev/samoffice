// 1 个 proxy、覆盖正确 —— 但闭包 wrapper 是旧的（noHit）。
// 即：NodeView 重建后，管理器 MO 检测到变化 → scheduleSync → 
// 遍历 pm 下 wrapper：新 wrapper 不在 proxies → ensureProxy(新) ——
// 应建新 proxy！但屏上只有 1 个（旧的还是新的？）
// —— 旧 wrapper isConnected=false → 清理分支 remove 旧 proxy ——
// 然后 ensureProxy 新 —— 都在同一个 run() 里 —— 应该已完成。
// 但闭包是旧的 → 屏上 proxy 是【旧的】且已从 Map 清理？
// —— 不可能还在屏上…… 除非清理分支没跑（旧 wrapper 仍 connected ——
// NodeView 重建 = PM 复用 wrapper DOM！wrapper 节点没换 —— 
// 那闭包 wrapper == 屏上 wrapper —— noHit 就不该发生！
// ◆ 矛盾的出路：NodeView 重建时 PM 可能【替换 wrapper 的子树】
//（tbody 换新）而 wrapper 复用 —— querySelectorAll('tr') 应该还能查到
// 新 tr…… noHit 说明 handler 闭包里的 wrapper 查不到 tr —— 
// wrapper 自身不在文档里。
// ★ 一锤定音：dbg 里直接 dump 闭包 wrapper 状态 —— 需要产品代码
// 探针（闭包内）：
import { execSync } from 'child_process'
# 直接 python 处理
