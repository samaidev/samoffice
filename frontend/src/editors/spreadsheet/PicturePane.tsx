/**
 * PicturePane.tsx —— round60：「设置图片格式」右侧窗格（对齐 Excel Format Picture）。
 * 页签：图片（颜色校正/重新着色/透明度）、效果（阴影/发光/柔化边缘/映像）、
 * 大小与属性（尺寸/缩放/旋转/对象定位/锁定/打印/可选文字）、裁剪（四边比例数值）。
 */
import React, { useState } from 'react'
import { useI18n } from '../../i18n'
import { SheetPicture, picRect, PicGeometry, defaultColor, cropWindow } from './pictures'
import type { PicCommand } from './PictureRibbon'

export interface PicturePaneProps {
  pics: SheetPicture[]
  geom: PicGeometry
  onClose: () => void
  onPatch: (patch: Partial<SheetPicture>, touch: 'ln' | 'fx' | 'color' | 'geom' | 'meta' | 'crop' | 'style') => void
  onCommand: (cmd: PicCommand) => void
  onSize: (w: number | null, h: number | null) => void
  onRot: (deg: number) => void
}

type Tab = 'picture' | 'effects' | 'size' | 'crop'

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-3">
    <div className="text-[11px] font-medium opacity-70 mb-1.5 border-b border-black/10 dark:border-white/10 pb-1">{title}</div>
    {children}
  </div>
)

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-2 mb-1.5">
    <span className="text-[11px] w-20 shrink-0 opacity-70">{label}</span>
    <div className="flex-1 flex items-center gap-1.5 min-w-0">{children}</div>
  </div>
)

const Slider: React.FC<{ value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }> = ({ value, min, max, step = 1, onChange, suffix }) => (
  <>
    <input type="range" min={min} max={max} step={step} value={value}
      className="flex-1 accent-blue-600 min-w-0" onChange={e => onChange(parseFloat(e.target.value))} />
    <span className="text-[10px] w-12 text-right tabular-nums opacity-70">{Math.round(value * 100) / 100}{suffix}</span>
  </>
)

const Num: React.FC<{ value: number; onChange: (v: number) => void; step?: number; suffix?: string; min?: number; max?: number }> = ({ value, onChange, step = 1, suffix, min, max }) => {
  // 非受控输入：外部值变化经 key 重挂载同步（滑杆/拖拽连续更新时安全）
  const shown = Math.round(value * 100) / 100
  return (
    <span className="inline-flex items-center">
      <input key={String(shown)} type="number" step={step} min={min} max={max} defaultValue={shown}
        className="w-16 px-1 py-0.5 text-[11px] rounded border border-black/15 dark:border-white/20 bg-transparent text-right"
        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v) }} />
      {suffix && <span className="text-[10px] ml-1 opacity-60">{suffix}</span>}
    </span>
  )
}

const DUAL_TONES: { name: string; dark: string; light: string }[] = [
  { name: '灰度', dark: '#000000', light: '#FFFFFF' },
  { name: '褐色', dark: '#663300', light: '#FFCC99' },
  { name: '冲蚀', dark: '#95B3D7', light: '#FFFFFF' },
  { name: '蓝红', dark: '#000066', light: '#FF6699' },
  { name: '明暗', dark: '#333333', light: '#B2B2B2' },
  { name: '紫色', dark: '#330033', light: '#FF99FF' },
]

const PicturePane: React.FC<PicturePaneProps> = ({ pics, geom, onClose, onPatch, onCommand, onSize, onRot }) => {
  const { tf } = useI18n()
  const [tab, setTab] = useState<Tab>('picture')
  const p = pics[0]
  if (!p) return null
  const rect = picRect(p, geom)
  const c = p.color || defaultColor()
  const win = cropWindow(p.crop)

  const patchColor = (part: Partial<SheetPicture['color']>) => {
    onPatch({ color: { ...defaultColor(), ...c, ...part } }, 'color')
  }

  const tabBtn = (id: Tab, label: string) => (
    <button key={id} className={'px-2 py-1 text-[11px] rounded-t ' + (tab === id ? 'bg-white dark:bg-gray-700 font-medium' : 'opacity-60 hover:opacity-100')}
      onClick={() => setTab(id)}>{label}</button>
  )

  return (
    <div className="w-64 shrink-0 border-l border-black/10 dark:border-white/15 bg-gray-50/60 dark:bg-gray-800/40 flex flex-col" data-testid="pic-pane">
      <div className="flex items-center justify-between px-2 pt-2">
        <div className="text-xs font-medium truncate" title={p.name}>{p.name || tf('sheet.picDefaultName', '图片')}</div>
        <button className="text-xs opacity-60 hover:opacity-100 px-1" data-testid="pic-pane-close" onClick={onClose}>✕</button>
      </div>
      <div className="flex gap-1 px-2 pt-2 border-b border-black/10 dark:border-white/10" data-testid="pic-pane-tabs">
        {tabBtn('picture', tf('sheet.panePicture', '图片'))}
        {tabBtn('effects', tf('sheet.paneEffects', '效果'))}
        {tabBtn('size', tf('sheet.paneSize', '大小与属性'))}
        {tabBtn('crop', tf('sheet.paneCrop', '裁剪'))}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 text-[11px]">
        {tab === 'picture' && (
          <>
            <Section title={tf('sheet.paneColorCorrect', '颜色校正')}>
              <Row label={tf('sheet.paneBrightness', '亮度')}><Slider value={c.brightness * 100} min={-100} max={100} onChange={v => patchColor({ brightness: v / 100 })} suffix="%" /></Row>
              <Row label={tf('sheet.paneContrast', '对比度')}><Slider value={c.contrast * 100} min={-100} max={100} onChange={v => patchColor({ contrast: v / 100 })} suffix="%" /></Row>
              <Row label={tf('sheet.paneSaturation', '饱和度')}><Slider value={c.saturation * 100} min={-100} max={100} onChange={v => patchColor({ saturation: v / 100 })} suffix="%" /></Row>
              <Row label={tf('sheet.paneTransparency', '透明度')}><Slider value={c.transparency * 100} min={0} max={100} onChange={v => patchColor({ transparency: v / 100 })} suffix="%" /></Row>
            </Section>
            <Section title={tf('sheet.paneRecolor', '重新着色')}>
              <div className="grid grid-cols-2 gap-1 mb-1.5">
                <button className={'px-1 py-1 rounded border ' + (!c.grayscale && !c.duotone ? 'border-blue-500 text-blue-600' : 'border-black/10 dark:border-white/15')}
                  onClick={() => patchColor({ grayscale: false, duotone: null })}>{tf('sheet.recolorNone', '无彩色')}</button>
                <button className={'px-1 py-1 rounded border ' + (c.grayscale ? 'border-blue-500 text-blue-600' : 'border-black/10 dark:border-white/15')}
                  onClick={() => patchColor({ grayscale: true, duotone: null })}>{tf('sheet.recolorGray', '灰度')}</button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {DUAL_TONES.map(d => (
                  <button key={d.name} title={d.name}
                    className={'h-7 rounded border flex items-center justify-center ' + (c.duotone && c.duotone[0] === d.dark ? 'border-blue-500' : 'border-black/10 dark:border-white/15')}
                    style={{ background: `linear-gradient(90deg, ${d.dark} 50%, ${d.light} 50%)` }}
                    onClick={() => patchColor({ grayscale: false, duotone: [d.dark, d.light] })} />
                ))}
              </div>
              <Row label={tf('sheet.paneTransparent', '透明色')}>
                <input type="color" value={c.transparent || '#FFFFFF'} className="w-8 h-6 rounded border border-black/15" data-testid="pic-set-transparent"
                  onChange={e => patchColor({ transparent: e.target.value.toUpperCase() })} />
                {c.transparent && (
                  <button className="px-1.5 py-0.5 rounded border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => patchColor({ transparent: '' })}>{tf('sheet.paneClearTransparent', '清除')}</button>
                )}
              </Row>
            </Section>
            <Section title={tf('sheet.paneMedia', '媒体')}>
              <div className="opacity-60 leading-5">
                {tf('sheet.paneExt', '格式')}: {p.ext.toUpperCase()}<br />
                {tf('sheet.paneNatural', '原始尺寸')}: {Math.round(p.natW)}×{Math.round(p.natH)} px<br />
                {p.svgSrc ? `${tf('sheet.paneSvg', '矢量源')}: SVG\n` : ''}
                {tf('sheet.paneAnchor', '锚定')}: {p.from.col + 1}列{p.from.row + 1}行 +{Math.round(p.from.dx)},{Math.round(p.from.dy)}px
              </div>
            </Section>
          </>
        )}

        {tab === 'effects' && (
          <>
            <Section title={tf('sheet.paneShadow', '阴影')}>
              <div className="grid grid-cols-3 gap-1 mb-1.5">
                <button className={'px-1 py-1 rounded border ' + (!p.shadow ? 'border-blue-500 text-blue-600' : 'border-black/10 dark:border-white/15')}
                  onClick={() => onPatch({ shadow: null }, 'fx')}>{tf('sheet.picFxNone', '无')}</button>
                <button className={'px-1 py-1 rounded border ' + (p.shadow?.kind === 'outer' ? 'border-blue-500 text-blue-600' : 'border-black/10 dark:border-white/15')}
                  onClick={() => onPatch({ shadow: p.shadow && p.shadow.kind === 'outer' ? p.shadow : { kind: 'outer', blur: 5, dist: 4, dir: 90, color: '#000000', alpha: 0.4 } }, 'fx')}>{tf('sheet.fxOuter', '外阴影')}</button>
                <button className={'px-1 py-1 rounded border ' + (p.shadow?.kind === 'inner' ? 'border-blue-500 text-blue-600' : 'border-black/10 dark:border-white/15')}
                  onClick={() => onPatch({ shadow: p.shadow && p.shadow.kind === 'inner' ? p.shadow : { kind: 'inner', blur: 6, dist: 4, dir: 90, color: '#000000', alpha: 0.45 } }, 'fx')}>{tf('sheet.fxInner', '内阴影')}</button>
              </div>
              {p.shadow && (
                <>
                  <Row label={tf('sheet.fxBlur', '模糊')}><Slider value={p.shadow.blur} min={0} max={40} onChange={v => onPatch({ shadow: { ...p.shadow!, blur: v } }, 'fx')} suffix="px" /></Row>
                  <Row label={tf('sheet.fxDist', '距离')}><Slider value={p.shadow.dist} min={0} max={40} onChange={v => onPatch({ shadow: { ...p.shadow!, dist: v } }, 'fx')} suffix="px" /></Row>
                  <Row label={tf('sheet.fxDir', '角度')}><Slider value={p.shadow.dir} min={0} max={359} onChange={v => onPatch({ shadow: { ...p.shadow!, dir: v } }, 'fx')} suffix="°" /></Row>
                  <Row label={tf('sheet.fxAlpha', '透明度')}><Slider value={(1 - p.shadow.alpha) * 100} min={0} max={100} onChange={v => onPatch({ shadow: { ...p.shadow!, alpha: 1 - v / 100 } }, 'fx')} suffix="%" /></Row>
                  <Row label={tf('sheet.fxColor', '颜色')}>
                    <input type="color" value={p.shadow.color} className="w-8 h-6 rounded border border-black/15"
                      onChange={e => onPatch({ shadow: { ...p.shadow!, color: e.target.value } }, 'fx')} />
                  </Row>
                </>
              )}
            </Section>
            <Section title={tf('sheet.picFxGlow', '发光')}>
              <Row label={tf('sheet.fxSize', '大小')}><Slider value={p.glow?.size || 0} min={0} max={40} onChange={v => onPatch({ glow: v ? { size: v, color: p.glow?.color || '#4472C4', alpha: p.glow?.alpha ?? 0.6 } : null }, 'fx')} suffix="px" /></Row>
              {p.glow && <>
                <Row label={tf('sheet.fxAlpha', '透明度')}><Slider value={(1 - p.glow.alpha) * 100} min={0} max={100} onChange={v => onPatch({ glow: { ...p.glow!, alpha: 1 - v / 100 } }, 'fx')} suffix="%" /></Row>
                <Row label={tf('sheet.fxColor', '颜色')}>
                  <input type="color" value={p.glow.color} className="w-8 h-6 rounded border border-black/15"
                    onChange={e => onPatch({ glow: { ...p.glow!, color: e.target.value } }, 'fx')} />
                </Row>
              </>}
            </Section>
            <Section title={tf('sheet.picFxSoftEdge', '柔化边缘')}>
              <Row label={tf('sheet.fxSize', '大小')}><Slider value={p.softEdge} min={0} max={60} onChange={v => onPatch({ softEdge: v }, 'fx')} suffix="px" /></Row>
            </Section>
            <Section title={tf('sheet.picFxReflection', '映像')}>
              <Row label={tf('sheet.fxStrength', '强度')}><Slider value={p.reflection * 100} min={0} max={100} onChange={v => onPatch({ reflection: v / 100 }, 'fx')} suffix="%" /></Row>
            </Section>
          </>
        )}

        {tab === 'size' && (
          <>
            <Section title={tf('sheet.paneSize', '大小')}>
              <Row label={tf('sheet.paneHeight', '高度')}><Num value={Math.round(rect.h)} min={1} suffix="px" onChange={v => onSize(null, v)} /></Row>
              <Row label={tf('sheet.paneWidth', '宽度')}><Num value={Math.round(rect.w)} min={1} suffix="px" onChange={v => onSize(v, null)} /></Row>
              <Row label={tf('sheet.paneScale', '缩放')}>
                <Num value={Math.round((rect.w / (p.natW || 1)) * 100)} min={1} max={1000} suffix="%" onChange={v => onSize((p.natW * v) / 100, null)} />
                <span className="opacity-50">↔</span>
                <Num value={Math.round((rect.h / (p.natH || 1)) * 100)} min={1} max={1000} suffix="%" onChange={v => onSize(null, (p.natH * v) / 100)} />
              </Row>
              <label className="flex items-center gap-1.5 mb-1.5 opacity-80">
                <input type="checkbox" checked={p.lockAspect} onChange={e => onPatch({ lockAspect: e.target.checked }, 'meta')} />
                {tf('sheet.paneLockAspect', '锁定纵横比')}
              </label>
              <Row label={tf('sheet.paneRot', '旋转')}><Num value={Math.round(p.rot)} min={0} max={359} suffix="°" onChange={v => onRot(((v % 360) + 360) % 360)} /></Row>
            </Section>
            <Section title={tf('sheet.paneAnchorMode', '对象定位')}>
              {([['moveSize', '随单元格改变位置和大小'], ['move', '只移动不调整大小'], ['fixed', '固定位置和大小']] as const).map(([m, label]) => (
                <label key={m} className="flex items-center gap-1.5 mb-1 opacity-80">
                  <input type="radio" checked={p.mode === m} onChange={() => onPatch({ mode: m }, 'meta')} />
                  {tf(`sheet.anchor.${m}`, label)}
                </label>
              ))}
            </Section>
            <Section title={tf('sheet.paneProps', '属性')}>
              <div className="mb-1.5">
                <div className="opacity-60 mb-0.5">{tf('sheet.paneAlt', '可选文字（替代文字）')}</div>
                <input className="w-full px-1.5 py-1 rounded border border-black/15 dark:border-white/20 bg-transparent" value={p.alt}
                  placeholder={tf('sheet.paneAltPh', '为无障碍访问者描述图片')}
                  onChange={e => onPatch({ alt: e.target.value }, 'meta')} />
              </div>
              <div className="mb-1.5">
                <div className="opacity-60 mb-0.5">{tf('sheet.paneName', '名称')}</div>
                <input className="w-full px-1.5 py-1 rounded border border-black/15 dark:border-white/20 bg-transparent" value={p.name}
                  onChange={e => onPatch({ name: e.target.value }, 'meta')} />
              </div>
              <label className="flex items-center gap-1.5 mb-1 opacity-80">
                <input type="checkbox" checked={p.hidden} onChange={e => onPatch({ hidden: e.target.checked }, 'meta')} />
                {tf('sheet.paneHidden', '隐藏图片')}
              </label>
              <label className="flex items-center gap-1.5 mb-1 opacity-80">
                <input type="checkbox" checked={p.locked} onChange={e => onPatch({ locked: e.target.checked }, 'meta')} />
                {tf('sheet.paneLocked', '锁定（保护工作表时不可更改）')}
              </label>
              <label className="flex items-center gap-1.5 opacity-80">
                <input type="checkbox" checked={p.print} onChange={e => onPatch({ print: e.target.checked }, 'meta')} />
                {tf('sheet.panePrint', '打印对象')}
              </label>
            </Section>
          </>
        )}

        {tab === 'crop' && (
          <>
            <Section title={tf('sheet.paneCropVals', '裁剪（占原图比例）')}>
              <Row label={tf('sheet.cropLeft', '左')}><Slider value={p.crop.l * 100} min={-50} max={95} onChange={v => onPatch({ crop: { ...p.crop, l: v / 100 } }, 'crop')} suffix="%" /></Row>
              <Row label={tf('sheet.cropRight', '右')}><Slider value={p.crop.r * 100} min={-50} max={95} onChange={v => onPatch({ crop: { ...p.crop, r: v / 100 } }, 'crop')} suffix="%" /></Row>
              <Row label={tf('sheet.cropTop', '上')}><Slider value={p.crop.t * 100} min={-50} max={95} onChange={v => onPatch({ crop: { ...p.crop, t: v / 100 } }, 'crop')} suffix="%" /></Row>
              <Row label={tf('sheet.cropBottom', '下')}><Slider value={p.crop.b * 100} min={-50} max={95} onChange={v => onPatch({ crop: { ...p.crop, b: v / 100 } }, 'crop')} suffix="%" /></Row>
              <div className="opacity-60 mt-1 leading-5">
                {tf('sheet.paneCropWindow', '可见窗口')}: {Math.round(win.w * 100)}% × {Math.round(win.h * 100)}%
              </div>
            </Section>
            <Section title={tf('sheet.paneCropTools', '裁剪工具')}>
              <div className="grid grid-cols-2 gap-1">
                <button className="px-1 py-1 rounded border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10" data-testid="pane-crop-start"
                  onClick={() => onCommand('crop:start')}>{tf('sheet.cropStart', '裁剪')}</button>
                <button className="px-1 py-1 rounded border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10" data-testid="pane-crop-fill"
                  onClick={() => onCommand('crop:fill')}>{tf('sheet.cropFill', '填充')}</button>
                <button className="px-1 py-1 rounded border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10" data-testid="pane-crop-fit"
                  onClick={() => onCommand('crop:fit')}>{tf('sheet.cropFit', '调整')}</button>
                <button className="px-1 py-1 rounded border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10" data-testid="pane-crop-reset"
                  onClick={() => onCommand('crop:reset')}>{tf('sheet.cropReset', '删除裁剪')}</button>
              </div>
            </Section>
          </>
        )}
      </div>
      <div className="px-3 py-1.5 text-[10px] opacity-40 border-t border-black/5 dark:border-white/10">{pics.length > 1 ? tf('sheet.paneMulti', '已选中多张图片，改动将应用到全部') : ''}</div>
    </div>
  )
}

export default PicturePane
