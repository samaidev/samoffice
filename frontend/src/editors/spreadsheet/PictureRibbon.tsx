/**
 * PictureRibbon.tsx —— round60：「图片格式」上下文选项卡（对齐 Excel Picture Format）。
 * 分组：调整（更改图片/重置图片）、图片样式（样式库/边框/效果）、排列（层级/对齐/旋转）、
 * 大小（裁剪/宽高/旋转角）。状态与命令都在编辑器里，这里只渲染与回调。
 */
import React, { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import {
  SheetPicture, PICTURE_STYLES, SHADOW_PRESETS, CAM_PRESETS, SHAPE_GROUPS, picRect, PicGeometry, shapePath,
} from './pictures'

export type PicCommand =
  | 'replace' | 'resetPic' | 'resetSize'
  | 'crop:start' | `crop:shape:${string}` | `crop:ratio:${string}` | 'crop:fill' | 'crop:fit' | 'crop:reset'
  | 'arrange:front' | 'arrange:back' | 'arrange:forward' | 'arrange:backward'
  | `align:${string}`
  | 'rotate:left' | 'rotate:right' | 'rotate:flipH' | 'rotate:flipV' | 'rotate:more'
  | 'pane:open' | 'pane:props'

export interface PictureRibbonProps {
  pics: SheetPicture[]          // 选中的图片
  allCount: number
  geom: PicGeometry
  onCommand: (cmd: PicCommand) => void
  onPatch: (patch: Partial<SheetPicture>, touch: 'ln' | 'fx' | 'color' | 'geom' | 'meta' | 'crop' | 'style') => void
  onSize: (w: number | null, h: number | null) => void
  onRot: (deg: number) => void
}

/** 主题色 + 标准色（与 Excel 取色器一致的一级面板） */
const PALETTE = [
  ['#C00000', '#E81123', '#FF8C00', '#FFB900', '#107C10', '#00B294', '#0078D4', '#002050', '#5C2D91', '#B4009E'],
  ['#FFFFFF', '#000000', '#7F7F7F', '#D9D9D9', '#3B3838', '#595959', '#A6A6A6', '#BFBFBF', '#F2F2F2', '#8497B0'],
]

const LINE_WIDTHS = [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6]
const LINE_DASHES: { v: string; name: string }[] = [
  { v: 'solid', name: '实线' }, { v: 'dash', name: '划线' }, { v: 'sysDash', name: '系统划线' },
  { v: 'dot', name: '点线' }, { v: 'sysDot', name: '系统点线' }, { v: 'dashDot', name: '点划线' },
  { v: 'lgDash', name: '长划线' }, { v: 'lgDashDot', name: '长点划线' },
]

const BTN = 'flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-[11px] leading-tight min-w-[52px] cursor-pointer select-none'

/** 小型下拉弹出层（点击外部关闭） */
const Pop: React.FC<{ label: React.ReactNode; children: (close: () => void) => React.ReactNode; wide?: boolean; testId?: string }> = ({ label, children, wide, testId }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div className="relative" ref={ref} data-testid={testId}>
      <button className={BTN} onClick={() => setOpen(v => !v)}>{label}</button>
      {open && (
        <div className={'absolute z-50 top-full left-0 mt-1 rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-gray-800 shadow-xl py-1 max-h-[380px] overflow-auto ' + (wide ? 'w-[320px]' : 'w-[200px]')}
          style={{ color: 'var(--color-text,#111)' }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** 样式库缩略图：用选中图片的小图 + 样式效果渲染 */
const StylePreview: React.FC<{ src: string; idx: number; patch: Partial<SheetPicture> }> = ({ src, idx, patch }) => {
  const W = 44, H = 30
  const ln = patch.ln as SheetPicture['ln'] | undefined
  const sh = patch.shadow as SheetPicture['shadow'] | undefined
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <defs>
        <clipPath id={`pv${idx}`}><ellipse cx={W / 2} cy={H / 2} rx={W / 2} ry={H / 2} /></clipPath>
        <clipPath id={`pvr${idx}`}><rect x="0" y="0" width={W} height={H} rx="5" /></clipPath>
      </defs>
      <g clipPath={`url(#${patch.geom === 'ellipse' ? `pv${idx}` : `pvr${idx}`})`}
        filter={sh ? 'drop-shadow(2px 2px 1.5px rgba(0,0,0,.4))' : undefined}
        opacity={patch.softEdge ? 0.85 : 1}>
        <image href={src} x="0" y="0" width={W} height={H} preserveAspectRatio="xMidYMid slice" />
      </g>
      {ln && ln.w > 0 && (
        patch.geom === 'ellipse'
          ? <ellipse cx={W / 2} cy={H / 2} rx={W / 2 - ln.w * 0.6} ry={H / 2 - ln.w * 0.6} fill="none" stroke={ln.color} strokeWidth={(ln.w * 4) / 3} />
          : <rect x={ln.w * 0.6} y={ln.w * 0.6} width={W - ln.w * 1.2} height={H - ln.w * 1.2} rx="5" fill="none" stroke={ln.color} strokeWidth={(ln.w * 4) / 3} />
      )}
    </svg>
  )
}

const PictureRibbon: React.FC<PictureRibbonProps> = ({ pics, geom, onCommand, onPatch, onSize, onRot }) => {
  const { tf } = useI18n()
  const p0 = pics[0]
  const rect = p0 ? picRect(p0, geom) : { x: 0, y: 0, w: 0, h: 0 }
  const rw = p0 ? Math.round(rect.w) : 0
  const rh = p0 ? Math.round(rect.h) : 0
  const ln = p0?.ln
  const previewSrc = p0?.svgSrc || p0?.src || ''
  const multi = pics.length > 1
  if (!p0) return null

  const RBtn = ({ icon, label, cmd, title, testId }: { icon: string; label: string; cmd: PicCommand; title?: string; testId?: string }) => (
    <button className={BTN} title={title || label} data-testid={testId} onClick={() => onCommand(cmd)}>
      <span className="text-[15px] leading-none">{icon}</span>
      <span>{label}</span>
    </button>
  )

  return (
    <div className="flex items-stretch gap-1 flex-wrap px-1 py-1">
      {/* ---- 调整 ---- */}
      <div className="flex flex-col items-center px-2 border-r border-black/10 dark:border-white/15">
        <div className="text-[10px] opacity-60 mb-0.5">{tf('sheet.picGroupAdjust', '调整')}</div>
        <div className="flex">
          <Pop label={<><span className="text-[15px] leading-none">🔄</span><span>{tf('sheet.picChange', '更改图片')}</span></>} testId="pic-menu-change">
            {close => (
              <>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-change-device"
                  onClick={() => { close(); onCommand('replace') }}>{tf('sheet.picChangeDevice', '此设备…')}</button>
              </>
            )}
          </Pop>
          <Pop label={<><span className="text-[15px] leading-none">↩️</span><span>{tf('sheet.picReset', '重置图片')}</span></>} testId="pic-menu-reset">
            {close => (
              <>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" onClick={() => { close(); onCommand('resetPic') }}>{tf('sheet.picResetPic', '重置图片')}</button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" onClick={() => { close(); onCommand('resetSize') }}>{tf('sheet.picResetSize', '重设图片大小')}</button>
              </>
            )}
          </Pop>
        </div>
      </div>

      {/* ---- 图片样式 ---- */}
      <div className="flex flex-col items-center px-2 border-r border-black/10 dark:border-white/15">
        <div className="text-[10px] opacity-60 mb-0.5">{tf('sheet.picGroupStyles', '图片样式')}</div>
        <div className="flex items-center gap-1">
          {/* 样式库 */}
          <div className="flex gap-1 overflow-x-auto max-w-[460px] py-1" data-testid="pic-style-gallery">
            {PICTURE_STYLES.map((st, i) => (
              <button key={st.name} title={st.name} data-testid={`pic-style-${i}`}
                className={'shrink-0 rounded border p-0.5 bg-white dark:bg-gray-700 hover:outline hover:outline-2 hover:outline-blue-400 ' + (p0.stylePreset === st.name || (!p0.stylePreset && i === 0) ? 'outline outline-2 outline-blue-500' : '')}
                onClick={() => onPatch({ ...st.patch, stylePreset: st.name } as Partial<SheetPicture>, 'style')}>
                <StylePreview src={previewSrc} idx={i} patch={st.patch} />
              </button>
            ))}
          </div>

          {/* 图片边框 */}
          <Pop wide label={<><span className="text-[15px] leading-none">🔲</span><span>{tf('sheet.picBorder', '图片边框')}</span></>} testId="pic-menu-border">
            {close => (
              <div className="px-2 py-1">
                <div className="text-[11px] opacity-60 mb-1">{tf('sheet.picBorderColor', '颜色')}</div>
                {PALETTE.map((row, ri) => (
                  <div key={ri} className="flex gap-1 mb-1">
                    {row.map(c => (
                      <button key={c} title={c} className="w-5 h-5 rounded border border-black/15" style={{ background: c }}
                        onClick={() => { onPatch({ ln: { color: c, w: ln?.w || 1, dash: ln?.dash || 'solid', alpha: ln?.alpha ?? 1 } }, 'ln'); close() }} />
                    ))}
                  </div>
                ))}
                <div className="text-[11px] opacity-60 mt-2 mb-1">{tf('sheet.picBorderWidth', '粗细')}</div>
                <div className="grid grid-cols-3 gap-1">
                  {LINE_WIDTHS.map(wv => (
                    <button key={wv} className={'text-xs px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ' + (ln?.w === wv ? 'bg-blue-500 text-white' : '')}
                      onClick={() => { onPatch({ ln: { color: ln?.color || '#000000', w: wv, dash: ln?.dash || 'solid', alpha: ln?.alpha ?? 1 } }, 'ln'); close() }}>
                      {wv} pt
                    </button>
                  ))}
                </div>
                <div className="text-[11px] opacity-60 mt-2 mb-1">{tf('sheet.picBorderDash', '虚线')}</div>
                <div className="grid grid-cols-2 gap-1">
                  {LINE_DASHES.map(d => (
                    <button key={d.v} className={'text-xs px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ' + (ln?.dash === d.v ? 'bg-blue-500 text-white' : '')}
                      onClick={() => { onPatch({ ln: { color: ln?.color || '#000000', w: ln?.w || 1, dash: d.v, alpha: ln?.alpha ?? 1 } }, 'ln'); close() }}>
                      {d.name}
                    </button>
                  ))}
                </div>
                <button className="w-full text-left text-xs px-2 py-1.5 mt-2 rounded hover:bg-black/5 dark:hover:bg-white/10 border-t border-black/10 dark:border-white/10"
                  onClick={() => { onPatch({ ln: null }, 'ln'); close() }}>{tf('sheet.picBorderNone', '无轮廓')}</button>
              </div>
            )}
          </Pop>

          {/* 图片效果 */}
          <Pop wide label={<><span className="text-[15px] leading-none">✨</span><span>{tf('sheet.picEffects', '图片效果')}</span></>} testId="pic-menu-effects">
            {close => (
              <div className="px-2 py-1 text-xs">
                <div className="opacity-60 mb-1">{tf('sheet.picFxShadow', '阴影')}</div>
                <div className="grid grid-cols-3 gap-1 mb-2">
                  {SHADOW_PRESETS.map(s => (
                    <button key={s.name} className={'px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ' + (p0.shadow && p0.shadow.kind === s.kind && p0.shadow.dir === s.dir && p0.shadow.blur === s.blur ? 'bg-blue-500 text-white' : '')}
                      onClick={() => { onPatch({ shadow: s.blur || s.dist ? { kind: s.kind, blur: s.blur, dist: s.dist, dir: s.dir, color: s.color, alpha: s.alpha } : null }, 'fx'); close() }}>
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="opacity-60 mb-1">{tf('sheet.picFxGlow', '发光')}</div>
                <div className="grid grid-cols-5 gap-1 mb-2">
                  {[null, '#4472C4', '#FFC000', '#FF0000', '#00B0F0'].map((c, i) => (
                    <button key={i} className={'px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ' + ((c === null && !p0.glow) || (c && p0.glow?.color === c) ? 'ring-2 ring-blue-500' : '')}
                      onClick={() => { onPatch({ glow: c ? { size: p0.glow?.size || 10, color: c, alpha: p0.glow?.alpha ?? 0.6 } : null }, 'fx'); close() }}>
                      {c === null ? tf('sheet.picFxNone', '无') : <span className="inline-block w-3 h-3 rounded-full align-middle" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />}
                    </button>
                  ))}
                </div>
                <div className="opacity-60 mb-1">{tf('sheet.picFxSoftEdge', '柔化边缘')}</div>
                <div className="grid grid-cols-6 gap-1 mb-2">
                  {[0, 2, 5, 10, 20, 40].map(v => (
                    <button key={v} className={'px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ' + (p0.softEdge === v ? 'bg-blue-500 text-white' : '')}
                      onClick={() => { onPatch({ softEdge: v }, 'fx'); close() }}>
                      {v === 0 ? tf('sheet.picFxNone', '无') : `${v}px`}
                    </button>
                  ))}
                </div>
                <div className="opacity-60 mb-1">{tf('sheet.picFxReflection', '映像')}</div>
                <div className="grid grid-cols-5 gap-1 mb-2">
                  {[0, 0.3, 0.5, 0.7, 1].map(v => (
                    <button key={v} className={'px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ' + (Math.abs((p0.reflection || 0) - v) < 0.01 ? 'bg-blue-500 text-white' : '')}
                      onClick={() => { onPatch({ reflection: v }, 'fx'); close() }}>
                      {v === 0 ? tf('sheet.picFxNone', '无') : `${Math.round(v * 100)}%`}
                    </button>
                  ))}
                </div>
                <div className="opacity-60 mb-1">{tf('sheet.picFxBevel', '棱台')}</div>
                <div className="grid grid-cols-4 gap-1 mb-2">
                  {[null, 'circle', 'relax', 'angle'].map(bv => (
                    <button key={String(bv)} className={'px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ' + ((bv === null && !p0.bevel) || (bv && p0.bevel?.preset === bv) ? 'bg-blue-500 text-white' : '')}
                      onClick={() => { onPatch({ bevel: bv ? { preset: bv, w: p0.bevel?.w || 4, h: p0.bevel?.h || 3 } : null }, 'fx'); close() }}>
                      {bv === null ? tf('sheet.picFxNone', '无') : bv}
                    </button>
                  ))}
                </div>
                <div className="opacity-60 mb-1">{tf('sheet.picFx3D', '三维旋转')}</div>
                <div className="grid grid-cols-2 gap-1">
                  {CAM_PRESETS.map(cp => (
                    <button key={cp.name} className={'px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ' + (p0.cam === cp.cam ? 'bg-blue-500 text-white' : '')}
                      onClick={() => { onPatch({ cam: cp.cam, camLat: cp.lat, camLon: cp.lon, camRev: cp.rev }, 'fx'); close() }}>
                      {cp.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Pop>

          {/* 版式按钮（占位说明） */}
          <button className={BTN} title={tf('sheet.picLayoutNA', '图片版式（SmartArt 图形）暂不支持')} disabled style={{ opacity: 0.4 }}>
            <span className="text-[15px] leading-none">🗂️</span><span>{tf('sheet.picLayout', '图片版式')}</span>
          </button>
        </div>
      </div>

      {/* ---- 排列 ---- */}
      <div className="flex flex-col items-center px-2 border-r border-black/10 dark:border-white/15">
        <div className="text-[10px] opacity-60 mb-0.5">{tf('sheet.picGroupArrange', '排列')}</div>
        <div className="flex">
          <Pop label={<><span className="text-[15px] leading-none">⧉</span><span>{tf('sheet.picOrder', '上移一层')}</span></>} testId="pic-menu-order">
            {close => (
              <>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-order-front" onClick={() => { close(); onCommand('arrange:front') }}>{tf('sheet.picFront', '置于顶层')}</button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-order-forward" onClick={() => { close(); onCommand('arrange:forward') }}>{tf('sheet.picForward', '上移一层')}</button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-order-backward" onClick={() => { close(); onCommand('arrange:backward') }}>{tf('sheet.picBackward', '下移一层')}</button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-order-back" onClick={() => { close(); onCommand('arrange:back') }}>{tf('sheet.picBack', '置于底层')}</button>
              </>
            )}
          </Pop>
          {multi && (
            <Pop label={<><span className="text-[15px] leading-none">⇹</span><span>{tf('sheet.picAlign', '对齐')}</span></>} testId="pic-menu-align">
              {close => (
                <div className="grid grid-cols-2">
                  {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map(a => (
                    <button key={a} className="text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded"
                      data-testid={`pic-align-${a}`}
                      onClick={() => { close(); onCommand(`align:${a}` as PicCommand) }}>
                      {tf(`sheet.align.${a}`, a === 'left' ? '左对齐' : a === 'center' ? '水平居中' : a === 'right' ? '右对齐' : a === 'top' ? '顶端对齐' : a === 'middle' ? '垂直居中' : '底端对齐')}
                    </button>
                  ))}
                </div>
              )}
            </Pop>
          )}
          <Pop label={<><span className="text-[15px] leading-none">🔃</span><span>{tf('sheet.picRotate', '旋转')}</span></>} testId="pic-menu-rotate">
            {close => (
              <>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-rot-right" onClick={() => { close(); onCommand('rotate:right') }}>{tf('sheet.rotRight', '向右旋转 90°')}</button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-rot-left" onClick={() => { close(); onCommand('rotate:left') }}>{tf('sheet.rotLeft', '向左旋转 90°')}</button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-rot-fliph" onClick={() => { close(); onCommand('rotate:flipH') }}>{tf('sheet.flipH', '水平翻转')}</button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-rot-flipv" onClick={() => { close(); onCommand('rotate:flipV') }}>{tf('sheet.flipV', '垂直翻转')}</button>
              </>
            )}
          </Pop>
        </div>
      </div>

      {/* ---- 大小 ---- */}
      <div className="flex flex-col items-center px-2">
        <div className="text-[10px] opacity-60 mb-0.5">{tf('sheet.picGroupSize', '大小')}</div>
        <div className="flex items-center gap-1">
          <Pop wide label={<><span className="text-[15px] leading-none">✂️</span><span>{tf('sheet.picCrop', '裁剪')}</span></>} testId="pic-menu-crop">
            {close => (
              <div className="text-xs">
                <button className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-crop-start"
                  onClick={() => { close(); onCommand('crop:start') }}>{tf('sheet.cropStart', '裁剪')}</button>
                <button className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-crop-reset"
                  onClick={() => { close(); onCommand('crop:reset') }}>{tf('sheet.cropReset', '删除裁剪')}</button>
                <button className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-crop-fill"
                  onClick={() => { close(); onCommand('crop:fill') }}>{tf('sheet.cropFill', '填充')}</button>
                <button className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="pic-crop-fit"
                  onClick={() => { close(); onCommand('crop:fit') }}>{tf('sheet.cropFit', '调整')}</button>
                <div className="opacity-60 px-3 pt-2 pb-1">{tf('sheet.cropToShape', '裁剪为形状')}</div>
                {SHAPE_GROUPS.map(g => (
                  <div key={g.name}>
                    <div className="px-3 pt-1.5 pb-0.5 text-[10px] opacity-50">{g.name}</div>
                    <div className="grid grid-cols-5 gap-0.5 px-2 pb-1">
                      {g.items.slice(0, 15).map(it => (
                        <button key={it.prst} title={it.name} data-testid={`pic-crop-shape-${it.prst}`}
                          className={'p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 ' + (p0.geom === it.prst ? 'ring-2 ring-blue-500' : '')}
                          onClick={() => { close(); onCommand(`crop:shape:${it.prst}` as PicCommand) }}>
                          <svg width="26" height="18" viewBox="0 0 26 18" style={{ display: 'block' }}>
                            <path d={shapePath(it.prst, 26, 18) || ''} fill="#8497B0" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="opacity-60 px-3 pt-2 pb-1">{tf('sheet.cropRatio', '纵横比')}</div>
                <div className="grid grid-cols-4 gap-0.5 px-2 pb-2">
                  {['1:1', '4:3', '16:9', '3:2'].map(ratio => (
                    <button key={ratio} className="px-1 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10" data-testid={`pic-crop-ratio-${ratio}`}
                      onClick={() => { close(); onCommand(`crop:ratio:${ratio}` as PicCommand) }}>{ratio}</button>
                  ))}
                </div>
              </div>
            )}
          </Pop>
          {/* 宽高（px）—— 非受控输入：外部尺寸变化通过 key 重挂载同步（拖拽时不停留焦点） */}
          <label className="flex flex-col items-center text-[10px] gap-0.5" title={tf('sheet.picWidth', '宽度（像素）')}>
            <span className="opacity-60">↔ {tf('sheet.picW', '宽度')}</span>
            <input key={`w${rw}`} type="number" defaultValue={rw} className="w-16 px-1 py-0.5 text-xs rounded border border-black/15 dark:border-white/20 bg-transparent text-center"
              data-testid="pic-size-w"
              onChange={e => { const v = parseFloat(e.target.value); if (v > 0) onSize(v, null) }} />
          </label>
          <label className="flex flex-col items-center text-[10px] gap-0.5" title={tf('sheet.picHeight', '高度（像素）')}>
            <span className="opacity-60">↕ {tf('sheet.picH', '高度')}</span>
            <input key={`h${rh}`} type="number" defaultValue={rh} className="w-16 px-1 py-0.5 text-xs rounded border border-black/15 dark:border-white/20 bg-transparent text-center"
              data-testid="pic-size-h"
              onChange={e => { const v = parseFloat(e.target.value); if (v > 0) onSize(null, v) }} />
          </label>
          <label className="flex flex-col items-center text-[10px] gap-0.5" title={tf('sheet.picRotTitle', '旋转角度')}>
            <span className="opacity-60">⤾ {tf('sheet.picRotLabel', '旋转')}</span>
            <input type="number" className="w-14 px-1 py-0.5 text-xs rounded border border-black/15 dark:border-white/20 bg-transparent text-center"
              data-testid="pic-rot-input" value={Math.round(p0.rot)}
              onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onRot(((v % 360) + 360) % 360) }} />
          </label>
          <button className={BTN} title={tf('sheet.picPaneTitle', '设置图片格式')} data-testid="pic-pane-btn" onClick={() => onCommand('pane:open')}>
            <span className="text-[15px] leading-none">🛠️</span><span>{tf('sheet.picPane', '设置图片格式')}</span>
          </button>
          <button className={BTN} title={tf('sheet.picProps', '查看可选文字与属性')} data-testid="pic-props-btn" onClick={() => onCommand('pane:props')}>
            <span className="text-[15px] leading-none">🏷️</span><span>{tf('sheet.picAlt', '可选文字')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default PictureRibbon
