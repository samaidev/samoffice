package core

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
	Warnings   []Warning        `json:"warnings,omitempty"`
	Raw        map[string]any   `json:"raw,omitempty"`
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
	Props  map[string]any  `json:"props,omitempty"`
}

func (Heading) isBlock()        {}
func (Heading) BlockType() string { return "heading" }

type BulletList struct {
	Items  [][]Block `json:"items"`
	Ordered bool     `json:"ordered"`
}

func (BulletList) isBlock()        {}
func (BulletList) BlockType() string { return "bulletList" }

type Table struct {
	Rows  [][]TableCell `json:"rows"`
	Width []float64     `json:"width,omitempty"`
	Style string        `json:"style,omitempty"`
}

func (Table) isBlock()        {}
func (Table) BlockType() string { return "table" }

type TableCell struct {
	Inline   []Inline `json:"inline,omitempty"`
	Blocks   []Block  `json:"blocks,omitempty"`
	RowSpan  int      `json:"rowSpan,omitempty"`
	ColSpan  int      `json:"colSpan,omitempty"`
	IsHeader bool     `json:"isHeader,omitempty"`
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
}

func (Text) isInline()         {}
func (Text) InlineType() string { return "text" }

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
