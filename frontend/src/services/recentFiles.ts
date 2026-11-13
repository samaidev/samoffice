// 最近打开文件的 localStorage 记录（Files 菜单"最近打开"列表的唯一数据源）。
//
// 记录时机有两处，缺一不可：
//   1. openResult —— 打开已有文件时（拖放/菜单/最近列表点击）；
//   2. App.handleSave 的 syncActivePath —— 保存成功时（修复用户主诉：
//      "新建的文件已经保存了，但它没有显示在文件列表的最近打开列表里面"
//      —— 旧实现只在打开时记录，保存新文件从不记录）。
// 规则：按完整路径去重、最新在前、最多保留 5 条；仅记录真实磁盘路径
// （本地模式），浏览器/远端模式的"另存为下载"没有磁盘路径，不记录。

const KEY = 'samoffice_recent_files'
const MAX = 5

export interface RecentFile {
  name: string
  path: string
}

/** 真实磁盘路径（Windows 盘符或 POSIX 绝对路径）才值得进最近列表 */
const isRealPath = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/')

export function loadRecentFiles(): RecentFile[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr.filter((r: any) => r && typeof r.path === 'string') : []
  } catch {
    return []
  }
}

export function recordRecentFile(target: string): void {
  try {
    if (!target || !isRealPath(target)) return
    const name = target.split(/[\\/]/).pop() || target
    const filtered = loadRecentFiles().filter(r => r.path !== target)
    filtered.unshift({ name, path: target })
    localStorage.setItem(KEY, JSON.stringify(filtered.slice(0, MAX)))
  } catch { /* localStorage 不可用时静默 */ }
}
