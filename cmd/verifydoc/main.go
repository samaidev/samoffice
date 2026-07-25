// 验证 docx 分页符与页码解析：构造一个最小 docx（含 w:br type=page、pageBreakBefore、页脚 PAGE 域），
// 经 parser.Parse 解析后输出 UDM JSON，供前端端到端验证分页/页码渲染。
package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/zai/samoffice/internal/parser/docx"
)

func main() {
	documentXML := `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>第一页：封面与摘要内容</w:t></w:r></w:p>
    <w:p><w:r><w:t>这一段也在第一页。</w:t></w:r></w:p>
    <w:p>
      <w:r><w:br w:type="page"/></w:r>
    </w:p>
    <w:p><w:r><w:t>第二页：正文开始。</w:t></w:r></w:p>
    <w:p>
      <w:pPr><w:pageBreakBefore/></w:pPr>
      <w:r><w:t>第三页：按段前分页强制开启。</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`

	footerXML := `<?xml version="1.0"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:t>第 </w:t></w:r>
    <w:r><w:fldSimple w:instr=" PAGE "><w:t>1</w:t></w:fldSimple></w:r>
    <w:r><w:t>页 / 共 </w:t></w:r>
    <w:r><w:fldSimple w:instr=" NUMPAGES "><w:t>3</w:t></w:fldSimple></w:r>
    <w:r><w:t> 页</w:t></w:r>
  </w:p>
</w:ftr>`

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	write := func(name, content string) {
		w, err := zw.Create(name)
		if err != nil {
			log.Fatal(err)
		}
		w.Write([]byte(content))
	}
	write("word/document.xml", documentXML)
	write("word/footer1.xml", footerXML)
	write("[Content_Types].xml", `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`)
	zw.Close()

	p := docx.New()
	doc, warns, err := p.Parse(bytes.NewReader(buf.Bytes()))
	if err != nil {
		log.Fatalf("parse: %v", err)
	}
	if len(warns) > 0 {
		fmt.Fprintln(os.Stderr, "warns:", warns)
	}

	out, _ := json.MarshalIndent(doc, "", "  ")
	os.WriteFile("scripts/paged_doc.udm.json", out, 0644)
	fmt.Println(string(out))
}
