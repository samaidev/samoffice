package docx

import (
        "strings"
        "testing"

        "github.com/zai/samoffice/internal/core"
)

// TestParseRunFont 验证 docx 解析时，run 的 <w:rFonts> 字体名（尤其是中文字体
// eastAsia）会被提取到 core.Text.Font，供前端 fontFamily mark 渲染（如宋体）。
func TestParseRunFont(t *testing.T) {
        xml := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:rPr><w:rFonts w:eastAsia="宋体" w:ascii="Calibri"/></w:rPr>
        <w:t>中文宋体</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>
        <w:t>English</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`

        blocks, warns, _, _ := parseDocumentXML(strings.NewReader(xml), map[string]string{})
        if len(blocks) != 2 {
                t.Fatalf("expected 2 blocks, got %d (warns=%v)", len(blocks), warns)
        }

        p0, ok := blocks[0].(*core.Paragraph)
        if !ok {
                t.Fatalf("block 0 expected *core.Paragraph, got %T", blocks[0])
        }
        gotFont := ""
        for _, inl := range p0.Inline {
                if txt, ok := inl.(core.Text); ok && txt.Content == "中文宋体" {
                        gotFont = txt.Font
                }
        }
        if gotFont != "宋体" {
                t.Fatalf("eastAsia font not extracted: got %q, want %q", gotFont, "宋体")
        }

        p1 := blocks[1].(*core.Paragraph)
        gotFont = ""
        for _, inl := range p1.Inline {
                if txt, ok := inl.(core.Text); ok && txt.Content == "English" {
                        gotFont = txt.Font
                }
        }
        if gotFont != "Arial" {
                t.Fatalf("ascii font not extracted: got %q, want %q", gotFont, "Arial")
        }
}

// TestParseRunVertAlignStrikeColorHighlight 验证 run 属性读入：
// vertAlign(superscript/subscript) / strike / color(auto 跳过、# 前缀归一) / highlight。
func TestParseRunVertAlignStrikeColorHighlight(t *testing.T) {
        xml := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:rPr><w:vertAlign w:val="superscript"/><w:strike/><w:color w:val="C00000"/><w:highlight w:val="yellow"/></w:rPr><w:t>x2</w:t></w:r>
      <w:r><w:rPr><w:vertAlign w:val="subscript"/><w:strike w:val="0"/><w:color w:val="auto"/></w:rPr><w:t>n1</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`

        blocks, warns, _, _ := parseDocumentXML(strings.NewReader(xml), map[string]string{})
        if len(blocks) != 1 {
                t.Fatalf("expected 1 block, got %d (warns=%v)", len(blocks), warns)
        }
        p, ok := blocks[0].(*core.Paragraph)
        if !ok {
                t.Fatalf("block 0 expected *core.Paragraph, got %T", blocks[0])
        }
        var t1, t2 *core.Text
        for _, inl := range p.Inline {
                if txt, ok := inl.(core.Text); ok {
                        switch txt.Content {
                        case "x2":
                                t1 = &txt
                        case "n1":
                                t2 = &txt
                        }
                }
        }
        if t1 == nil || t2 == nil {
                t.Fatalf("texts not parsed: %+v", p.Inline)
        }
        if !t1.Superscript || t1.Subscript {
                t.Errorf("run1 vertAlign superscript not parsed: %+v", *t1)
        }
        if !t1.Strike {
                t.Errorf("run1 strike not parsed")
        }
        if t1.Color != "#C00000" {
                t.Errorf("run1 color = %q, want #C00000", t1.Color)
        }
        if t1.Highlight != "#FFFF00" {
                t.Errorf("run1 highlight = %q, want #FFFF00", t1.Highlight)
        }
        if !t2.Subscript || t2.Superscript {
                t.Errorf("run2 vertAlign subscript not parsed: %+v", *t2)
        }
        if t2.Strike {
                t.Errorf("run2 strike w:val=0 should be off")
        }
        if t2.Color != "" {
                t.Errorf("run2 color auto should be skipped, got %q", t2.Color)
        }
}
