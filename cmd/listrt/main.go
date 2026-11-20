package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
	"strings"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/parser"
	docxrenderer "github.com/zai/samoffice/internal/renderer/docx"
)

// listrt round47 验证：构造含 [n]/(n)/n)/n-/circle-num/circle-alpha/cjk 列表的
// docx（手写 numbering.xml），解析后断言 BulletList.Style，再导出检查 numbering.xml。
func main() {
	docxBytes := buildTestDocx()
	os.WriteFile("/tmp/listrt.docx", docxBytes, 0o644)

	reg := parser.NewRegistry()
	doc, _, err := reg.ParseBytes("test.docx", docxBytes)
	if err != nil {
		fmt.Println("PARSE FAIL:", err)
		os.Exit(1)
	}
	pass, fail := 0, 0
	got := map[string]bool{}
	for _, b := range doc.Blocks {
		if l, ok := b.(*core.BulletList); ok && l.Ordered {
			fmt.Printf("parse: ordered style=%q items=%d\n", l.Style, len(l.Items))
			got[l.Style] = true
		}
	}
	for _, want := range []string{"[n]", "(n)", "n)", "circle-num", ""} {
		if got[want] {
			pass++
		} else {
			fail++
			fmt.Printf("MISSING style %q\n", want)
		}
	}

	out, err := docxrenderer.New().Render(doc)
	if err != nil {
		fmt.Println("RENDER FAIL:", err)
		os.Exit(1)
	}
	os.WriteFile("/tmp/listrt_out.docx", out, 0o644)

	// 检查导出的 numbering.xml
	zr, err := zip.NewReader(strings.NewReader(string(out)), int64(len(out)))
	if err != nil {
		fmt.Println("ZIP FAIL:", err)
		os.Exit(1)
	}
	for _, f := range zr.File {
		if f.Name != "word/numbering.xml" {
			continue
		}
		rc, _ := f.Open()
		buf := make([]byte, 65536)
		n, _ := rc.Read(buf)
		xml := string(buf[:n])
		fmt.Println("--- numbering.xml check ---")
		for _, probe := range []struct{ name, want string }{
			{"[1] bracket", `<w:lvlText w:val="[%1]"/>`},
			{"(1) paren fmt", `w:val="decimalEnclosedParen"`},
			{"circle num", `w:val="decimalEnclosedCircle"`},
			{"1) style", `<w:lvlText w:val="%1)"/>`},
			{"MS Gothic for circle", `MS Gothic`},
		} {
			if strings.Contains(xml, probe.want) {
				pass++
				fmt.Printf("PASS  %s\n", probe.name)
			} else {
				fail++
				fmt.Printf("FAIL  %s (want %s)\n", probe.name, probe.want)
			}
		}
	}
	// 二次解析：导出的 docx 再走一遍解析，验证样式闭环（save→reopen 不丢）
	doc2, _, err := reg.ParseBytes("out.docx", out)
	if err != nil {
		fmt.Println("RE-PARSE FAIL:", err)
		os.Exit(1)
	}
	style2 := map[string]int{}
	for _, b := range doc2.Blocks {
		if l, ok := b.(*core.BulletList); ok && l.Ordered {
			style2[l.Style]++
		}
	}
	for _, want := range []string{"[n]", "(n)", "n)", "circle-num"} {
		if style2[want] > 0 {
			pass++
			fmt.Printf("PASS  reopen style %q\n", want)
		} else {
			fail++
			fmt.Printf("FAIL  reopen style %q (got %v)\n", want, style2)
		}
	}
	fmt.Printf("=== pass=%d fail=%d ===\n", pass, fail)
	if fail > 0 {
		os.Exit(1)
	}
}

func buildTestDocx() []byte {
	// numbering.xml: numId 10=[%1] numId 11=(%1) numId 12=%1) numId 13=circle numId 14=decimal default
	numbering := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="[%1]"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="11"><w:lvl w:ilvl="0"><w:numFmt w:val="decimalEnclosedParen"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="12"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="13"><w:lvl w:ilvl="0"><w:numFmt w:val="decimalEnclosedCircle"/><w:lvlText w:val="%1"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="14"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
  <w:num w:numId="10"><w:abstractNumId w:val="10"/></w:num>
  <w:num w:numId="11"><w:abstractNumId w:val="11"/></w:num>
  <w:num w:numId="12"><w:abstractNumId w:val="12"/></w:num>
  <w:num w:numId="13"><w:abstractNumId w:val="13"/></w:num>
  <w:num w:numId="14"><w:abstractNumId w:val="14"/></w:num>
</w:numbering>`

	li := func(numID int, text string) string {
		return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="` + fmt.Sprint(numID) + `"/></w:numPr></w:pPr><w:r><w:t>` + text + `</w:t></w:r></w:p>`
	}
	document := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
		li(10, "bracket one") + li(10, "bracket two") +
		`<w:p><w:r><w:t>separator</w:t></w:r></w:p>` +
		li(11, "paren one") + li(11, "paren two") +
		`<w:p><w:r><w:t>separator2</w:t></w:r></w:p>` +
		li(12, "paren-suffix one") +
		`<w:p><w:r><w:t>separator3</w:t></w:r></w:p>` +
		li(13, "circle one") + li(13, "circle two") +
		`<w:p><w:r><w:t>separator4</w:t></w:r></w:p>` +
		li(14, "plain decimal") +
		`<w:sectPr/></w:body></w:document>`

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	type zf struct{ name, body string }
	for _, e := range []zf{
		{"[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`},
		{"_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`},
		{"word/document.xml", document},
		{"word/numbering.xml", numbering},
	} {
		w, _ := zw.Create(e.name)
		w.Write([]byte(e.body))
	}
	zw.Close()
	return buf.Bytes()
}



