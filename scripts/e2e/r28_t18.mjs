// ★★★★ 抓到真凶！事务 [0]：sel=9615, scroll:true —— 一个【滚到 9615】
//（≈doc 末尾）的事务在我们 applySel 之前执行！它带 scrolledIntoView。
// 谁 dispatch 的？不是我们（applySel 无 scrollIntoView）。—— PM 的
// 【DOMObserver flush】：mouseup 后浏览器把 caret 放到末尾（r27 的
// anchor=末段落 P）→ selectionchange → PM domObserver flush → 读
// DOM selection → pos 9615 → setSelection + scrollIntoView → 页面跳！
// 然后我们 applySel 把 selection 拉回 5174（不滚）—— 但页面已跳走。
// ★ 修法（三管齐下，Word 级体验）：
// 1. applySel 补刀里 dispatch 后把 scrollTop 【还原】（记录点击前位置）
// 2. 或者在 proxy mouseup 后立刻同步 DOM selection（在 PM flush 之前）
// 3. 最稳：在 applySel 里 dispatch 时给 tr 标 meta，且 patch：监听
//    PM 的每个 dispatch —— 若 selection 在表格内且刚发生「跳到末尾」
//    的 scroll 事务 → 撤销滚动。
// ★ 实操最简单有效：applySel 记住 mousedown 时的 scrollTop，60ms 补刀
//    里 dispatch + 恢复 scrollTop。
import { execSync } from 'child_process'
console.log('fixing...')
