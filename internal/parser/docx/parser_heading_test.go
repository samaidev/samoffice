package docx

import (
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

// TestParseHeadingStyle 验证 docx 解析时，HeadingN 样式段落会被识别为
// core.Heading 块（标题层级还原），而非普通段落。
func TestParseHeadingStyle(t *testing.T) {
	xml := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>标题一</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading3"/></w:pPr>
      <w:r><w:t>三级标题</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>正文</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`

	blocks, warns := parseDocumentXML(strings.NewReader(xml))
	if len(blocks) != 3 {
		t.Fatalf("expected 3 blocks, got %d (warns=%v)", len(blocks), warns)
	}

	h1, ok := blocks[0].(*core.Heading)
	if !ok {
		t.Fatalf("block 0 expected *core.Heading, got %T", blocks[0])
	}
	if h1.Level != 1 || h1.Style != "Heading1" {
		t.Fatalf("heading1 level/style wrong: level=%d style=%q", h1.Level, h1.Style)
	}

	h3, ok := blocks[1].(*core.Heading)
	if !ok {
		t.Fatalf("block 1 expected *core.Heading, got %T", blocks[1])
	}
	if h3.Level != 3 {
		t.Fatalf("heading3 level wrong: %d", h3.Level)
	}

	if _, ok := blocks[2].(*core.Paragraph); !ok {
		t.Fatalf("block 2 expected *core.Paragraph, got %T", blocks[2])
	}
}
