// 中文字号表（对齐 MS Word/Excel 中文字号下拉）：pt → px（96dpi，1pt = 4/3 px）
// 初号42 小初36 一号26 小一24 二号22 小二18 三号16 小三15 四号14 小四12
// 五号10.5 小五9 六号7.5 小六6.5 七号5.5 八号5
export interface CnFontSize { name: string; pt: number; px: number }

export const ptToPx = (pt: number): number => Math.round((pt * 4) / 3 * 10) / 10

const RAW: { name: string; pt: number }[] = [
  { name: '初号', pt: 42 }, { name: '小初', pt: 36 },
  { name: '一号', pt: 26 }, { name: '小一', pt: 24 },
  { name: '二号', pt: 22 }, { name: '小二', pt: 18 },
  { name: '三号', pt: 16 }, { name: '小三', pt: 15 },
  { name: '四号', pt: 14 }, { name: '小四', pt: 12 },
  { name: '五号', pt: 10.5 }, { name: '小五', pt: 9 },
  { name: '六号', pt: 7.5 }, { name: '小六', pt: 6.5 },
  { name: '七号', pt: 5.5 }, { name: '八号', pt: 5 },
]

export const CN_FONT_SIZES: CnFontSize[] = RAW.map(s => ({ ...s, px: ptToPx(s.pt) }))

// px → 中文字号名（四舍五入到 0.1px 再匹配；找不到返回空串）
export function pxToCnSizeName(px: number): string {
  const v = Math.round(px * 10) / 10
  const hit = CN_FONT_SIZES.find(s => s.px === v)
  return hit ? hit.name : ''
}

// 把用户在字号框里的输入解析为 px 字符串；无法解析返回 ''。
// 本应用内部字号统一以 px 存储（与 +/- 增减按钮一致），因此数字输入按 px 处理；
// 中文字号名（如 “小四”）映射到对应 px 值。
export function resolveFontSizeInput(raw: string): string {
  const v = (raw || '').trim()
  if (!v) return ''
  const cn = CN_FONT_SIZES.find(s => s.name === v)
  if (cn) return `${cn.px}px`
  const num = parseFloat(v)
  if (!isNaN(num) && num > 0) return `${num}px`
  return ''
}
