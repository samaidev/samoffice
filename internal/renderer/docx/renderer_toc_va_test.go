package docx

import (
        "archive/zip"
        "bytes"
        "io"
        "strings"
        "testing"

        "github.com/zai/samoffice/internal/core"
)

// 验证 TOC Entry 段落导出为带右对齐点线制表位的段落，\t 转为 <w:tab/>
func TestRenderParagraphTOCTabLeader(t *testing.T) {
        p := &core.Paragraph{
                Style: "TOC Entry",
                Inline: []core.Inline{
                        &core.Text{Content: "1 第一章 概述\t1", Bold: false},
                },
        }
        r := New()
        data, err := r.Render(&core.Document{
                Blocks: []core.Block{p},
        })
        if err != nil {
                t.Fatalf("render failed: %v", err)
        }
        xml := extractDocumentXML(t, data)
        if !strings.Contains(xml, `w:leader="dot"`) {
                t.Errorf("missing dot leader tab stop; xml=%s", xml)
        }
        if !strings.Contains(xml, `<w:tab/>`) {
                t.Errorf("missing <w:tab/> run; xml=%s", xml)
        }
        if !strings.Contains(xml, `w:val="right"`) {
                t.Errorf("missing right-aligned tab; xml=%s", xml)
        }
}

// 验证表格单元格 vAlign 导出为 w:vAlign
func TestRenderTableCellVAlign(t *testing.T) {
        cell := &core.TableCell{
                Blocks: []core.Block{
                        &core.Paragraph{Inline: []core.Inline{&core.Text{Content: "居中内容"}}},
                },
                VAlign: "middle",
        }
        tbl := &core.Table{
                Rows: [][]core.TableCell{{*cell, {}}},
        }
        r := New()
        data, err := r.Render(&core.Document{Blocks: []core.Block{tbl}})
        if err != nil {
                t.Fatalf("render failed: %v", err)
        }
        xml := extractDocumentXML(t, data)
        if !strings.Contains(xml, `<w:vAlign w:val="center"/>`) {
                t.Errorf("missing cell vAlign; xml=%s", xml)
        }
}

func extractDocumentXML(t *testing.T, data []byte) string {
        t.Helper()
        zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
        if err != nil {
                t.Fatalf("zip open: %v", err)
        }
        for _, f := range zr.File {
                if f.Name == "word/document.xml" {
                        rc, _ := f.Open()
                        defer rc.Close()
                        b, _ := io.ReadAll(rc)
                        return string(b)
                }
        }
        return ""
}
