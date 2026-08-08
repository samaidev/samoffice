package core

import "encoding/json"

// Document 是 SamOffice 的统一文档模型 (UDM)。
// 所有格式 (docx/xlsx/pptx/md) 先解析为 UDM，再渲染或导出。
//
// 设计原则：
//  1. 容错：未知元素存入 Raw，不丢失数据
//  2. 双向：UDM 可序列化为 JSON，前后端共用
//  3. 可扩展：Block/Inline 用 interface，新增类型不破坏旧代码
type Document struct {
	Meta       Meta             `json:"meta"`
	Blocks     []Block          `json:"blocks"`
	Comments   []Comment        `json:"comments,omitempty"`
	Styles     []StyleDef       `json:"styles,omitempty"`
	PageNumber *PageNumberConfig `json:"pageNumber,omitempty"`
	Protect    *DocumentProtect  `json:"protect,omitempty"`
	Warnings   []Warning        `json:"warnings,omitempty"`
	Raw        map[string]any   `json:"raw,omitempty"`
}

// DocumentProtect 描述文档保护（密码锁定）配置。
// 保存时该信息会随 UDM 一并持久化（docx 写入 docProps/samoffice_protect.xml），
// 重新打开文档后若 Enabled 为 true，编辑器进入只读并要求输入密码解锁。
// Hash 为密码的哈希值（前端计算），盘上不存明文密码。
type DocumentProtect struct {
	Enabled bool   `json:"enabled"`
	Hash    string `json:"hash"`
}

// PageNumberConfig 描述页脚中页码字段的样式与格式。
// 该配置为文档级，导出 docx 时生成带 PAGE 字段的页脚。
type PageNumberConfig struct {
	Enabled            bool    `json:"enabled"`
	Format             string  `json:"format"` // 支持 {n}(当前页) 与 {total}(总页数)，如 "第 {n} 页"、"第 {n} / 共 {total} 页"、"Page {n} of {total}"
	Align              string  `json:"align,omitempty"`
	FontFamily         string  `json:"fontFamily,omitempty"`
	FontSize           float64 `json:"fontSize,omitempty"` // 半磅，9 = 4.5pt
	FontColor          string  `json:"fontColor,omitempty"`
	Bold               bool    `json:"bold,omitempty"`
	Italic             bool    `json:"italic,omitempty"`
	FirstPageDifferent bool    `json:"firstPageDifferent,omitempty"` // 首页不显示页码
}

// PageBreak 分页符；restart 为 true 时从此处开始重新计算页码（生成分节 + 重启编号）。
type PageBreak struct {
	Restart     bool `json:"restart,omitempty"`
	StartNumber int  `json:"startNumber,omitempty"`
}

func (PageBreak) isBlock()         {}
func (PageBreak) BlockType() string { return "pageBreak" }

// FootnoteRef 正文中的脚注引用标记（上标编号，如 [1]）。
// 渲染时由前端 schema 的 footnote 节点显示，并携带 content 供 hover 提示。
type FootnoteRef struct {
	Type    string `json:"type"`    // "footnote"
	Num     int    `json:"num"`     // 引用顺序编号（从 1 开始）
	Content string `json:"content"` // 对应脚注正文
}

func (FootnoteRef) isInline()          {}
func (FootnoteRef) InlineType() string { return "footnote" }

// FootnoteItem 单条脚注内容。
type FootnoteItem struct {
	Num    int      `json:"num"`
	Inline []Inline `json:"inline"`
}

// FootnoteSection 文档底部的脚注区，通常位于所有正文块之后。
// 由前端 schema 的 footnote_section / footnote_item 节点渲染（分隔线 + 编号列表）。
type FootnoteSection struct {
	Type  string         `json:"type"` // "footnote_section"
	Items []FootnoteItem `json:"items"`
}

func (FootnoteSection) isBlock()         {}
func (FootnoteSection) BlockType() string { return "footnote_section" }

type Meta struct {
	Title       string `json:"title"`
	Author      string `json:"author,omitempty"`
	Subject     string `json:"subject,omitempty"`
	Description string `json:"description,omitempty"`
	CreatedAt   string `json:"createdAt,omitempty"`
	ModifiedAt  string `json:"modifiedAt,omitempty"`
	Language    string `json:"language,omitempty"`
}

type Comment struct {
	ID      string  `json:"id"`
	Author  string  `json:"author"`
	Content string  `json:"content"`
	Anchor  string  `json:"anchor,omitempty"`
}

type StyleDef struct {
	Name   string         `json:"name"`
	Type   string         `json:"type"` // paragraph | character | table
	Parent string         `json:"parent,omitempty"`
	Props  map[string]any `json:"props,omitempty"`
}

type Warning struct {
	Level   string `json:"level"` // info | warn | error
	Stage   string `json:"stage"` // unzip | xml | schema | map
	Message string `json:"message"`
	Path    string `json:"path,omitempty"`
}

// Block 是块级元素（段落/标题/表格/图片等）
type Block interface {
	isBlock()
	BlockType() string
}

// Inline 是行内元素（文本/链接/图片等）
type Inline interface {
	isInline()
	InlineType() string
}

// === 块级实现 ===

type Paragraph struct {
	Inline []Inline       `json:"inline"`
	Style  string         `json:"style,omitempty"`
	Align  string         `json:"align,omitempty"`
	Props  map[string]any `json:"props,omitempty"`
}

func (Paragraph) isBlock()        {}
func (Paragraph) BlockType() string { return "paragraph" }

type Heading struct {
	Level  int             `json:"level"`
	Inline []Inline        `json:"inline"`
	Style  string          `json:"style,omitempty"`
	Align  string          `json:"align,omitempty"` // left | center | right | justify
	Props  map[string]any  `json:"props,omitempty"`
}

func (Heading) isBlock()        {}
func (Heading) BlockType() string { return "heading" }

type BulletList struct {
	Items  [][]Block `json:"items"`
	Ordered bool     `json:"ordered"`
	Start  int       `json:"start,omitempty"` // 列表起始序号；用于被正文隔开的同列表项续号
	Style  string    `json:"style,omitempty"` // "references"：参考文献列表 [n]；否则为 CSS list-style-type（如 decimal/cjk-ideographic）
	Ilfo   int       `json:"-"`               // 内部：所属 Word 列表 id，用于跨段落续号判断
}

func (BulletList) isBlock()        {}
func (BulletList) BlockType() string { return "bulletList" }

type Table struct {
	Rows  [][]TableCell `json:"rows"`
	Width []float64     `json:"width,omitempty"`
	Style string        `json:"style,omitempty"`
	// Border 为表格边框线宽（点，pt）。<=0 表示未解析到，由前端回退到默认 1px。
	Border float64 `json:"border,omitempty"`
}

func (Table) isBlock()        {}
func (Table) BlockType() string { return "table" }

type TableCell struct {
	Inline   []Inline `json:"inline,omitempty"`
	Blocks   []Block  `json:"blocks,omitempty"`
	RowSpan  int      `json:"rowSpan,omitempty"`
	ColSpan  int      `json:"colSpan,omitempty"`
	IsHeader bool     `json:"isHeader,omitempty"`
	Formula  string   `json:"formula,omitempty"` // 单元格公式（xls/xlsx 解析填充）
	// VMerge 为垂直合并中间态（不进 JSON）：0=不合并 1=被合并占位 3=合并起点。
	VMerge int `json:"-"`
}

type Image struct {
	Src     string   `json:"src"`
	Width   float64  `json:"width,omitempty"`
	Height  float64  `json:"height,omitempty"`
	Caption []Inline `json:"caption,omitempty"`
	Alt     string   `json:"alt,omitempty"`
	Float   string   `json:"float,omitempty"`
	Align   string   `json:"align,omitempty"`
}

func (Image) isBlock()        {}
func (Image) BlockType() string { return "image" }

type CodeBlock struct {
	Language string `json:"language,omitempty"`
	Code     string `json:"code"`
}

func (CodeBlock) isBlock()        {}
func (CodeBlock) BlockType() string { return "codeBlock" }

// Math 数学公式块（LaTeX）。导出 docx 时转为 OMML（m:oMath）。
type Math struct {
	Formula string `json:"formula"`
	Inline  bool   `json:"inline,omitempty"`
}

func (Math) isBlock()        {}
func (Math) BlockType() string { return "math" }

// Textbox 文本框/形状块。包含内部块（标题、段落、图片等），以及几何与
// 样式属性：边框宽度 borderW(pt)、线型 lineStyle(solid|dash|dot|dashDot)、
// 边框色 borderColor(#RRGGBB)、填充色 bgColor(#RRGGBB，空=无填充)、
// 形状 shape(rect|roundRect|ellipse|triangle|diamond|rightArrow|star5|heart)、
// 宽度 width(px，0=auto)、绕排 float(''|left|right)。
type Textbox struct {
	Type        string  `json:"type"`          // 固定 "textbox"，用于 JSON 反序列化判别
	Blocks      []Block `json:"inline,omitempty"` // 前端发送 "inline" 键，值为 blocks 数组
	W           float64 `json:"w,omitempty"`
	H           float64 `json:"h,omitempty"`
	X           float64 `json:"x,omitempty"`
	Y           float64 `json:"y,omitempty"`
	BorderW     float64 `json:"borderW,omitempty"`
	LineStyle   string  `json:"lineStyle,omitempty"`
	BorderColor string  `json:"borderColor,omitempty"`
	FillColor   string  `json:"bgColor,omitempty"`
	Shape       string  `json:"shape,omitempty"`
	Width       float64 `json:"width,omitempty"`
	Wrap        string  `json:"float,omitempty"`
	Radius      float64 `json:"radius,omitempty"`
	Rotation    float64 `json:"rotation,omitempty"`
}

func (Textbox) isBlock()        {}
func (Textbox) BlockType() string { return "textbox" }

// Textbox 自定义反序列化：处理 Blocks 接口字段（前端以 "inline" 键发送 blocks 数组）
func (b *Textbox) UnmarshalJSON(data []byte) error {
	type alias struct {
		Type        string            `json:"type"`
		Blocks      []json.RawMessage `json:"inline"`
		W           float64           `json:"w"`
		H           float64           `json:"h"`
		X           float64           `json:"x"`
		Y           float64           `json:"y"`
		BorderW     float64           `json:"borderW"`
		LineStyle   string            `json:"lineStyle"`
		BorderColor string            `json:"borderColor"`
		FillColor   string            `json:"bgColor"`
		Shape       string            `json:"shape"`
		Width       float64           `json:"width"`
		Wrap        string            `json:"float"`
		Radius      float64           `json:"radius"`
		Rotation    float64           `json:"rotation"`
	}
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	b.Type = a.Type
	b.W, b.H, b.X, b.Y = a.W, a.H, a.X, a.Y
	b.BorderW, b.LineStyle = a.BorderW, a.LineStyle
	b.BorderColor, b.FillColor = a.BorderColor, a.FillColor
	b.Shape, b.Width, b.Wrap = a.Shape, a.Width, a.Wrap
	b.Radius, b.Rotation = a.Radius, a.Rotation
	b.Blocks = make([]Block, 0, len(a.Blocks))
	for _, raw := range a.Blocks {
		blk, err := unmarshalBlock(raw)
		if err != nil {
			continue // 容错跳过
		}
		b.Blocks = append(b.Blocks, blk)
	}
	return nil
}

type RawBlock struct {
	Kind string         `json:"kind"`
	Data map[string]any `json:"data"`
}

func (RawBlock) isBlock()        {}
func (RawBlock) BlockType() string { return "raw" }

// === 行内实现 ===

type Text struct {
	Content string `json:"content"`
	Bold    bool   `json:"bold,omitempty"`
	Italic  bool   `json:"italic,omitempty"`
	Under   bool   `json:"under,omitempty"`
	Strike  bool   `json:"strike,omitempty"`
	Style   string `json:"style,omitempty"`
	// 文档内联样式（由 docx 解析器填充，前端 ProseMirror fontFamily mark 消费）
	Font string `json:"font,omitempty"` // 字体名，如 "宋体"/"Calibri"
	// 电子表格单元格样式（由 xlsx 解析器填充，前端表格视图消费）
	Color      string  `json:"color,omitempty"`    // 字体颜色，#RRGGBB
	Align      string  `json:"align,omitempty"`    // left | center | right
	Bg         string  `json:"bg,omitempty"`       // 单元格填充色，#RRGGBB
	FontSize   float64 `json:"fontSize,omitempty"` // 字号（磅）
	FontFamily string  `json:"fontFamily,omitempty"` // 字体名（xlsx 单元格）
	Highlight  string  `json:"highlight,omitempty"` // 高亮色，#RRGGBB
}

func (Text) isInline()         {}
func (Text) InlineType() string { return "text" }

// Track 修订追踪行内：保存文档时保留 insert/delete 修订状态。
type Track struct {
	Track  string `json:"track"` // "insert" | "delete"
	Author string `json:"author,omitempty"`
	// 与 Text 相同的格式字段
	Content   string  `json:"content"`
	Bold      bool    `json:"bold,omitempty"`
	Italic    bool    `json:"italic,omitempty"`
	Under     bool    `json:"under,omitempty"`
	Strike    bool    `json:"strike,omitempty"`
	Style     string  `json:"style,omitempty"`
	Font      string  `json:"font,omitempty"`
	Color     string  `json:"color,omitempty"`
	Highlight string  `json:"highlight,omitempty"`
	FontSize  float64 `json:"fontSize,omitempty"`
	Superscript bool `json:"superscript,omitempty"`
	Subscript   bool `json:"subscript,omitempty"`
}

func (Track) isInline()         {}
func (Track) InlineType() string { return "track" }

type Hyperlink struct {
	URL  string   `json:"url"`
	Text []Inline `json:"text"`
}

func (Hyperlink) isInline()         {}
func (Hyperlink) InlineType() string { return "hyperlink" }

type InlineImage struct {
	Src    string  `json:"src"`
	Width  float64 `json:"width,omitempty"`
	Height float64 `json:"height,omitempty"`
}

func (InlineImage) isInline()         {}
func (InlineImage) InlineType() string { return "image" }

type RawInline struct {
	Kind string         `json:"kind"`
	Data map[string]any `json:"data"`
}

func (RawInline) isInline()         {}
func (RawInline) InlineType() string { return "raw" }
