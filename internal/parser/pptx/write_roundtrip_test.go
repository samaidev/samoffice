package pptx

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zai/samoffice/internal/core"
)

// tinyPNG 1x1 透明 PNG 的 data URL（用于背景图测试）
const tinyPNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

// TestWriteFeaturesRoundTrip 验证写入器新特性（描边/渐变/旋转/阴影/发光/项目符号/
// 编号/行距/缩进/超链接/切换/背景图）写入 → 解析往返不丢失，且 slide XML 严格可解析。
func TestWriteFeaturesRoundTrip(t *testing.T) {
	wJSON := `{
	  "pageW": 12192000, "pageH": 6858000,
	  "slides": [
	    {
	      "bg": "#112244",
	      "notes": "hello notes",
	      "transition": "fade",
	      "shapes": [
	        {"kind":"text","type":"roundRect","x":914400,"y":914400,"cx":3657600,"cy":1828800,
	         "fill":"#1E88E5","gradient":"1E88E5,FFB300","lineColor":"#FF0000","lineWpt":2,
	         "rotation":45,"shadow":true,"glow":true,"glowColor":"#00FF00",
	         "bullet":true,"indent":1,"lineHeight":1.5,
	         "link":"https://example.com/?a=1&b=2",
	         "text":"要点一\n要点二","color":"#FFFFFF","sizePt":24,"align":"l","vanchor":"t"},
	        {"kind":"text","type":"rect","x":914400,"y":3200400,"cx":3657600,"cy":914400,
	         "fill":"","numbered":true,"lineHeight":1.2,
	         "text":"步骤一\n步骤二","color":"#111111","sizePt":18,"align":"l","vanchor":"t"}
	      ]
	    },
	    {
	      "bg": "url(\"` + tinyPNG + `\")",
	      "transition": "push",
	      "shapes": []
	    }
	  ]
	}`

	dir := t.TempDir()
	p := filepath.Join(dir, "features.pptx")
	if err := WritePPTX(p, wJSON); err != nil {
		t.Fatalf("WritePPTX: %v", err)
	}

	// 1) 严格模式逐 token 解析所有 slide XML（捕获畸形/未转义结构）
	zr, err := zip.OpenReader(p)
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	defer zr.Close()
	slide1XML := ""
	rels1 := ""
	for _, f := range zr.File {
		if strings.HasPrefix(f.Name, "ppt/slides/slide") && strings.HasSuffix(f.Name, ".xml") {
			rc, e := f.Open()
			if e != nil {
				t.Fatalf("open %s: %v", f.Name, e)
			}
			var buf bytes.Buffer
			dec := xml.NewDecoder(io.TeeReader(rc, &buf)) // 严格模式（Strict 默认 true）
			for {
				_, err := dec.Token()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Errorf("slide XML %s not well-formed: %v", f.Name, err)
					break
				}
			}
			rc.Close()
			if f.Name == "ppt/slides/slide1.xml" {
				slide1XML = buf.String()
			}
		}
		if f.Name == "ppt/slides/_rels/slide1.xml.rels" {
			rc, e := f.Open()
			if e == nil {
				var buf bytes.Buffer
				_, _ = io.Copy(&buf, rc)
				rc.Close()
				rels1 = buf.String()
			}
		}
	}

	// 2) 关键 XML 片段存在性（写入端）
	if slide1XML == "" {
		t.Fatalf("slide1.xml missing")
	}
	for _, frag := range []string{
		`<a:ln w="25400"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:ln>`, // 2pt 描边
		`<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="1E88E5"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFB300"/></a:gs></a:gsLst>`,
		` rot="2700000"`, // 45°
		`<a:outerShdw blurRad="50800" dist="38100" dir="5400000" rotWithShape="0">`,
		`<a:glow rad="76200"><a:srgbClr val="00FF00"/></a:glow>`,
		`<a:buChar char="•"/>`,
		`<a:buAutoNum type="arabicPeriod"/>`,
		`<a:lnSpc><a:spcPct val="150000"/></a:lnSpc>`,
		` marL="571500"`, // indent=1 → 285750*2
		`<a:hlinkClick r:id="rIdH1"/>`,
		`<p:transition spd="med"><p:fade/></p:transition>`,
	} {
		if !strings.Contains(slide1XML, frag) {
			t.Errorf("slide1.xml missing fragment: %s", frag)
		}
	}
	// effectLst 子元素顺序：glow 在 outerShdw 之前（CT_EffectList schema 顺序）
	gi := strings.Index(slide1XML, `<a:glow rad="76200"`)
	oi := strings.Index(slide1XML, `<a:outerShdw`)
	if gi >= 0 && oi >= 0 && gi > oi {
		t.Errorf("effectLst order wrong: glow must precede outerShdw")
	}
	// transition 位于 clrMapOvr 之后、</p:sld> 之前
	ci := strings.Index(slide1XML, `</p:clrMapOvr>`)
	ti := strings.Index(slide1XML, `<p:transition`)
	if ci < 0 || ti < 0 || ti < ci {
		t.Errorf("transition must come after clrMapOvr")
	}
	// 超链接外部关系
	for _, frag := range []string{
		`Id="rIdH1"`,
		`Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"`,
		`Target="https://example.com/?a=1&amp;b=2"`,
		`TargetMode="External"`,
	} {
		if !strings.Contains(rels1, frag) {
			t.Errorf("slide1 rels missing: %s", frag)
		}
	}
	// 幻灯片 2 的背景图关系
	foundBgRel := false
	for _, f := range zr.File {
		if f.Name == "ppt/slides/_rels/slide2.xml.rels" {
			rc, e := f.Open()
			if e != nil {
				t.Fatalf("open rels2: %v", e)
			}
			b, _ := io.ReadAll(rc)
			rc.Close()
			foundBgRel = strings.Contains(string(b), `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"`)
		}
	}
	if !foundBgRel {
		t.Errorf("slide2 rels missing background image relationship")
	}

	// 3) 解析回读断言
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
	if len(slides) != 2 {
		t.Fatalf("slides = %d, want 2", len(slides))
	}

	// 幻灯片 1：transition
	if got, _ := slides[0]["transition"].(string); got != "fade" {
		t.Errorf("transition = %q, want fade", got)
	}
	shapes, _ := slides[0]["shapes"].([]shapeDef)
	if len(shapes) != 2 {
		t.Fatalf("shapes = %d, want 2", len(shapes))
	}
	s0 := shapes[0]
	if s0.LineColor != "#FF0000" {
		t.Errorf("LineColor = %q, want #FF0000", s0.LineColor)
	}
	if s0.LineWpt != 2 {
		t.Errorf("LineWpt = %d, want 2", s0.LineWpt)
	}
	if s0.Gradient != "1E88E5,FFB300" {
		t.Errorf("Gradient = %q, want 1E88E5,FFB300", s0.Gradient)
	}
	if math.Abs(s0.Rotation-45) > 0.001 {
		t.Errorf("Rotation = %v, want 45", s0.Rotation)
	}
	if !s0.Shadow {
		t.Errorf("Shadow = false, want true")
	}
	if !s0.Glow {
		t.Errorf("Glow = false, want true")
	}
	if s0.GlowColor != "#00FF00" {
		t.Errorf("GlowColor = %q, want #00FF00", s0.GlowColor)
	}
	if !s0.Bullet {
		t.Errorf("Bullet = false, want true")
	}
	if s0.Indent != 1 {
		t.Errorf("Indent = %d, want 1", s0.Indent)
	}
	if math.Abs(s0.LineHeight-1.5) > 0.0001 {
		t.Errorf("LineHeight = %v, want 1.5", s0.LineHeight)
	}
	if s0.Link != "https://example.com/?a=1&b=2" {
		t.Errorf("Link = %q", s0.Link)
	}
	s1 := shapes[1]
	if !s1.Numbered {
		t.Errorf("Numbered = false, want true")
	}
	if s1.Bullet {
		t.Errorf("Bullet = true, want false (numbered shape)")
	}
	if math.Abs(s1.LineHeight-1.2) > 0.0001 {
		t.Errorf("shape2 LineHeight = %v, want 1.2", s1.LineHeight)
	}

	// 幻灯片 2：push 切换 + 背景图 data URL
	if got, _ := slides[1]["transition"].(string); got != "push" {
		t.Errorf("slide2 transition = %q, want push", got)
	}
	bg, _ := slides[1]["bg"].(string)
	if !strings.HasPrefix(bg, `url("data:image/png;base64,`) || !strings.HasSuffix(bg, `")`) {
		t.Errorf("slide2 bg = %q, want url(\"data:image/png;base64,...\")", bg)
	}
}
