package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/renderer/docx"
	"github.com/zai/samoffice/internal/renderer/pdf"
)

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func main() {
	src := []byte(`{"meta":{"title":"t"},"blocks":[{"type":"heading","level":1,"inline":[{"type":"text","text":"标题"}]},{"type":"textbox","inline":[{"type":"paragraph","inline":[{"type":"text","text":"文本框内容","font":"SimSun"}]}],"bgColor":"#fef3c7","borderColor":"#f59e0b","borderW":2,"lineStyle":"dash","shape":"roundRect","width":300}]}`)
	var doc core.Document
	if err := json.Unmarshal(src, &doc); err != nil {
		fmt.Println("UNMARSHAL:", err)
		os.Exit(1)
	}
	// docx
	docxData, err := docx.New().Render(&doc)
	if err != nil {
		fmt.Println("DOCX RENDER ERR:", err)
		os.Exit(1)
	}
	fmt.Printf("=== DOCX OK (bytes=%d) ===\n", len(docxData))
	// 解压 docx 并检查 document.xml 样式字段
	if err := os.WriteFile("test_tbox.docx", docxData, 0644); err == nil {
		f, zerr := zip.OpenReader("test_tbox.docx")
		if zerr == nil {
			for _, f2 := range f.File {
				if f2.Name == "word/document.xml" {
					rc, _ := f2.Open()
					data, _ := io.ReadAll(rc)
					rc.Close()
					ds := string(data)
					for _, kw := range []string{"wps:txbx", "roundRect", "prstDash", "srgbClr", "a:ln", "fef3c7", "f59e0b", "dash"} {
						fmt.Printf("  contains %q: %v\n", kw, contains(ds, kw))
					}
				}
			}
			f.Close()
		} else {
			fmt.Println("ZIP OPEN ERR:", zerr)
		}
	}
	// pdf
	pdfData, err := pdf.New().Render(&doc)
	if err != nil {
		fmt.Println("PDF RENDER ERR:", err)
		os.Exit(1)
	}
	fmt.Printf("=== PDF OK (bytes=%d) ===\n", len(pdfData))
}
