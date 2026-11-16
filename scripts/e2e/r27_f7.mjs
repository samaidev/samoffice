// 探针 HIT + 产品 handler 无 dispatch —— mousedown 派发到了 proxy，
// 探针（capture）收了，产品 handler（bubble）没跑？？
// 除非产品 handler 抛异常在 dispatch 之前：
// handler 顺序：e.button→v→rows 匹配→hit→preventDefault→applySel
// 若 hit 匹配失败 → 静默 return（无 pd 无 dispatch）。
// f5 的探针在【capture】阶段 —— 收到 mousedown 不代表 handler 会被
// 调用？—— capture 之后必然 bubble 到同元素 handler。
// ★ 除非 —— e.button !== 0？Playwright click 是 button=0。
// 或 viewRef.current 为 null？！—— 【HMR 之后 DocumentEditor 的
// viewRef】是【新组件实例】的 ref，而管理器 effect 闭包是【旧实例】的！
// viewRef 是组件内 useRef —— effect 在旧渲染闭包里引用旧 viewRef —— 
// React 重渲染不会换 ref 对象（useRef 稳定）—— 但 HMR fast-refresh
// 会重建组件 → 新 viewRef → 旧闭包的 viewRef.current = null！
// ★★★★ HMR 污染！生产构建无此问题 —— 但我们一直在 HMR 下测！
// 硬重启 vite + 单次加载验证（不加任何 HMR 扰动）：
import { execSync } from 'child_process'
try { execSync('pkill -f "vite.*18400"') } catch {}
try { execSync('pkill -f "npm run dev"') } catch {}
console.log('killed for HMR-free test')
