package docx

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

// 构造一个最小 docx（zip）字节流，含 document.xml 与 footer1.xml
func buildDocxZip(t *testing.T, documentXML, footerXML string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	write := func(name, content string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	write("word/document.xml", documentXML)
	if footerXML != "" {
		write("word/footer1.xml", footerXML)
	}
	write("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`)
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

// TestParsePageBreaks 验证：
//  1. <w:br w:type="page"/> 解析为段后的 pageBreak 块
//  2. <w:pageBreakBefore/> 解析为段前的 pageBreak 块
func TestParsePageBreaks(t *testing.T) {
	docXML := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>第一页内容</w:t></w:r></w:p>
    <w:p>
      <w:r><w:br w:type="page"/></w:r>
      <w:r><w:t>第二页开头</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pageBreakBefore/></w:pPr>
      <w:r><w:t>第三页（段前分页）</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`

	blocks, warns, _, _ := parseDocumentXML(strings.NewReader(docXML), map[string]string{})
	if len(blocks) != 5 {
		t.Fatalf("expected 5 blocks (p, p, pageBreak, pageBreak, p), got %d (warns=%v)", len(blocks), warns)
	}
	// w:br w:type="page" 作为段末分页（trailing），插入在该段之后
	if _, ok := blocks[2].(*core.PageBreak); !ok {
		t.Fatalf("block 2 expected *core.PageBreak (after w:br page), got %T", blocks[2])
	}
	// pageBreakBefore 作为段前分页（leading），插入在该段之前
	if _, ok := blocks[3].(*core.PageBreak); !ok {
		t.Fatalf("block 3 expected *core.PageBreak (pageBreakBefore), got %T", blocks[3])
	}
}

// TestParseFooterPageNumber 验证页脚 PAGE/NUMPAGES 域解析为页码配置
func TestParseFooterPageNumber(t *testing.T) {
	docXML := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body>
</w:document>`

	footerXML := `<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:t>第 </w:t></w:r>
    <w:r><w:fldSimple w:instr=" PAGE "><w:t>1</w:t></w:fldSimple></w:r>
    <w:r><w:t> 页 / 共 </w:t></w:r>
    <w:r><w:fldSimple w:instr=" NUMPAGES "><w:t>3</w:t></w:fldSimple></w:r>
    <w:r><w:t> 页</w:t></w:r>
  </w:p>
</w:ftr>`

	data := buildDocxZip(t, docXML, footerXML)
	p := New()
	doc, warns, err := p.Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("Parse error: %v (warns=%v)", err, warns)
	}
	if doc.PageNumber == nil {
		t.Fatalf("expected PageNumber config, got nil")
	}
	if !doc.PageNumber.Enabled {
		t.Fatalf("PageNumber.Enabled expected true")
	}
	if doc.PageNumber.Format != "第 {n} 页 / 共 {total} 页" {
		t.Fatalf("PageNumber.Format got %q, want %q", doc.PageNumber.Format, "第 {n} 页 / 共 {total} 页")
	}
	if doc.PageNumber.Align != "center" {
		t.Fatalf("PageNumber.Align got %q, want center", doc.PageNumber.Align)
	}
}

// TestParseFooterPageNumberNone 验证无页码域时 pageNumber 为 nil
func TestParseFooterPageNumberNone(t *testing.T) {
	docXML := `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>正文</w:t></w:r></w:p></w:body>
</w:document>`
	data := buildDocxZip(t, docXML, "")
	p := New()
	doc, _, err := p.Parse(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}
	if doc.PageNumber != nil {
		t.Fatalf("expected nil PageNumber, got %+v", doc.PageNumber)
	}
}
