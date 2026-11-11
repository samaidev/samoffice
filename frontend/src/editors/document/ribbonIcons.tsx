// MS Office 风格的功能区 SVG 图标库（替代 Unicode 箭头/符号）。
// 此前段落对齐按钮用 ⬅⬌➡☰ 等字符，在 Windows WebView2 上渲染成
// 与"对齐"毫无关系的方向箭头/菜单符号，用户无法识别（反馈"按钮都没有"）。
// 统一改为 14px 线性 SVG 图标，视觉对齐 MS Word。

interface IconProps {
  color?: string
  size?: number
}

const svgProps = (size = 14) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none' as const,
  xmlns: 'http://www.w3.org/2000/svg',
})

const line = {
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
}

// === 段落对齐 ===
export const IconAlignLeft = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M1.5 3.5h13M1.5 7h7.5M1.5 10.5h13M1.5 14h7.5" {...line} transform="translate(0 -1)" />
  </svg>
)
export const IconAlignCenter = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M1.5 2.5h13M4 6h8M1.5 9.5h13M4 13h8" {...line} />
  </svg>
)
export const IconAlignRight = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M1.5 2.5h13M7 6h7.5M1.5 9.5h13M7 13h7.5" {...line} />
  </svg>
)
export const IconAlignJustify = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M1.5 2.5h13M1.5 6h13M1.5 9.5h13M1.5 13h13" {...line} />
  </svg>
)

// === 列表 ===
export const IconBulletList = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <circle cx="2.6" cy="3.2" r="1.3" fill="currentColor" />
    <circle cx="2.6" cy="8" r="1.3" fill="currentColor" />
    <circle cx="2.6" cy="12.8" r="1.3" fill="currentColor" />
    <path d="M6.5 3.2h8.5M6.5 8h8.5M6.5 12.8h8.5" {...line} />
  </svg>
)
export const IconNumberList = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <text x="0.4" y="4.9" fontSize="5.2" fontWeight="700" fill="currentColor">1</text>
    <text x="0.4" y="9.7" fontSize="5.2" fontWeight="700" fill="currentColor">2</text>
    <text x="0.4" y="14.5" fontSize="5.2" fontWeight="700" fill="currentColor">3</text>
    <path d="M6.5 3.2h8.5M6.5 8h8.5M6.5 12.8h8.5" {...line} />
  </svg>
)

// === 缩进 ===
export const IconIndentInc = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M2 2.5h12M2 13.5h12" {...line} />
    <path d="M7.5 5.5 10.5 8l-3 2.5" {...line} strokeLinejoin="round" />
    <path d="M4.5 5.5v5" {...line} />
  </svg>
)
export const IconIndentDec = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M2 2.5h12M2 13.5h12" {...line} />
    <path d="M10.5 5.5 7.5 8l3 2.5" {...line} strokeLinejoin="round" />
    <path d="M4.5 5.5v5" {...line} />
  </svg>
)

// === 行距 / 段间距 ===
export const IconLineSpacing = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M3.5 2v12" {...line} />
    <path d="M1.5 4 3.5 2l2 2M1.5 12l2 2 2-2" {...line} strokeLinejoin="round" />
    <path d="M7.5 3h8M7.5 8h8M7.5 13h8" {...line} />
  </svg>
)
export const IconSpaceBefore = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M8 10.5v-8M5.5 4.5 8 2l2.5 2.5" {...line} strokeLinejoin="round" />
    <path d="M3 13h10" {...line} />
    <path d="M3 10.8h10" {...line} opacity="0.45" />
  </svg>
)
export const IconSpaceAfter = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M8 2v8M5.5 7.5 8 10l2.5-2.5" {...line} strokeLinejoin="round" />
    <path d="M3 13h10" {...line} />
    <path d="M3 2.2h10" {...line} opacity="0.45" />
  </svg>
)

// === 上下标 ===
export const IconSuperscript = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <text x="1" y="12.5" fontSize="11" fontWeight="600" fill="currentColor" fontFamily="Georgia, serif">X</text>
    <text x="9.5" y="6.5" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="Georgia, serif">2</text>
  </svg>
)
export const IconSubscript = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <text x="1" y="10.5" fontSize="11" fontWeight="600" fill="currentColor" fontFamily="Georgia, serif">X</text>
    <text x="9.5" y="14.5" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="Georgia, serif">2</text>
  </svg>
)

// === 颜色类（A + 色条，色条颜色跟随当前色） ===
export const IconFontColor = ({ color, size = 14 }: IconProps = {}) => (
  <svg {...svgProps(size)}>
    <text x="8" y="11" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="currentColor" fontFamily="Georgia, serif">A</text>
    <rect x="2" y="12.4" width="12" height="3" rx="0.8" fill={color || 'currentColor'} />
  </svg>
)
export const IconHighlight = ({ color, size = 14 }: IconProps = {}) => (
  <svg {...svgProps(size)}>
    <path d="M9.8 2.2 13.8 6.2 7.6 12.4 3.6 12.4 3.6 8.4z" fill="currentColor" opacity="0.85" />
    <path d="M9.8 2.2 13.8 6.2" stroke="var(--color-surface)" strokeWidth="0.8" />
    <rect x="2" y="13" width="12" height="2.6" rx="0.8" fill={color || '#fef08a'} />
  </svg>
)
export const IconShading = ({ color, size = 14 }: IconProps = {}) => (
  <svg {...svgProps(size)}>
    <path d="M8.2 1.8 12.6 6.2a4.8 4.8 0 1 1-8.8 1.4c.3-1.5 1.5-2.6 2.4-3.5z" fill="currentColor" opacity="0.85" />
    <rect x="2" y="13" width="12" height="2.6" rx="0.8" fill={color || 'currentColor'} />
  </svg>
)

// === 垂直对齐（表格单元格 / 文本框）===
export const IconVAlignTop = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M2 2.8h12" {...line} />
    <rect x="4.5" y="5" width="7" height="3.4" rx="0.8" fill="currentColor" opacity="0.85" />
    <rect x="3.5" y="9.8" width="9" height="3.4" rx="0.8" fill="currentColor" opacity="0.4" />
  </svg>
)
export const IconVAlignMiddle = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M2 8h12" {...line} />
    <rect x="4.5" y="1.8" width="7" height="3.4" rx="0.8" fill="currentColor" opacity="0.4" />
    <rect x="3.5" y="10.8" width="9" height="3.4" rx="0.8" fill="currentColor" opacity="0.85" />
  </svg>
)
export const IconVAlignBottom = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <path d="M2 13.2h12" {...line} />
    <rect x="4.5" y="7.6" width="7" height="3.4" rx="0.8" fill="currentColor" opacity="0.85" />
    <rect x="3.5" y="2.8" width="9" height="3.4" rx="0.8" fill="currentColor" opacity="0.4" />
  </svg>
)

// === 文字方向（竖排）===
export const IconTextDirection = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <text x="3" y="6.8" fontSize="7.5" fontWeight="700" fill="currentColor" fontFamily="Georgia, serif">A</text>
    <text x="3" y="14" fontSize="7.5" fontWeight="700" fill="currentColor" opacity="0.5" fontFamily="Georgia, serif">A</text>
    <path d="M11.5 2v10M9 9.5l2.5 2.5 2.5-2.5" {...line} strokeLinejoin="round" />
  </svg>
)

// === 字号增减 ===
export const IconFontSizeUp = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <text x="1" y="13" fontSize="12" fontWeight="700" fill="currentColor" fontFamily="Georgia, serif">A</text>
    <path d="M12.5 6V1.5M10.5 3.5l2-2 2 2" {...line} strokeLinejoin="round" />
  </svg>
)
export const IconFontSizeDown = (p: IconProps = {}) => (
  <svg {...svgProps(p.size)}>
    <text x="1" y="13" fontSize="12" fontWeight="700" fill="currentColor" fontFamily="Georgia, serif">A</text>
    <path d="M12.5 1.5V6M10.5 4l2 2 2-2" {...line} strokeLinejoin="round" />
  </svg>
)
