// from 轨迹只有一条 52 —— 产品 applySel 的 dispatch(25) 从未出现！
// 补刀代码没跑？HMR 又旧代码？确认服务端模块含 applySel：
import { execSync } from 'child_process'
const served = execSync('curl -s http://localhost:18400/src/editors/document/DocumentEditor.tsx', { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
console.log('applySel in served:', served.includes('applySel'))
console.log('z-index:7 in served:', served.includes('z-index:7'))
// from 轨迹只 52 也说明 dispatch 劫持下 SEL 事件缺失 —— 
// 我们管理器的 dispatch 从未跑（连第一次都没有）。
// 但 final（前一轮）sel.from=52 focus=true —— 现在 52 无 dispatch 记录？
// 劫持没装（这次没劫持）。52 只在轨迹里。
// ★ 若 applySel 跑过：轨迹应有 52→25→52（补刀又被覆盖）或 …25。
// 只有 52 → applySel 完全没跑 → mousedown handler 没跑 → 
// 点击没到 proxy！但 final.t27 HIT 过 —— z=7 是【测试时手动改的】。
// 产品代码 z-index:7 改动 —— served 显示 true —— 页面应该用新值……
// 除非【vite 转译把 z-index:7 的 cssText 原样保留 —— 是】。
// ★ 直接看当前页面 proxy 的 z：
