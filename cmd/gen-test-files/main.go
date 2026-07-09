package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"

	"github.com/xuri/excelize/v2"
)

func main() {
	genXLSX()
	genPPTX()
	fmt.Println("\nTest files generated:")
	fmt.Println("  /tmp/test.xlsx")
	fmt.Println("  /tmp/test.pptx")
}

func genXLSX() {
	f := excelize.NewFile()
	sheet := "Sheet1"
	f.SetCellValue(sheet, "A1", "姓名")
	f.SetCellValue(sheet, "B1", "年龄")
	f.SetCellValue(sheet, "C1", "城市")
	f.SetCellValue(sheet, "A2", "张三")
	f.SetCellValue(sheet, "B2", 25)
	f.SetCellValue(sheet, "C2", "北京")
	f.SetCellValue(sheet, "A3", "李四")
	f.SetCellValue(sheet, "B3", 30)
	f.SetCellValue(sheet, "C3", "上海")
	f.SetCellValue(sheet, "A4", "王五")
	f.SetCellValue(sheet, "B4", 28)
	f.SetCellValue(sheet, "C4", "广州")

	if err := f.SaveAs("/tmp/test.xlsx"); err != nil {
		fmt.Println("xlsx error:", err)
		return
	}
	fmt.Println("Generated /tmp/test.xlsx")
}

func genPPTX() {
	buf := &bytes.Buffer{}
	w := zip.NewWriter(buf)

	addFile(w, "[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`)

	addFile(w, "_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`)

	addFile(w, "docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Test Presentation</dc:title>
  <dc:creator>SamOffice Tester</dc:creator>
</cp:coreProperties>`)

	addFile(w, "ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
  </p:sldIdLst>
</p:presentation>`)

	addFile(w, "ppt/slides/slide1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:t>第一张幻灯片标题</a:t></a:p>
          <a:p><a:t>这是第一个要点</a:t></a:p>
          <a:p><a:t>这是第二个要点</a:t></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`)

	addFile(w, "ppt/slides/slide2.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          <a:p><a:t>第二张幻灯片标题</a:t></a:p>
          <a:p><a:t>更多内容</a:t></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`)

	w.Close()
	os.WriteFile("/tmp/test.pptx", buf.Bytes(), 0644)
	fmt.Println("Generated /tmp/test.pptx")
}

func addFile(w *zip.Writer, name, content string) {
	f, _ := w.Create(name)
	f.Write([]byte(content))
}
