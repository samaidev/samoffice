package docgo

import (
	"os"
	"strings"
	"testing"
)

func TestCreateAndSave(t *testing.T) {
	doc := New()
	doc.SetTitle("测试文档")
	doc.SetAuthor("Tester")
	doc.AddHeading("标题", 1)
	doc.AddParagraph("正文内容")
	doc.AddList([]string{"项1", "项2"})
	doc.AddTable([][]string{{"A", "B"}, {"1", "2"}})
	doc.AddCodeBlock("go", `fmt.Println("hi")`)

	tmpFile := "/tmp/docgo-test.docx"
	if err := doc.Save(tmpFile); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(tmpFile)

	if _, err := os.Stat(tmpFile); err != nil {
		t.Fatal("file not created")
	}
}

func TestOpenAndRead(t *testing.T) {
	doc := New()
	doc.SetTitle("读取测试")
	doc.SetAuthor("Reader")
	doc.AddParagraph("段落一")
	doc.AddParagraph("段落二")

	tmpFile := "/tmp/docgo-read-test.docx"
	doc.Save(tmpFile)
	defer os.Remove(tmpFile)

	doc2, err := Open(tmpFile)
	if err != nil {
		t.Fatal(err)
	}
	if doc2.Title() != "读取测试" {
		t.Errorf("title = %q, want '读取测试'", doc2.Title())
	}
	if doc2.Author() != "Reader" {
		t.Errorf("author = %q, want 'Reader'", doc2.Author())
	}
	if len(doc2.Paragraphs()) < 2 {
		t.Errorf("paragraphs = %d, want >= 2", len(doc2.Paragraphs()))
	}
}

func TestRunStyling(t *testing.T) {
	doc := New()
	p := doc.AddParagraph("")
	r := p.AddRun("styled")
	r.Bold(true).Italic(true).Color("FF0000").Size(14)

	if !r.bold { t.Error("bold not set") }
	if !r.italic { t.Error("italic not set") }
	if r.color != "FF0000" { t.Error("color not set") }
	if r.size != 14 { t.Error("size not set") }
}

func TestBytes(t *testing.T) {
	doc := New()
	doc.AddHeading("H1", 1)
	doc.AddParagraph("P1")
	data, err := doc.Bytes()
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 500 {
		t.Errorf("bytes too small: %d", len(data))
	}
	if !strings.HasPrefix(string(data), "PK") {
		t.Error("not ZIP format")
	}
}
