/**
 * ChartRibbon.tsx —— round61：「图表设计」上下文选项卡（对齐 Excel Chart Design）。
 * 分组：类型（12 种图表类型库）、数据（切换行/列、选择数据）、图表布局（图表标题、
 * 数据标签、图例、网格线）、排列（沿用浮层对象逻辑，仅在多对象时显示对齐）。
 */
import React, { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { ChartSpec, ChartType, CHART_TYPES, isCartesian, AxisConfig } from './charts'

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
  /** round62：轴属性编辑（axis = 'cat' | 'val'；value 为 JSON 编码的补丁值） */
  | `axis:${'cat' | 'val'}:${'title' | 'min' | 'max' | 'majorUnit' | 'minorUnit' | 'majorTick' | 'minorTick' | 'tickLabelPos' | 'numFmt' | 'reverse' | 'logBase' | 'lineColor' | 'lineWidth' | 'majorGridlines'}:${string}`

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

/** round62：单个轴的编辑面板（「设置坐标轴格式」对齐 Excel）
 *  字段：标题 / 最小-最大 / 主-次刻度单位 / 刻度线类型 / 标签位置 / 数字格式 /
 *  逆序 / 对数 / 线条颜色-宽度 / 网格线。所有改动即时经 onCommand 回传编辑器。
 */
const AxisEditor: React.FC<{
  chart: ChartSpec
  which: 'cat' | 'val'
  onCommand: (cmd: ChartCommand) => void
  close: () => void
}> = ({ chart, which, onCommand, close }) => {
  const { tf } = useI18n()
  const ax: AxisConfig = which === 'cat' ? chart.catAxis : chart.valAxis
  const isVal = which === 'val'
  const scatter = chart.type === 'scatter'
  // 数值轴编辑仅对数值刻度有效；类别轴的 min/max/单位/对数仅散点 x 轴（数值）开放
  const numScale = isVal || (scatter && which === 'cat')
  type AxisField = 'title' | 'min' | 'max' | 'majorUnit' | 'minorUnit' | 'majorTick' | 'minorTick' | 'tickLabelPos' | 'numFmt' | 'reverse' | 'logBase' | 'lineColor' | 'lineWidth' | 'majorGridlines'
  const cmd = (field: AxisField) => (value: string) =>
    onCommand(`axis:${which}:${field}:${value}` as ChartCommand)
  const num = (v: string) => (v.trim() === '' ? 'null' : v)
  const FLD = 'w-full flex items-center justify-between gap-2 px-3 py-1 text-xs'
  const NUMCLS = 'w-20 rounded border border-black/15 dark:border-white/20 bg-transparent px-1.5 py-0.5 text-xs'
  const SELCLS = 'w-28 rounded border border-black/15 dark:border-white/20 bg-transparent px-1.5 py-0.5 text-xs'

  return (
    <div className="w-[300px] pb-1" data-testid={`axis-editor-${which}`}>
      <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium border-b mb-1" style={{ borderColor: 'var(--color-border)' }}>
        {which === 'cat' ? tf('sheet.chartAxisCat', '坐标轴：水平（类别）轴') : tf('sheet.chartAxisVal', '坐标轴：垂直（值）轴')}
      </div>
      {/* 轴标题 */}
      <div className={FLD}>
        <span className="whitespace-nowrap">{tf('sheet.chartAxisTitle', '轴标题')}</span>
        <input className={NUMCLS} style={{ width: 150 }} defaultValue={ax.title} placeholder={tf('sheet.chartAxisTitlePh', '无')}
          data-testid={`ax-${which}-title`}
          onBlur={e => { if (e.target.value !== ax.title) cmd('title')(e.target.value) }} />
      </div>
      {numScale && (
        <div className={FLD}>
          <span className="whitespace-nowrap">{tf('sheet.chartAxisMin', '最小值')}</span>
          <input className={NUMCLS} defaultValue={ax.min ?? ''} placeholder="自动" data-testid={`ax-${which}-min`}
            onBlur={e => cmd('min')(num(e.target.value))} />
        </div>
      )}
      {numScale && (
        <div className={FLD}>
          <span className="whitespace-nowrap">{tf('sheet.chartAxisMax', '最大值')}</span>
          <input className={NUMCLS} defaultValue={ax.max ?? ''} placeholder="自动" data-testid={`ax-${which}-max`}
            onBlur={e => cmd('max')(num(e.target.value))} />
        </div>
      )}
      {numScale && (
        <div className={FLD}>
          <span className="whitespace-nowrap">{tf('sheet.chartAxisMajorUnit', '主要刻度单位')}</span>
          <input className={NUMCLS} defaultValue={ax.majorUnit ?? ''} placeholder="自动" data-testid={`ax-${which}-majorUnit`}
            onBlur={e => cmd('majorUnit')(num(e.target.value))} />
        </div>
      )}
      {numScale && (
        <div className={FLD}>
          <span className="whitespace-nowrap">{tf('sheet.chartAxisMinorUnit', '次要刻度单位')}</span>
          <input className={NUMCLS} defaultValue={ax.minorUnit ?? ''} placeholder="自动" data-testid={`ax-${which}-minorUnit`}
            onBlur={e => cmd('minorUnit')(num(e.target.value))} />
        </div>
      )}
      {/* 刻度线 */}
      <div className={FLD}>
        <span className="whitespace-nowrap">{tf('sheet.chartAxisMajorTick', '主要刻度线')}</span>
        <select className={SELCLS} value={ax.majorTick || ''} data-testid={`ax-${which}-majorTick`}
          onChange={e => cmd('majorTick')(e.target.value)}>
          <option value="">{tf('sheet.chartAxisTickDef', '默认（外部）')}</option>
          <option value="none">{tf('sheet.chartAxisTickNone', '无')}</option>
          <option value="inside">{tf('sheet.chartAxisTickIn', '内部')}</option>
          <option value="outside">{tf('sheet.chartAxisTickOut', '外部')}</option>
          <option value="cross">{tf('sheet.chartAxisTickCross', '交叉')}</option>
        </select>
      </div>
      <div className={FLD}>
        <span className="whitespace-nowrap">{tf('sheet.chartAxisMinorTick', '次要刻度线')}</span>
        <select className={SELCLS} value={ax.minorTick || ''} data-testid={`ax-${which}-minorTick`}
          onChange={e => cmd('minorTick')(e.target.value)}>
          <option value="">{tf('sheet.chartAxisTickNone', '无')}</option>
          <option value="inside">{tf('sheet.chartAxisTickIn', '内部')}</option>
          <option value="outside">{tf('sheet.chartAxisTickOut', '外部')}</option>
          <option value="cross">{tf('sheet.chartAxisTickCross', '交叉')}</option>
        </select>
      </div>
      {/* 轴标签位置 */}
      <div className={FLD}>
        <span className="whitespace-nowrap">{tf('sheet.chartAxisLblPos', '轴标签')}</span>
        <select className={SELCLS} value={ax.tickLabelPos || ''} data-testid={`ax-${which}-lblPos`}
          onChange={e => cmd('tickLabelPos')(e.target.value)}>
          <option value="">{tf('sheet.chartAxisLblNext', '轴旁')}</option>
          <option value="high">{tf('sheet.chartAxisLblHigh', '高')}</option>
          <option value="low">{tf('sheet.chartAxisLblLow', '低')}</option>
          <option value="none">{tf('sheet.chartAxisLblNone', '无')}</option>
        </select>
      </div>
      {/* 数字格式 */}
      <div className={FLD}>
        <span className="whitespace-nowrap">{tf('sheet.chartAxisNumFmt', '数字格式')}</span>
        <select className={SELCLS} value={ax.numFmt || ''} data-testid={`ax-${which}-numFmt`}
          onChange={e => cmd('numFmt')(e.target.value)}>
          <option value="">General</option>
          <option value="0">0</option>
          <option value="0.0">0.0</option>
          <option value="0.00">0.00</option>
          <option value="#,##0">#,##0</option>
          <option value="#,##0.0">#,##0.0</option>
          <option value="0%">0%</option>
          <option value="0.0%">0.0%</option>
        </select>
      </div>
      {numScale && (
        <div className={FLD}>
          <span className="whitespace-nowrap">{tf('sheet.chartAxisLog', '对数刻度')}</span>
          <div className="flex items-center gap-1">
            <input type="checkbox" checked={ax.logBase != null} data-testid={`ax-${which}-log`}
              onChange={e => cmd('logBase')(e.target.checked ? '10' : 'null')} />
            {ax.logBase != null && <input className={NUMCLS} style={{ width: 46 }} defaultValue={ax.logBase}
              onBlur={e => cmd('logBase')(e.target.value || '10')} />}
          </div>
        </div>
      )}
      <div className={FLD}>
        <span className="whitespace-nowrap">{tf('sheet.chartAxisReverse', '逆序类别/值')}</span>
        <input type="checkbox" checked={ax.reverse} data-testid={`ax-${which}-reverse`}
          onChange={e => cmd('reverse')(e.target.checked ? '1' : '0')} />
      </div>
      {/* 线条样式 */}
      <div className={FLD}>
        <span className="whitespace-nowrap">{tf('sheet.chartAxisLineColor', '线条颜色')}</span>
        <input type="color" className="h-6 w-10 rounded border border-black/15" value={ax.lineColor || '#8c8c8c'}
          data-testid={`ax-${which}-lineColor`}
          onChange={e => cmd('lineColor')(e.target.value)} />
      </div>
      <div className={FLD}>
        <span className="whitespace-nowrap">{tf('sheet.chartAxisLineWidth', '线条宽度 (pt)')}</span>
        <input className={NUMCLS} style={{ width: 60 }} defaultValue={ax.lineWidth || ''} placeholder="默认" data-testid={`ax-${which}-lineWidth`}
          onBlur={e => cmd('lineWidth')(e.target.value.trim() === '' ? '0' : e.target.value)} />
      </div>
      {/* 类别轴网格线（数值轴走总开关） */}
      {!isVal && (
        <div className={FLD}>
          <span className="whitespace-nowrap">{tf('sheet.chartAxisCatGrid', '类别网格线')}</span>
          <input type="checkbox" checked={ax.majorGridlines} data-testid={`ax-${which}-grid`}
            onChange={e => cmd('majorGridlines')(e.target.checked ? '1' : '0')} />
        </div>
      )}
      <button className="w-full text-left px-3 py-1 text-xs opacity-70 hover:opacity-100" onClick={close}>
        {tf('sheet.chartAxisClose', '完成')}
      </button>
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
          {isCartesian(c0.type) && (
            <Pop label={<><span className="text-[15px] leading-none">↕</span><span>{tf('sheet.chartAxes', '坐标轴')}</span></>} wide testId="chart-menu-cat-axis">
              {close => <AxisEditor chart={c0} which="cat" onCommand={onCommand} close={close} />}
            </Pop>
          )}
          {isCartesian(c0.type) && (
            <Pop label={<><span className="text-[15px] leading-none">↕</span><span>{tf('sheet.chartAxisValBtn', '垂直轴')}</span></>} wide testId="chart-menu-val-axis">
              {close => <AxisEditor chart={c0} which="val" onCommand={onCommand} close={close} />}
            </Pop>
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
