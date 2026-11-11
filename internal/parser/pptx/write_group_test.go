package pptx

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

// TestGroupShapeRoundTrip 验证：前端 JSON 带 groupId 的形状写出为 p:grpSp
// （off/ext = 成员包围盒，chOff/chExt = off/ext 恒等子空间），
// 解析回读后 GroupID 与坐标完全一致；组内 p:pic 保持 p:pic 输出。
func TestGroupShapeRoundTrip(t *testing.T) {
	wJSON := `{
          "pageW": 12192000, "pageH": 6858000,
          "slides": [
            {
              "bg": "#FFFFFF",
              "shapes": [
                {"kind":"text","type":"rect","x":914400,"y":914400,"cx":1828800,"cy":914400,
                 "fill":"#FF0000","text":"A","color":"#FFFFFF","sizePt":18,"groupId":"grp1"},
                {"kind":"pic","x":2743200,"y":914400,"cx":1828800,"cy":914400,
                 "img":"` + tinyPNG + `","groupId":"grp1"},
                {"kind":"text","type":"rect","x":914400,"y":2743200,"cx":914400,"cy":914400,
                 "fill":"#00FF00","text":"B","color":"#000000","sizePt":18}
              ]
            }
          ]
        }`

	dir := t.TempDir()
	p := filepath.Join(dir, "group.pptx")
	if err := WritePPTX(p, wJSON); err != nil {
		t.Fatalf("WritePPTX: %v", err)
	}

	// 1) 严格模式逐 token 解析 slide XML（捕获畸形结构）
	zr, err := zip.OpenReader(p)
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	defer zr.Close()
	slide1XML := ""
	for _, f := range zr.File {
		if f.Name != "ppt/slides/slide1.xml" {
			continue
		}
		rc, e := f.Open()
		if e != nil {
			t.Fatalf("open slide1.xml: %v", e)
		}
		var buf bytes.Buffer
		dec := xml.NewDecoder(io.TeeReader(rc, &buf)) // Strict 默认 true
		for {
			_, err := dec.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Errorf("slide XML not well-formed: %v", err)
				break
			}
		}
		rc.Close()
		slide1XML = buf.String()
	}
	if slide1XML == "" {
		t.Fatalf("slide1.xml missing")
	}

	// 2) grpSp 包裹片段存在性：两个 g1 成员包围盒 (914400,914400)-(4572000,1828800)
	//    off/ext = chOff/chExt（恒等子空间），组内 pic 仍为 p:pic
	for _, frag := range []string{
		`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="`,
		`<a:off x="914400" y="914400"/><a:ext cx="3657600" cy="914400"/>`,
		`<a:chOff x="914400" y="914400"/><a:chExt cx="3657600" cy="914400"/>`,
		`</p:grpSpPr>`,
		`</p:grpSp>`,
	} {
		if !strings.Contains(slide1XML, frag) {
			t.Errorf("slide1.xml missing grpSp fragment: %s", frag)
		}
	}
	// 组内 p:pic 保持 p:pic 输出（且位于 grpSp 内部）
	gi := strings.Index(slide1XML, `<p:grpSp>`)
	pi := strings.Index(slide1XML, `<p:pic>`)
	ge := strings.LastIndex(slide1XML, `</p:grpSp>`)
	if gi < 0 || pi < 0 || ge < 0 || pi < gi || pi > ge {
		t.Errorf("p:pic must appear inside p:grpSp (grpSp@%d pic@%d close@%d)", gi, pi, ge)
	}

	// 3) ContentTypes 需注册 svg/webp（decodeDataURL 支持、写出包才合法）
	for _, f := range zr.File {
		if f.Name != "[Content_Types].xml" {
			continue
		}
		rc, e := f.Open()
		if e != nil {
			t.Fatalf("open [Content_Types].xml: %v", e)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		ct := string(b)
		if !strings.Contains(ct, `<Default Extension="svg" ContentType="image/svg+xml"/>`) {
			t.Errorf("[Content_Types].xml missing svg Default")
		}
		if !strings.Contains(ct, `<Default Extension="webp" ContentType="image/webp"/>`) {
			t.Errorf("[Content_Types].xml missing webp Default")
		}
	}

	// 4) 解析回读断言：GroupID 与坐标一致
	f, err := os.Open(p)
	if err != nil {
		t.Fatalf("open saved: %v", err)
	}
	defer f.Close()
	doc, _, err := New().Parse(f)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	var slides []map[string]any
	for _, b := range doc.Blocks {
		if rb, ok := b.(*core.RawBlock); ok && rb.Kind == "slide" {
			slides = append(slides, rb.Data)
		}
	}
	if len(slides) != 1 {
		t.Fatalf("slides = %d, want 1", len(slides))
	}
	shapes, _ := slides[0]["shapes"].([]shapeDef)
	if len(shapes) != 3 {
		t.Fatalf("shapes = %d, want 3", len(shapes))
	}
	if shapes[0].GroupID != "grp1" {
		t.Errorf("shape0 GroupID = %q, want grp1", shapes[0].GroupID)
	}
	if shapes[1].GroupID != "grp1" {
		t.Errorf("shape1 GroupID = %q, want grp1", shapes[1].GroupID)
	}
	if shapes[2].GroupID != "" {
		t.Errorf("shape2 GroupID = %q, want empty", shapes[2].GroupID)
	}
	// 坐标恒等回读（chOff=off → 无缩放/平移）
	if shapes[0].X != 914400 || shapes[0].Y != 914400 || shapes[0].Cx != 1828800 || shapes[0].Cy != 914400 {
		t.Errorf("shape0 geom = (%d,%d,%d,%d), want (914400,914400,1828800,914400)",
			shapes[0].X, shapes[0].Y, shapes[0].Cx, shapes[0].Cy)
	}
	if shapes[1].X != 2743200 || shapes[1].Y != 914400 || shapes[1].Cx != 1828800 || shapes[1].Cy != 914400 {
		t.Errorf("shape1 geom = (%d,%d,%d,%d), want (2743200,914400,1828800,914400)",
			shapes[1].X, shapes[1].Y, shapes[1].Cx, shapes[1].Cy)
	}
	if shapes[2].X != 914400 || shapes[2].Y != 2743200 || shapes[2].Cx != 914400 || shapes[2].Cy != 914400 {
		t.Errorf("shape2 geom = (%d,%d,%d,%d), want (914400,2743200,914400,914400)",
			shapes[2].X, shapes[2].Y, shapes[2].Cx, shapes[2].Cy)
	}
	if shapes[1].Kind != "pic" {
		t.Errorf("shape1 Kind = %q, want pic", shapes[1].Kind)
	}
}

// TestNestedGrpSpParse 验证嵌套 p:grpSp 解析：子形状坐标自内向外逐层绝对化，
// GroupID 取最内层组（grpN 递增），组内文字/样式解析不受影响。
//
// 外层组：off=(1000000,2000000) ext=(4000000,2000000) chOff=(0,0) chExt=(2000000,1000000) → 缩放 2 倍
// 内层组：off=(200000,100000) ext=chExt=(1000000,500000) chOff=(0,0) → 纯平移
func TestNestedGrpSpParse(t *testing.T) {
	xmlStr := `<?xml version="1.0" encoding="UTF-8"?>` +
		`<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
		`<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
		`<p:grpSp>` +
		`<p:nvGrpSpPr><p:cNvPr id="100" name="outer"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
		`<p:grpSpPr><a:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="4000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="1000000"/></a:xfrm></p:grpSpPr>` +
		`<p:sp><p:nvSpPr><p:cNvPr id="11" name="s1"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="100000" y="50000"/><a:ext cx="500000" cy="250000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
		`<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" sz="1800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>inner text</a:t></a:r></a:p></p:txBody>` +
		`</p:sp>` +
		`<p:grpSp>` +
		`<p:nvGrpSpPr><p:cNvPr id="101" name="inner"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
		`<p:grpSpPr><a:xfrm><a:off x="200000" y="100000"/><a:ext cx="1000000" cy="500000"/><a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="500000"/></a:xfrm></p:grpSpPr>` +
		`<p:sp><p:nvSpPr><p:cNvPr id="12" name="s2"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
		`<p:txBody><a:bodyPr/><a:p><a:r><a:t>nested</a:t></a:r></a:p></p:txBody>` +
		`</p:sp>` +
		`</p:grpSp>` +
		`</p:grpSp>` +
		`</p:spTree></p:cSld></p:sld>`

	master := &masterExtras{clrMap: defaultClrMap(), txStyles: map[string]runDef{}}
	slide := parseSlide(strings.NewReader(xmlStr), "ppt/slides/slide1.xml", nil, nil,
		themeScheme{}, master, map[string]phXfrm{}, map[string]phXfrm{})
	if len(slide.Shapes) != 2 {
		t.Fatalf("shapes = %d, want 2", len(slide.Shapes))
	}
	s1, s2 := slide.Shapes[0], slide.Shapes[1]
	// 外层直接子形状：grp1，坐标 ×2 平移到 (1000000,2000000)
	if s1.GroupID != "grp1" {
		t.Errorf("s1 GroupID = %q, want grp1", s1.GroupID)
	}
	if s1.X != 1200000 || s1.Y != 2100000 || s1.Cx != 1000000 || s1.Cy != 500000 {
		t.Errorf("s1 geom = (%d,%d,%d,%d), want (1200000,2100000,1000000,500000)", s1.X, s1.Y, s1.Cx, s1.Cy)
	}
	// 嵌套内层子形状：grp2，先内层平移再外层 ×2
	if s2.GroupID != "grp2" {
		t.Errorf("s2 GroupID = %q, want grp2", s2.GroupID)
	}
	if s2.X != 1400000 || s2.Y != 2200000 || s2.Cx != 2000000 || s2.Cy != 1000000 {
		t.Errorf("s2 geom = (%d,%d,%d,%d), want (1400000,2200000,2000000,1000000)", s2.X, s2.Y, s2.Cx, s2.Cy)
	}
	// 组内文字/样式解析不受影响
	if s1.Text != "inner text" {
		t.Errorf("s1 Text = %q, want inner text", s1.Text)
	}
	if s1.SizePt != 18 {
		t.Errorf("s1 SizePt = %d, want 18", s1.SizePt)
	}
	if s1.Color != "#FF0000" {
		t.Errorf("s1 Color = %q, want #FF0000", s1.Color)
	}
	if s2.Text != "nested" {
		t.Errorf("s2 Text = %q, want nested", s2.Text)
	}
}
