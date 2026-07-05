package main

import (
	"archive/zip"
	"bytes"
	"fmt"
	"os"
)

func main() {
	buf := &bytes.Buffer{}
	w := zip.NewWriter(buf)

	addFile(w, "[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`)

	addFile(w, "_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="r2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`)

	addFile(w, "docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Test Document</dc:title>
  <dc:creator>GoOffice Tester</dc:creator>
  <dc:language>en-US</dc:language>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-07-05T00:00:00Z</dcterms:created>
</cp:coreProperties>`)

	addFile(w, "word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>
      <w:r><w:t>Hello GoOffice</w:t></w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:b/><w:i/></w:rPr>
        <w:t>This is bold and italic text</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r><w:t>Normal paragraph with </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>
      <w:r><w:t> and </w:t></w:r>
      <w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>
      <w:r><w:t> words.</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>This is a misspellled worrd for spell check.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`)

	w.Close()

	out := "/tmp/test.docx"
	if err := os.WriteFile(out, buf.Bytes(), 0644); err != nil {
		fmt.Println("ERR:", err)
		os.Exit(1)
	}
	fmt.Printf("Generated %s (%d bytes)\n", out, buf.Len())
}

func addFile(w *zip.Writer, name, content string) {
	f, _ := w.Create(name)
	f.Write([]byte(content))
}
