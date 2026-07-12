/**
 * usePopupAutoFlip — 自动检测 .ribbon-popup / .files-dropdown 越界并翻转对齐
 *
 * 问题：所有 ribbon popup 都用 `left: 0` 左对齐，靠右的按钮弹出菜单会越出视口右边界。
 * 方案：用 MutationObserver 监听 popup 可见性变化，弹出时检查 boundingRect，
 *       若右越界则改为 right:0 左展开；若下越界则改为 bottom:100% 上展开。
 *
 * 用法：在 App 顶层调用一次 usePopupAutoFlip() 即可全局生效。
 */
import { useEffect } from 'react'

export function usePopupAutoFlip() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const POPUP_SELECTOR = '.ribbon-popup, .files-dropdown'
    const VW = () => window.innerWidth
    const VH = () => window.innerHeight
    const MARGIN = 8 // 距离视口边缘的安全间距

    function adjustOne(el: HTMLElement) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return

      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return

      // 检查右越界
      if (r.right > VW() - MARGIN) {
        // 改为右对齐（向左展开）
        el.style.left = 'auto'
        el.style.right = '0'
      }
      // 检查左越界（极少见，但兜底）
      else if (r.left < MARGIN) {
        el.style.left = '0'
        el.style.right = 'auto'
      }

      // 检查下越界 → 翻转到上方
      // 仅当 popup 是 top:100% (向下方展开) 时才翻转
      if (r.bottom > VH() - MARGIN && cs.top !== 'auto' && cs.bottom === 'auto') {
        // 计算popup高度，确保翻转到上方后不会越界顶部
        const flipTop = r.top - r.height
        if (flipTop > MARGIN) {
          el.style.top = 'auto'
          el.style.bottom = '100%'
        }
      }
    }

    function adjustAll() {
      document.querySelectorAll<HTMLElement>(POPUP_SELECTOR).forEach(adjustOne)
    }

    // 1. MutationObserver: 监听 DOM 变化（popup 被创建/显示时触发）
    const mo = new MutationObserver(() => {
      // 用 requestAnimationFrame 等浏览器布局完成后再测量
      requestAnimationFrame(adjustAll)
    })
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    // 2. 窗口尺寸变化时重新调整
    const onResize = () => requestAnimationFrame(adjustAll)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onResize, true)

    // 3. 初始扫描一次
    requestAnimationFrame(adjustAll)

    return () => {
      mo.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onResize, true)
    }
  }, [])
}
