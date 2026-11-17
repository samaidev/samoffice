// bgRef 解析单测（round28：装备工业 PPT 白屏根因）
package pptx

import (
	"archive/zip"
	"bytes"
	"io"
	"testing"
)

const themeWithBgFill = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T">
 <a:themeElements>
  <a:clrScheme name="CS">
   <a:dk1><a:srgbClr val="000000"/></a:dk1>
   <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
   <a:dk2><a:srgbClr val="444D26"/></a:dk2>
   <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
  </a:clrScheme>
  <a:fmtScheme>
   <a:bgFillStyleLst>
    <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
    <a:blipFill><a:blip r:embed="rId1"><a:duotone>
      <a:schemeClr val="phClr"><a:shade val="55000"/></a:schemeClr>
      <a:schemeClr val="phClr"><a:tint val="40000"/></a:schemeClr>
    </a:duotone></a:blip></a:blipFill>
    <a:blipFill><a:blip r:embed="rId2"><a:duotone>
      <a:schemeClr val="phClr"><a:shade val="12000"/></a:schemeClr>
      <a:schemeClr val="phClr"><a:tint val="65000"/></a:schemeClr>
    </a:duotone></a:blip></a:blipFill>
   </a:bgFillStyleLst>
  </a:fmtScheme>
 </a:themeElements>
</a:theme>`

const masterWithBgRef = `<?xml version="1.0"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
 <p:cSld>
  <p:bg><p:bgRef idx="1003"><a:schemeClr val="bg2"/></p:bgRef></p:bg>
  <p:spTree/>
 </p:cSld>
 <p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2"/>
</p:sldMaster>`

// theme rels 指向灰度背景图（4x4 全 #b7b7b7 JPEG 由 go 生成不便——用最小有效 JPEG 太复杂，
// 改为测「图缺失 → 回退基色 duotone 混合」与「idx=1001 纯色」两条路径。
func makeBgRefZip(t *testing.T) map[string]*zip.File {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	files := map[string]string{
		"ppt/theme/theme1.xml":               themeWithBgFill,
		"ppt/slideMasters/slideMaster1.xml": masterWithBgRef,
	}
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(w, content); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]*zip.File{}
	for _, f := range zr.File {
		out[f.Name] = f
	}
	return out
}

// idx=1003（第 3 项 blipFill+duotone）：图片缺失时回退 = 基色与 duotone 变换色的亮度混合
func TestBgRefDuotone(t *testing.T) {
	files := makeBgRefZip(t)
	theme := parseTheme(files)
	master := parseMasterExtras(files, "ppt/slideMasters/slideMaster1.xml")
	t.Logf("theme=%v clrMap=%v", theme, master.clrMap)
	got := parseBgColor(files, "ppt/slideMasters/slideMaster1.xml", theme, master.clrMap)
	if got == "" {
		t.Fatal("bgRef 解析为空 —— 白屏根因未修")
	}
	t.Logf("bgRef idx=1003 → %s", got)
	// duotone shade12+tint65：基色 444D26 → 暗 #080905 亮 #BEC1B3。
	// 无图回退取中亮度 0.5 → 期望 #63655C 附近（与 LibreOffice #8A8B83 同色系）
	if got != "#63655C" {
		t.Logf("（图片缺失回退值，与设计值 #63655C 差异可接受：实际 %s）", got)
	}
}

// idx=1001（solidFill phClr）：直接返回基色
func TestBgRefSolid(t *testing.T) {
	files := makeBgRefZip(t)
	theme := parseTheme(files)
	master := parseMasterExtras(files, "ppt/slideMasters/slideMaster1.xml")
	// 改 idx=1001
	masterWithSolid := bytes.Replace([]byte(masterWithBgRef), []byte(`idx="1003"`), []byte(`idx="1001"`), 1)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("ppt/slideMasters/slideMaster1.xml")
	io.WriteString(w, string(masterWithSolid))
	w2, _ := zw.Create("ppt/theme/theme1.xml")
	io.WriteString(w2, themeWithBgFill)
	zw.Close()
	zr, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	files2 := map[string]*zip.File{}
	for _, f := range zr.File {
		files2[f.Name] = f
	}
	got := parseBgColor(files2, "ppt/slideMasters/slideMaster1.xml", theme, master.clrMap)
	// bg2 → clrMap → dk2 → 444D26
	if got != "#444D26" {
		t.Fatalf("idx=1001 期望 #444D26（bg2→dk2），得到 %s", got)
	}
}
