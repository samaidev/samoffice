/**
 * IconLibrary.tsx —— round60：内置图标库（插入 → 图标库）。
 * 全部为 24x24 线性 SVG 图标（stroke = currentColor），可选颜色与尺寸；
 * 插入时保留 SVG 矢量源（保存为 Excel 原生 svgBlip）+ 高分辨率 PNG 兜底图。
 */
import React, { useMemo, useState } from 'react'
import { useI18n } from '../../i18n'

interface IconDef { name: string; cat: string; d: string[]; circles?: [number, number, number][]; rects?: [number, number, number, number, number][] }

const ICONS: IconDef[] = [
  // 通用
  { name: 'check', cat: 'common', d: ['M20 6 9 17l-5-5'] },
  { name: 'x', cat: 'common', d: ['M18 6 6 18', 'M6 6l12 12'] },
  { name: 'plus', cat: 'common', d: ['M5 12h14', 'M12 5v14'] },
  { name: 'minus', cat: 'common', d: ['M5 12h14'] },
  { name: 'search', cat: 'common', d: ['m21 21-4.3-4.3'], circles: [[11, 11, 8]] },
  { name: 'menu', cat: 'common', d: ['M4 6h16', 'M4 12h16', 'M4 18h16'] },
  { name: 'info', cat: 'common', d: ['M12 16v-4', 'M12 8h.01'], circles: [[12, 12, 10]] },
  { name: 'filter', cat: 'common', d: ['M3 4h18l-7 8v6l-4 2v-8z'] },
  { name: 'refresh', cat: 'common', d: ['M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16', 'M21 21v-5h-5'] },
  { name: 'share', cat: 'common', d: ['M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8', 'M16 6l-4-4-4 4', 'M12 2v13'] },
  { name: 'sliders', cat: 'common', d: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M2 14h4', 'M10 8h4', 'M18 16h4'] },
  { name: 'layers', cat: 'common', d: ['m12 2 10 5-10 5L2 7l10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'] },
  // 箭头
  { name: 'arrow-right', cat: 'arrow', d: ['M5 12h14', 'M12 5l7 7-7 7'] },
  { name: 'arrow-left', cat: 'arrow', d: ['M19 12H5', 'M12 19l-7-7 7-7'] },
  { name: 'arrow-up', cat: 'arrow', d: ['M12 19V5', 'M5 12l7-7 7 7'] },
  { name: 'arrow-down', cat: 'arrow', d: ['M12 5v14', 'M19 12l-7 7-7-7'] },
  { name: 'external', cat: 'arrow', d: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'] },
  { name: 'link', cat: 'arrow', d: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'] },
  // 商务
  { name: 'user', cat: 'biz', d: ['M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'], circles: [[12, 7, 4]] },
  { name: 'users', cat: 'biz', d: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'], circles: [[9, 7, 4]] },
  { name: 'credit-card', cat: 'biz', d: ['M2 10h20'], rects: [[2, 5, 20, 14, 2]] },
  { name: 'cart', cat: 'biz', d: ['M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12'], circles: [[8, 21, 1], [19, 21, 1]] },
  { name: 'wallet', cat: 'biz', d: ['M3 10h18', 'M16 15h2'], rects: [[3, 6, 18, 13, 2]] },
  { name: 'package', cat: 'biz', d: ['m7.5 4.27 9 5.15', 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z', 'M3.3 7 12 12l8.7-5', 'M12 22V12'] },
  { name: 'truck', cat: 'biz', d: ['M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2', 'M15 18h-5', 'M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14'], circles: [[7, 21, 2], [17, 21, 2]] },
  { name: 'trophy', cat: 'biz', d: ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'] },
  { name: 'flag', cat: 'biz', d: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'] },
  // 文件
  { name: 'file', cat: 'file', d: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4'] },
  { name: 'folder', cat: 'file', d: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'] },
  { name: 'copy', cat: 'file', d: ['M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'], rects: [[9, 9, 13, 13, 2]] },
  { name: 'printer', cat: 'file', d: ['M6 9V2h12v7', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v8H6z'] },
  { name: 'book', cat: 'file', d: ['M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20'] },
  { name: 'pencil', cat: 'file', d: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'] },
  { name: 'trash', cat: 'file', d: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'] },
  { name: 'download', cat: 'file', d: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'] },
  { name: 'upload', cat: 'file', d: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'] },
  // 通信
  { name: 'mail', cat: 'comm', d: ['m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'], rects: [[2, 4, 20, 16, 2]] },
  { name: 'phone', cat: 'comm', d: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'] },
  { name: 'bell', cat: 'comm', d: ['M10.27 21a2 2 0 0 0 3.46 0', 'M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33'] },
  { name: 'mic', cat: 'comm', d: ['M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v3'] },
  { name: 'globe', cat: 'comm', d: ['M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'], circles: [[12, 12, 10]] },
  { name: 'wifi', cat: 'comm', d: ['M5 13a10 10 0 0 1 14 0', 'M8.5 16.5a5 5 0 0 1 7 0', 'M2 8.82a15 15 0 0 1 20 0', 'M12 20h.01'] },
  // 媒体
  { name: 'camera', cat: 'media', d: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z'], circles: [[12, 13, 3]] },
  { name: 'image', cat: 'media', d: ['m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21'], rects: [[3, 3, 18, 18, 2]], circles: [[9, 9, 2]] },
  { name: 'music', cat: 'media', d: ['M9 18V5l12-2v13'], circles: [[6, 18, 3], [18, 16, 3]] },
  { name: 'star', cat: 'media', d: ['M11.5 3.6a.53.53 0 0 1 1 0l2.1 5.1 5.5.4a.53.53 0 0 1 .3 1l-4.2 3.6 1.3 5.3a.53.53 0 0 1-.8.6L12 16.8l-4.7 2.8a.53.53 0 0 1-.8-.6l1.3-5.3-4.2-3.6a.53.53 0 0 1 .3-1l5.5-.4z'] },
  { name: 'heart', cat: 'media', d: ['M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z'] },
  { name: 'smile', cat: 'media', d: ['M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'], circles: [[12, 12, 10]] },
  { name: 'thumb-up', cat: 'media', d: ['M7 10v12', 'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z'] },
  { name: 'video', cat: 'media', d: ['m22 8-6 4 6 4V8z', 'M14 6H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2z'] },
  // 其他
  { name: 'home', cat: 'misc', d: ['m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M9 22V12h6v10'] },
  { name: 'lock', cat: 'misc', d: ['M7 11V7a5 5 0 0 1 10 0v4'], rects: [[3, 11, 18, 11, 2]] },
  { name: 'key', cat: 'misc', d: ['m21 2-9.6 9.6', 'M15.5 7.5l3 3L22 7l-3-3z'], circles: [[7.5, 15.5, 5]] },
  { name: 'eye', cat: 'misc', d: ['M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0'], circles: [[12, 12, 3]] },
  { name: 'shield', cat: 'misc', d: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'] },
  { name: 'tag', cat: 'misc', d: ['M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z'], circles: [[7.5, 7.5, 0.8]] },
  { name: 'bolt', cat: 'misc', d: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'] },
  { name: 'bulb', cat: 'misc', d: ['M15 14c.2-1 .7-1.7 1.5-2.5A6 6 0 1 0 6 8.5c.8.8 1.3 1.5 1.5 2.5', 'M9 18h6', 'M10 22h4'] },
  { name: 'gift', cat: 'misc', d: ['M12 8v13', 'M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7', 'M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5'], rects: [[3, 8, 18, 4, 1]] },
  { name: 'clock', cat: 'misc', d: ['M12 6v6l4 2'], circles: [[12, 12, 10]] },
  { name: 'calendar', cat: 'misc', d: ['M16 2v4', 'M8 2v4', 'M3 10h18'], rects: [[3, 4, 18, 18, 2]] },
  { name: 'sun', cat: 'misc', d: ['M12 2v2', 'M12 20v2', 'M4.93 4.93l1.41 1.41', 'M17.66 17.66l1.41 1.41', 'M2 12h2', 'M20 12h2', 'M6.34 17.66l-1.41 1.41', 'M19.07 4.93l-1.41 1.41'], circles: [[12, 12, 4]] },
  { name: 'cloud', cat: 'misc', d: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'] },
  { name: 'map-pin', cat: 'misc', d: ['M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z'], circles: [[12, 10, 3]] },
  { name: 'rocket', cat: 'misc', d: ['M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z', 'M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z', 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0', 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5'] },
  { name: 'wrench', cat: 'misc', d: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'] },
]

const CATS: { id: string; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'common', name: '通用' },
  { id: 'arrow', name: '箭头' },
  { id: 'biz', name: '商务' },
  { id: 'file', name: '文件' },
  { id: 'comm', name: '通信' },
  { id: 'media', name: '媒体' },
  { id: 'misc', name: '更多' },
]

const COLORS = ['#1F2937', '#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#6B7280', '#FFFFFF']

export interface IconLibraryProps {
  onPick: (svgText: string, color: string) => void
  onClose: () => void
}

/** 生成选中颜色/尺寸的完整 SVG 文本 */
function iconSVG(icon: IconDef, color: string, size: number): string {
  const parts: string[] = []
  for (const r of icon.rects || []) parts.push(`<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="${r[4]}"/>`)
  for (const c of icon.circles || []) parts.push(`<circle cx="${c[0]}" cy="${c[1]}" r="${c[2]}"/>`)
  for (const d of icon.d) parts.push(`<path d="${d}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</svg>`
}

const IconLibrary: React.FC<IconLibraryProps> = ({ onPick, onClose }) => {
  const { tf } = useI18n()
  const [cat, setCat] = useState('all')
  const [color, setColor] = useState('#1F2937')
  const [size, setSize] = useState(48)
  const [q, setQ] = useState('')

  const list = useMemo(() => ICONS.filter(ic =>
    (cat === 'all' || ic.cat === cat) && (!q || ic.name.includes(q.toLowerCase()))
  ), [cat, q])

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.35)' }} onMouseDown={onClose} data-testid="icon-library">
      <div className="rounded-xl shadow-2xl border max-w-2xl w-full flex flex-col max-h-[80vh]" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="text-sm font-medium">{tf('sheet.iconLib', '图标库')}</div>
          <button className="text-sm opacity-60 hover:opacity-100" onClick={onClose} data-testid="icon-lib-close">✕</button>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 flex-wrap border-b" style={{ borderColor: 'var(--color-border)' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={tf('sheet.iconSearch', '搜索图标名称（英文）')}
            className="px-2 py-1 text-xs rounded border flex-1 min-w-[120px]" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
          {CATS.map(c => (
            <button key={c.id} onClick={() => setCat(c.id)}
              className={'px-2 py-1 text-xs rounded ' + (cat === c.id ? 'text-white' : 'hover:opacity-80')}
              style={{ background: cat === c.id ? 'var(--color-primary)' : 'transparent', color: cat === c.id ? '#fff' : 'var(--color-text-secondary)' }}>
              {tf(`sheet.iconCat.${c.id}`, c.name)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-xs opacity-60">{tf('sheet.iconColor', '颜色')}</span>
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} title={c}
              className={'w-5 h-5 rounded-full border ' + (color === c ? 'ring-2 ring-blue-500' : '')}
              style={{ background: c, borderColor: 'rgba(0,0,0,.2)' }} />
          ))}
          <span className="text-xs opacity-60 ml-3">{tf('sheet.iconSize', '大小')}</span>
          {[24, 32, 48, 64].map(s => (
            <button key={s} onClick={() => setSize(s)}
              className={'px-2 py-0.5 text-xs rounded ' + (size === s ? 'text-white' : '')}
              style={{ background: size === s ? 'var(--color-primary)' : 'transparent', color: size === s ? '#fff' : 'var(--color-text-secondary)' }}>
              {s}px
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto p-3">
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(64px,1fr))' }}>
            {list.map(ic => (
              <button key={ic.name} title={ic.name} data-testid={`icon-${ic.name}`}
                className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => { onPick(iconSVG(ic, color, size), color); onClose() }}>
                <span style={{ color }} dangerouslySetInnerHTML={{ __html: iconSVG(ic, color, 28).replace(/width="28" height="28"/, 'width="28" height="28" style="display:block"') }} />
                <span className="text-[9px] opacity-50 truncate w-full text-center">{ic.name}</span>
              </button>
            ))}
            {!list.length && <div className="col-span-full text-center text-xs opacity-50 py-8">{tf('sheet.iconEmpty', '没有匹配的图标')}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default IconLibrary
