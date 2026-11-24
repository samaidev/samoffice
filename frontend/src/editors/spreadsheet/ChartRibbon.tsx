/**
 * ChartRibbon.tsx —— round61：「图表设计」上下文选项卡（对齐 Excel Chart Design）。
 * 分组：类型（12 种图表类型库）、数据（切换行/列、选择数据）、图表布局（图表标题、
 * 数据标签、图例、网格线）、排列（沿用浮层对象逻辑，仅在多对象时显示对齐）。
 */
import React, { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { ChartSpec, ChartType, CHART_TYPES, isCartesian } from './charts'

export type ChartCommand =
  | `type:${string}`
  | 'data:switchRowCol'
  | 'data:select'
  | 'title:toggle'
  | 'title:edit'
  | 'labels:none' | `labels:${string}`
  | `legend:${string}`
  | 'gridlines:toggle'
  | 'arrange:front' | 'arrange:back' | 'arrange:forward' | 'arrange:backward'
  | `align:${string}`
  | 'delete'

export interface ChartRibbonProps {
  charts: ChartSpec[]          // 选中的图表
  onCommand: (cmd: ChartCommand) => void
}

const BTN = 'flex flex-col items-center justify-center gap-0.5 px-2.5 py-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-[11px] leading-tight min-w-[52px] cursor-pointer select-none'

/** 小型下拉（点击外部关闭） */
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
        <div className={'absolute z-50 top-full left-0 mt-1 rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-gray-800 shadow-xl py-1 max-h-[400px] overflow-auto ' + (wide ? 'w-[340px]' : 'w-[220px]')}
          style={{ color: 'var(--color-text,#111)' }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

const ChartRibbon: React.FC<ChartRibbonProps> = ({ charts, onCommand }) => {
  const { tf } = useI18n()
  const c0 = charts[0]
  if (!c0) return null
  const multi = charts.length > 1

  return (
    <div className="flex items-stretch gap-1 flex-wrap px-1 py-1">
      {/* ---- 类型 ---- */}
      <div className="flex flex-col items-center px-2 border-r border-black/10 dark:border-white/15">
        <div className="text-[10px] opacity-60 mb-0.5">{tf('sheet.chartGroupType', '类型')}</div>
        <div className="flex gap-1 overflow-x-auto max-w-[560px]" data-testid="chart-type-gallery">
          {CHART_TYPES.map(g => g.items.map(it => (
            <button key={it.type} data-testid={`chart-type-${it.type}`} title={`${g.group} · ${it.name}`}
              className={'shrink-0 flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded border text-[10px] ' +
                (c0.type === it.type ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-600' : 'border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10')}
              onClick={() => onCommand(`type:${it.type}` as ChartCommand)}>
              <span className="text-[15px] leading-none">{it.icon}</span>
              <span className="whitespace-nowrap">{it.name}</span>
            </button>
          )))}
        </div>
      </div>

      {/* ---- 数据 ---- */}
      <div className="flex flex-col items-center px-2 border-r border-black/10 dark:border-white/15">
        <div className="text-[10px] opacity-60 mb-0.5">{tf('sheet.chartGroupData', '数据')}</div>
        <div className="flex">
          <button className={BTN} data-testid="chart-switch-rc" title={tf('sheet.chartSwitchRC', '切换行/列')} onClick={() => onCommand('data:switchRowCol')}>
            <span className="text-[15px] leading-none">⇄</span><span>{tf('sheet.chartSwitchRC', '切换行/列')}</span>
          </button>
          <button className={BTN} data-testid="chart-select-data" title={tf('sheet.chartSelectData', '选择数据源区域')} onClick={() => onCommand('data:select')}>
            <span className="text-[15px] leading-none">🔤</span><span>{tf('sheet.chartSelectData', '选择数据')}</span>
          </button>
        </div>
      </div>

      {/* ---- 图表布局 ---- */}
      <div className="flex flex-col items-center px-2 border-r border-black/10 dark:border-white/15">
        <div className="text-[10px] opacity-60 mb-0.5">{tf('sheet.chartGroupLayout', '图表布局')}</div>
        <div className="flex">
          <button className={BTN} data-testid="chart-title-toggle" title={tf('sheet.chartTitle', '图表标题')}
            onClick={() => onCommand('title:toggle')}>
            <span className="text-[15px] leading-none">🅣</span><span>{tf('sheet.chartTitle', '图表标题')}</span>
          </button>
          <Pop label={<><span className="text-[15px] leading-none">🔢</span><span>{tf('sheet.chartLabels', '数据标签')}</span></>} testId="chart-menu-labels">
            {close => (
              <>
                {['none', 'ctr', 'inEnd', 'outEnd'].map(v => (
                  <button key={v} className={'w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded ' + (c0.dataLabels === v ? 'text-blue-600 font-medium' : '')}
                    data-testid={`chart-label-${v}`}
                    onClick={() => { close(); onCommand(`labels:${v}` as ChartCommand) }}>
                    {v === 'none' ? tf('sheet.chartLabelNone', '无') : v === 'ctr' ? tf('sheet.chartLabelCtr', '居中') : v === 'inEnd' ? tf('sheet.chartLabelIn', '数据标签内') : tf('sheet.chartLabelOut', '数据标签外')}
                  </button>
                ))}
              </>
            )}
          </Pop>
          <Pop label={<><span className="text-[15px] leading-none">📋</span><span>{tf('sheet.chartLegend', '图例')}</span></>} testId="chart-menu-legend">
            {close => (
              <>
                {[['none', '无'], ['r', '右侧'], ['b', '底部'], ['l', '左侧'], ['t', '顶部']].map(([v, name]) => (
                  <button key={v} className={'w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded ' + (c0.legend === v ? 'text-blue-600 font-medium' : '')}
                    data-testid={`chart-legend-${v}`}
                    onClick={() => { close(); onCommand(`legend:${v}` as ChartCommand) }}>
                    {tf(`sheet.chartLegendPos.${v}`, name)}
                  </button>
                ))}
              </>
            )}
          </Pop>
          {isCartesian(c0.type) && (
            <button className={BTN} data-testid="chart-gridlines" title={tf('sheet.chartGridlines', '网格线')} onClick={() => onCommand('gridlines:toggle')}>
              <span className="text-[15px] leading-none">▦</span><span>{tf('sheet.chartGridlines', '网格线')}</span>
            </button>
          )}
        </div>
      </div>

      {/* ---- 排列 ---- */}
      <div className="flex flex-col items-center px-2">
        <div className="text-[10px] opacity-60 mb-0.5">{tf('sheet.chartGroupArrange', '排列')}</div>
        <div className="flex">
          <Pop label={<><span className="text-[15px] leading-none">⧉</span><span>{tf('sheet.picOrder', '上移一层')}</span></>} testId="chart-menu-order">
            {close => (
              <>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="chart-order-front" onClick={() => { close(); onCommand('arrange:front') }}>{tf('sheet.picFront', '置于顶层')}</button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" onClick={() => { close(); onCommand('arrange:forward') }}>{tf('sheet.picForward', '上移一层')}</button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" onClick={() => { close(); onCommand('arrange:backward') }}>{tf('sheet.picBackward', '下移一层')}</button>
                <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded" data-testid="chart-order-back" onClick={() => { close(); onCommand('arrange:back') }}>{tf('sheet.picBack', '置于底层')}</button>
              </>
            )}
          </Pop>
          {multi && (
            <Pop label={<><span className="text-[15px] leading-none">⇹</span><span>{tf('sheet.picAlign', '对齐')}</span></>} testId="chart-menu-align">
              {close => (
                <div className="grid grid-cols-2">
                  {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map(a => (
                    <button key={a} className="text-left px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10 rounded"
                      data-testid={`chart-align-${a}`}
                      onClick={() => { close(); onCommand(`align:${a}` as ChartCommand) }}>
                      {tf(`sheet.align.${a}`, a)}
                    </button>
                  ))}
                </div>
              )}
            </Pop>
          )}
          <button className={BTN} data-testid="chart-delete" title={tf('sheet.picMenuDelete', '删除')} onClick={() => onCommand('delete')}>
            <span className="text-[15px] leading-none">🗑</span><span>{tf('sheet.picMenuDelete', '删除')}</span>
          </button>
        </div>
      </div>

      {/* 状态提示 */}
      <div className="flex items-end px-2 text-[10px] opacity-50 whitespace-nowrap">
        {c0.rangeRef ? `${tf('sheet.chartRange', '数据')} ${c0.rangeRef}${c0.byRows ? ' · ' + tf('sheet.chartByRows', '按行') : ''}` : ''}
      </div>
    </div>
  )
}

export default ChartRibbon
