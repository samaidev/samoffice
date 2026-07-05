package core

import (
        "encoding/json"
)

// 自定义 JSON 序列化/反序列化
// Block 和 Inline 是接口类型，encoding/json 默认无法处理
// 通过 discriminator 字段实现多态反序列化

// === Block 反序列化 ===

// Paragraph 自定义反序列化：处理 Inline 接口字段
func (b *Paragraph) UnmarshalJSON(data []byte) error {
        type alias struct {
                Inline []json.RawMessage `json:"inline"`
                Style  string            `json:"style,omitempty"`
                Align  string            `json:"align,omitempty"`
                Props  map[string]any    `json:"props,omitempty"`
        }
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        b.Style = a.Style
        b.Align = a.Align
        b.Props = a.Props
        b.Inline = make([]Inline, 0, len(a.Inline))
        for _, raw := range a.Inline {
                in, err := unmarshalInline(raw)
                if err != nil {
                        continue // 容错跳过
                }
                b.Inline = append(b.Inline, in)
        }
        return nil
}

// Heading 自定义反序列化：处理 Inline 接口字段
func (b *Heading) UnmarshalJSON(data []byte) error {
        type alias struct {
                Level  int               `json:"level"`
                Inline []json.RawMessage `json:"inline"`
                Style  string            `json:"style,omitempty"`
        }
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        b.Level = a.Level
        b.Style = a.Style
        b.Inline = make([]Inline, 0, len(a.Inline))
        for _, raw := range a.Inline {
                in, err := unmarshalInline(raw)
                if err != nil {
                        continue
                }
                b.Inline = append(b.Inline, in)
        }
        return nil
}

// BulletList 自定义反序列化：Items 是 [][]Block，Block 是接口
func (b *BulletList) UnmarshalJSON(data []byte) error {
        type alias struct {
                Items   []json.RawMessage `json:"items"`
                Ordered bool              `json:"ordered"`
        }
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        b.Ordered = a.Ordered
        b.Items = make([][]Block, 0, len(a.Items))
        for _, raw := range a.Items {
                var blocks []Block
                // items 是 Block[][]，每个元素是 Block[]
                var blockRaws []json.RawMessage
                if err := json.Unmarshal(raw, &blockRaws); err != nil {
                        // 可能是单个 Block
                        blk, err := unmarshalBlock(raw)
                        if err == nil {
                                blocks = []Block{blk}
                        }
                        continue
                }
                for _, br := range blockRaws {
                        blk, err := unmarshalBlock(br)
                        if err != nil {
                                continue
                        }
                        blocks = append(blocks, blk)
                }
                b.Items = append(b.Items, blocks)
        }
        return nil
}

func (b *Table) UnmarshalJSON(data []byte) error {
        type alias struct {
                Rows  []json.RawMessage `json:"rows"`
                Width []float64         `json:"width,omitempty"`
                Style string            `json:"style,omitempty"`
        }
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        b.Width = a.Width
        b.Style = a.Style
        b.Rows = make([][]TableCell, 0, len(a.Rows))
        for _, rowRaw := range a.Rows {
                var cells []json.RawMessage
                if err := json.Unmarshal(rowRaw, &cells); err != nil {
                        continue
                }
                row := make([]TableCell, 0, len(cells))
                for _, cellRaw := range cells {
                        cell, err := unmarshalCell(cellRaw)
                        if err != nil {
                                continue
                        }
                        row = append(row, cell)
                }
                b.Rows = append(b.Rows, row)
        }
        return nil
}

// unmarshalCell 反序列化 TableCell，处理 Inline 接口字段
func unmarshalCell(data []byte) (TableCell, error) {
        var probe struct {
                Inline   []json.RawMessage `json:"inline"`
                Blocks   []json.RawMessage `json:"blocks"`
                RowSpan  int               `json:"rowSpan"`
                ColSpan  int               `json:"colSpan"`
                IsHeader bool              `json:"isHeader"`
        }
        if err := json.Unmarshal(data, &probe); err != nil {
                return TableCell{}, err
        }
        c := TableCell{
                RowSpan:  probe.RowSpan,
                ColSpan:  probe.ColSpan,
                IsHeader: probe.IsHeader,
        }
        c.Inline = make([]Inline, 0, len(probe.Inline))
        for _, raw := range probe.Inline {
                in, err := unmarshalInline(raw)
                if err != nil {
                        continue
                }
                c.Inline = append(c.Inline, in)
        }
        c.Blocks = make([]Block, 0, len(probe.Blocks))
        for _, raw := range probe.Blocks {
                b, err := unmarshalBlock(raw)
                if err != nil {
                        continue
                }
                c.Blocks = append(c.Blocks, b)
        }
        return c, nil
}

func (b *Image) UnmarshalJSON(data []byte) error {
        type alias struct {
                Src     string          `json:"src"`
                Width   float64         `json:"width,omitempty"`
                Height  float64         `json:"height,omitempty"`
                Alt     string          `json:"alt,omitempty"`
                Caption []json.RawMessage `json:"caption,omitempty"`
        }
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        b.Src = a.Src
        b.Width = a.Width
        b.Height = a.Height
        b.Alt = a.Alt
        if len(a.Caption) > 0 {
                b.Caption = make([]Inline, 0, len(a.Caption))
                for _, raw := range a.Caption {
                        in, err := unmarshalInline(raw)
                        if err != nil {
                                continue
                        }
                        b.Caption = append(b.Caption, in)
                }
        }
        return nil
}

func (b *CodeBlock) UnmarshalJSON(data []byte) error {
        type alias CodeBlock
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        *b = CodeBlock(a)
        return nil
}

func (b *RawBlock) UnmarshalJSON(data []byte) error {
        type alias RawBlock
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        *b = RawBlock(a)
        return nil
}

// Document 的 UnmarshalJSON：通过结构特征路由到正确的 Block 类型
func (d *Document) UnmarshalJSON(data []byte) error {
        type alias struct {
                Meta     Meta            `json:"meta"`
                Blocks   []json.RawMessage `json:"blocks"`
                Comments []Comment       `json:"comments,omitempty"`
                Styles   []StyleDef      `json:"styles,omitempty"`
                Warnings []Warning       `json:"warnings,omitempty"`
                Raw      map[string]any  `json:"raw,omitempty"`
        }
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        d.Meta = a.Meta
        d.Comments = a.Comments
        d.Styles = a.Styles
        d.Warnings = a.Warnings
        d.Raw = a.Raw

        d.Blocks = make([]Block, 0, len(a.Blocks))
        for _, raw := range a.Blocks {
                b, err := unmarshalBlock(raw)
                if err != nil {
                        // 容错：解析失败的 block 跳过
                        continue
                }
                d.Blocks = append(d.Blocks, b)
        }
        return nil
}

// unmarshalBlock 根据 JSON 结构特征判断 Block 类型
func unmarshalBlock(data []byte) (Block, error) {
        var probe struct {
                Level  *int            `json:"level"`   // Heading
                Items  json.RawMessage `json:"items"`   // BulletList
                Rows   json.RawMessage `json:"rows"`    // Table
                Code   string          `json:"code"`    // CodeBlock
                Src    string          `json:"src"`     // Image
                Kind   string          `json:"kind"`    // RawBlock
                Inline json.RawMessage `json:"inline"`  // Paragraph
        }
        if err := json.Unmarshal(data, &probe); err != nil {
                return nil, err
        }

        switch {
        case probe.Level != nil:
                var h Heading
                err := json.Unmarshal(data, &h)
                return &h, err
        case len(probe.Items) > 0 && string(probe.Items) != "null":
                var l BulletList
                err := json.Unmarshal(data, &l)
                return &l, err
        case len(probe.Rows) > 0 && string(probe.Rows) != "null":
                var t Table
                err := json.Unmarshal(data, &t)
                return &t, err
        case probe.Code != "":
                var c CodeBlock
                err := json.Unmarshal(data, &c)
                return &c, err
        case probe.Src != "" && probe.Kind == "":
                var im Image
                err := json.Unmarshal(data, &im)
                return &im, err
        case probe.Kind != "":
                var r RawBlock
                err := json.Unmarshal(data, &r)
                return &r, err
        case len(probe.Inline) > 0:
                var p Paragraph
                err := json.Unmarshal(data, &p)
                return &p, err
        default:
                // 兜底：作为空段落
                return &Paragraph{}, nil
        }
}

// === Inline 反序列化 ===

// Hyperlink 自定义反序列化：Text 字段是 []Inline
func (i *Hyperlink) UnmarshalJSON(data []byte) error {
        type alias struct {
                URL  string            `json:"url"`
                Text []json.RawMessage `json:"text"`
        }
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        i.URL = a.URL
        i.Text = make([]Inline, 0, len(a.Text))
        for _, raw := range a.Text {
                in, err := unmarshalInline(raw)
                if err != nil {
                        continue
                }
                i.Text = append(i.Text, in)
        }
        return nil
}

func (i *Text) UnmarshalJSON(data []byte) error {
        type alias Text
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        *i = Text(a)
        return nil
}

func (i *InlineImage) UnmarshalJSON(data []byte) error {
        type alias InlineImage
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        *i = InlineImage(a)
        return nil
}

func (i *RawInline) UnmarshalJSON(data []byte) error {
        type alias RawInline
        var a alias
        if err := json.Unmarshal(data, &a); err != nil {
                return err
        }
        *i = RawInline(a)
        return nil
}

// unmarshalInline 根据 JSON 结构特征判断 Inline 类型
func unmarshalInline(data []byte) (Inline, error) {
        var probe struct {
                URL     string `json:"url"`     // Hyperlink
                Content string `json:"content"` // Text
                Src     string `json:"src"`     // InlineImage
                Kind    string `json:"kind"`    // RawInline
        }
        if err := json.Unmarshal(data, &probe); err != nil {
                return nil, err
        }

        switch {
        case probe.URL != "":
                var h Hyperlink
                err := json.Unmarshal(data, &h)
                return &h, err
        case probe.Src != "":
                var im InlineImage
                err := json.Unmarshal(data, &im)
                return &im, err
        case probe.Kind != "":
                var r RawInline
                err := json.Unmarshal(data, &r)
                return &r, err
        default:
                // 默认作为 Text
                var t Text
                err := json.Unmarshal(data, &t)
                return &t, err
        }
}
