package main

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
)

// dumpDocumentXML 解压 docx 并打印 word/document.xml 前部，用于排查 rFonts 结构
func dumpDocumentXML(path string) {
	r, err := zip.OpenReader(path)
	if err != nil {
		fmt.Println("ZIP ERROR:", err)
		return
	}
	defer r.Close()
	for _, f := range r.File {
		if f.Name == "word/document.xml" {
			rc, _ := f.Open()
			data, _ := io.ReadAll(rc)
			rc.Close()
			s := string(data)
			if len(s) > 4000 {
				s = s[:4000]
			}
			fmt.Println(s)
			return
		}
	}
	fmt.Println("document.xml NOT FOUND")
	_ = os.Stdout
}
