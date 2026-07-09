package core

// Document 是 SamOffice 的统一文档模型 (UDM)。
// 所有格式 (docx/xlsx/pptx/md) 先解析为 UDM，再渲染或导出。
//
// 设计原则：
//  1. 容错：未知元素存入 Raw，不丢失数据
//  2. 双向：UDM 可序列化为 JSON，前后端共用
//  3. 可扩展：Block/Inline 用 interface，新增类型不破坏旧代码
type Document struct {
	Meta     Meta           `json:"meta"`
	Blocks   []Block        `json:"blocks"`
	Comments []Comment      `json:"comments,omitempty"`
	Styles   []StyleDef     `json:"styles,omitempty"`
	Warnings []Warning      `json:"warnings,omitempty"`
	Raw      map[string]any `json:"raw,omitempty"`
}

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
	Level  int      `json:"level"`
	Inline []Inline `json:"inline"`
	Style  string   `json:"style,omitempty"`
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
}

func (Image) isBlock()        {}
func (Image) BlockType() string { return "image" }

type CodeBlock struct {
	Language string `json:"language,omitempty"`
	Code     string `json:"code"`
}

func (CodeBlock) isBlock()        {}
func (CodeBlock) BlockType() string { return "codeBlock" }

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
