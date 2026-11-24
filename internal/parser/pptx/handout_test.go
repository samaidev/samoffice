package pptx

import (
	"os"
	"strings"
	"testing"
)

// round66：讲义母版读侧单测 —— 真实写出样例（探针产物）验证四要素恢复。
func TestParseHandoutMaster(t *testing.T) {
	xml := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:handoutMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Date Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="dt"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1200"><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></a:rPr><a:t>2026-11-24</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Header Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="hdr"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1200"><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></a:rPr><a:t>SamOffice 产品发布</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Footer Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ftr"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1200"><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill></a:rPr><a:t>机密文件</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="5" name="Slide Number Placeholder 4"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{28B5D1D5-31BE-4CE5-BFBB-D6AC9A1AF02B}" type="slidenum"><a:rPr lang="zh-CN" sz="1200"/><a:t>1</a:t></a:fld></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:handoutMaster>`
	out := parseHandoutMaster(strings.NewReader(xml))
	if out == nil {
		t.Fatalf("parseHandoutMaster 返回 nil")
	}
	if out["header"] != "SamOffice 产品发布" {
		t.Errorf("header = %v, want SamOffice 产品发布", out["header"])
	}
	if out["footer"] != "机密文件" {
		t.Errorf("footer = %v", out["footer"])
	}
	if out["date"] != "2026-11-24" {
		t.Errorf("date = %v", out["date"])
	}
	if out["pageOn"] != true {
		t.Errorf("pageOn = %v, want true", out["pageOn"])
	}
	if out["fontSize"] != 12 {
		t.Errorf("fontSize = %v, want 12", out["fontSize"])
	}
	if out["color"] != "#4472C4" {
		t.Errorf("color = %v, want #4472C4", out["color"])
	}
	_ = os.Stdout
}
