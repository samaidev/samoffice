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
