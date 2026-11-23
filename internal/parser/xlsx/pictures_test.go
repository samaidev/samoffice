package xlsx

// pictures_test.go —— round60 浮动图片读写的往返与保真测试。
//
// 覆盖：
//  1. 完整模型写出为 DrawingML（editAs / 锚点偏移 / rot / flip / srcRect / prstGeom /
//     a:ln / effectLst / blip 颜色变换 / scene3d+bevelT），再读回逐字段核对；
//  2. Excel 真实写法的 drawing（含 a14:imgProps 效果）解析为模型；
//     未编辑时保存原样写回原始锚点（保真）；
//  3. 组合 (grpSp) 内图片：子坐标空间 → 工作表坐标换算后重新锚定；
//  4. EMF 等不可解码图片不再导致整个保存失败，且能原样往返；
//  5. 行高持久化（px ↔ pt）；
//  6. 三种对象定位方式（editAs）与 SVG 双媒体写出。

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"

	lite "github.com/zai/samoffice/internal/excelizelite"
)

// testPNGBytes 生成一张 3x2 红色 PNG。
func testPNGBytes(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	for x := 0; x < 3; x++ {
		for y := 0; y < 2; y++ {
			img.Set(x, y, color.RGBA{R: 255, A: 255})
		}
	}
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

// drawingOf 从 xlsx 字节里取出第一个 drawing 部件的 XML 文本。
func drawingOf(t *testing.T, data []byte) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	for _, zf := range zr.File {
		if strings.HasPrefix(zf.Name, "xl/drawings/drawing") && strings.HasSuffix(zf.Name, ".xml") {
			rc, _ := zf.Open()
			defer rc.Close()
			var buf bytes.Buffer
			if _, err := buf.ReadFrom(rc); err != nil {
				t.Fatalf("read %s: %v", zf.Name, err)
			}
			return buf.String()
		}
	}
	t.Fatal("no drawing part in output")
	return ""
}

// excelStyleWorkbook 用 excelize 造一个带媒体与关系的工作簿，再把 drawing 部件
// 替换为指定的 XML（模拟 Excel 写出的内容）。
func excelStyleWorkbook(t *testing.T, drawing string) []byte {
	t.Helper()
	f := excelize.NewFile()
	_ = f.SetCellValue("Sheet1", "A1", "x")
	if err := f.AddPictureFromBytes("Sheet1", "A1", &excelize.Picture{
		Extension: ".png", File: testPNGBytes(t),
		Format:    &excelize.GraphicOptions{ScaleX: 1, ScaleY: 1},
	}); err != nil {
		t.Fatalf("seed picture: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	f.Close()

	zr, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, zf := range zr.File {
		if strings.HasPrefix(zf.Name, "xl/drawings/drawing") && strings.HasSuffix(zf.Name, ".xml") {
			w, _ := zw.CreateHeader(&zip.FileHeader{Name: zf.Name, Method: zip.Deflate})
			if _, err := w.Write([]byte(drawing)); err != nil {
				t.Fatalf("replace drawing: %v", err)
			}
			continue
		}
		rc, err := zf.Open()
		if err != nil {
			t.Fatalf("open %s: %v", zf.Name, err)
		}
		data, _ := readAllBytes(rc)
		rc.Close()
		w, _ := zw.CreateHeader(&zip.FileHeader{Name: zf.Name, Method: zip.Deflate})
		w.Write(data)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return out.Bytes()
}

func readAllBytes(rc interface{ Read([]byte) (int, error) }) ([]byte, error) {
	var buf bytes.Buffer
	tmp := make([]byte, 32*1024)
	for {
		n, err := rc.Read(tmp)
		if n > 0 {
			buf.Write(tmp[:n])
		}
		if err != nil {
			return buf.Bytes(), nil
		}
	}
}

func mustJSONMarshal(t *testing.T, v interface{}) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func readBack(t *testing.T, data []byte) workbookJSON {
	t.Helper()
	s, err := ReadXLSXBytes(data)
	if err != nil {
		t.Fatalf("ReadXLSXBytes: %v", err)
	}
	var wb workbookJSON
	if err := json.Unmarshal([]byte(s), &wb); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return wb
}

func approx(t *testing.T, name string, got, want, tol float64) {
	t.Helper()
	if got < want-tol || got > want+tol {
		t.Errorf("%s = %v, want ≈%v (±%v)", name, got, want, tol)
	}
}

// ---- 1. 完整模型 → DrawingML → 读回 ----

func TestPicturesWriteFullDrawingML(t *testing.T) {
	b64 := base64.StdEncoding.EncodeToString(testPNGBytes(t))
	lock, noPrint := true, false
	wb := workbookJSON{Sheets: []sheetJSON{{
		Name: "S1", Rows: 20, Cols: 10, Cells: map[string]cellJSON{},
		Images: []imageJSON{{
			Row: 2, Col: 1, Base64: b64, Ext: "png", Width: 120, Height: 90,
			From: &picPointJSON{Col: 1, Row: 2, Dx: 3, Dy: 4},
			To:   &picPointJSON{Col: 4, Row: 7, Dx: 10, Dy: 6},
			Mode: "move", Size: &picSizeJSON{W: 120, H: 90},
			Rot:  30, FlipH: true,
			Crop: &picCropJSON{L: 0.1, T: 0.05, R: 0, B: 0.2},
			Geom: "ellipse", Name: "照片 1", Alt: "测试图片",
			LockAspect: true, Locked: &lock, PrintObj: &noPrint,
			Color: &picColorJSON{Brightness: 0.2, Contrast: -0.1, Saturation: 0.5, Transparency: 0.3,
				Grayscale: true, Duotone: []string{"#123456", "#ABCDEF"}},
			Ln:          &picLineJSON{Color: "#4472C4", W: 1.5, Dash: "dash", Alpha: 0.8},
			Shadow:      &picShadowJSON{Kind: "outer", Blur: 5, Dist: 3, Dir: 90, Color: "#000000", Alpha: 0.4},
			Glow:        &picGlowJSON{Size: 8, Color: "#FF0000", Alpha: 0.5},
			SoftEdge:    4,
			Reflection:  0.5,
			Bevel:       &picBevelJSON{Preset: "relax", W: 3, H: 3},
			Cam:         "isometricOffAxis1Left",
			GeomEdited:  true, LnEdited: true, FxEdited: true, CropEdited: true, ColorEdited: true,
		}},
	}}}
	data, err := WriteXLSXBytes(mustJSONMarshal(t, wb))
	if err != nil {
		t.Fatalf("WriteXLSXBytes: %v", err)
	}

	// 真 excelize 能打开且能数出图片（上游解析器对结构错误的容错为零）
	vf, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("upstream excelize open: %v", err)
	}
	if cells, err := vf.GetPictureCells("S1"); err != nil || len(cells) != 1 {
		t.Errorf("upstream GetPictureCells = %v (err=%v), want 1", cells, err)
	}
	vf.Close()

	dx := drawingOf(t, data)
	for _, want := range []string{
		`editAs="oneCell"`,
		`<xdr:col>1</xdr:col><xdr:colOff>28575</xdr:colOff>`,
		`<xdr:row>2</xdr:row><xdr:rowOff>38100</xdr:rowOff>`,
		`rot="1800000" flipH="1"`,
		`<a:srcRect l="10000" t="5000" b="20000"/>`,
		`<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>`,
		`<a:ln w="19050"`,
		`val="4472C4"`,
		`<a:prstDash val="dash"/>`,
		`<a:glow rad="76200">`,
		`<a:outerShdw blurRad="47625" dist="28575" dir="5400000"`,
		`<a:softEdge rad="38100"/>`,
		`<a:reflection blurRad="6350" stA="50000"`,
		`<a:alphaModFix amt="70000"/>`,
		`<a:lum bright="20000" contrast="-10000"/>`,
		`<a:satMod val="150000"/>`,
		`<a:grayscl/>`,
		`<a:duotone><a:srgbClr val="123456"/><a:srgbClr val="ABCDEF"/></a:duotone>`,
		`fLocksWithSheet="1" fPrintsWithSheet="0"`,
		`<a:picLocks noChangeAspect="1"/>`,
		`name="照片 1" descr="测试图片"`,
		`<a:camera prst="isometricOffAxis1Left">`,
		`<a:bevelT w="28575" h="28575" prst="relax"/>`,
	} {
		if !strings.Contains(dx, want) {
			t.Errorf("drawing XML 缺少 %q\n实际内容：\n%s", want, dx)
		}
	}

	// 读回：逐字段核对
	back := readBack(t, data)
	if len(back.Sheets) == 0 || len(back.Sheets[0].Images) != 1 {
		t.Fatalf("read back images = %+v", back.Sheets)
	}
	im := back.Sheets[0].Images[0]
	if im.Mode != "move" {
		t.Errorf("mode = %q, want move", im.Mode)
	}
	if im.From == nil || im.From.Col != 1 || im.From.Row != 2 || im.From.Dx != 3 || im.From.Dy != 4 {
		t.Errorf("from = %+v, want col1 row2 dx3 dy4", im.From)
	}
	if im.To == nil || im.To.Col != 4 || im.To.Row != 7 || im.To.Dx != 10 || im.To.Dy != 6 {
		t.Errorf("to = %+v, want col4 row7 dx10 dy6", im.To)
	}
	approx(t, "rot", im.Rot, 30, 0.01)
	if !im.FlipH || im.FlipV {
		t.Errorf("flip = %v/%v, want true/false", im.FlipH, im.FlipV)
	}
	if im.Crop == nil || im.Crop.L != 0.1 || im.Crop.T != 0.05 || im.Crop.B != 0.2 || im.Crop.R != 0 {
		t.Errorf("crop = %+v", im.Crop)
	}
	if im.Geom != "ellipse" {
		t.Errorf("geom = %q, want ellipse", im.Geom)
	}
	if im.Name != "照片 1" || im.Alt != "测试图片" {
		t.Errorf("name/alt = %q/%q", im.Name, im.Alt)
	}
	if !im.LockAspect {
		t.Errorf("lockAspect lost")
	}
	if im.PrintObj == nil || *im.PrintObj {
		t.Errorf("printObj = %v, want false", im.PrintObj)
	}
	if im.Ln == nil || im.Ln.Color != "#4472C4" || im.Ln.W != 1.5 || im.Ln.Dash != "dash" {
		t.Errorf("ln = %+v", im.Ln)
	}
	approx(t, "ln.alpha", im.Ln.Alpha, 0.8, 0.001)
	if im.Shadow == nil || im.Shadow.Kind != "outer" {
		t.Errorf("shadow = %+v", im.Shadow)
	} else {
		approx(t, "shadow.blur", im.Shadow.Blur, 5, 0.01)
		approx(t, "shadow.dist", im.Shadow.Dist, 3, 0.01)
		approx(t, "shadow.dir", im.Shadow.Dir, 90, 0.01)
		approx(t, "shadow.alpha", im.Shadow.Alpha, 0.4, 0.001)
	}
	if im.Glow == nil || im.Glow.Size != 8 || im.Glow.Color != "#FF0000" {
		t.Errorf("glow = %+v", im.Glow)
	}
	approx(t, "softEdge", im.SoftEdge, 4, 0.01)
	approx(t, "reflection", im.Reflection, 0.5, 0.001)
	if im.Color == nil {
		t.Fatal("color lost")
	}
	approx(t, "color.brightness", im.Color.Brightness, 0.2, 0.001)
	approx(t, "color.contrast", im.Color.Contrast, -0.1, 0.001)
	approx(t, "color.saturation", im.Color.Saturation, 0.5, 0.001)
	approx(t, "color.transparency", im.Color.Transparency, 0.3, 0.001)
	if !im.Color.Grayscale || len(im.Color.Duotone) != 2 || im.Color.Duotone[0] != "#123456" {
		t.Errorf("color = %+v", im.Color)
	}
	if im.Bevel == nil || im.Bevel.Preset != "relax" {
		t.Errorf("bevel = %+v", im.Bevel)
	}
	if im.Cam != "isometricOffAxis1Left" {
		t.Errorf("cam = %q", im.Cam)
	}
}

// ---- 2. Excel 真实写法（a14:imgProps 效果）解析 + 未编辑保存的保真 ----

const excelStyleDrawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>1</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>28575</xdr:rowOff></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>7</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="图片 5" descr="风景照"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1" cstate="print"><a:lum bright="20000" contrast="5000"/><a:duotone><a:srgbClr val="000000"/><a:srgbClr val="FFFFFF"/></a:duotone></a:blip><a:srcRect l="15000" t="0" r="5000" b="10000"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm rot="5400000" flipH="1"><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 16667"/></a:avLst></a:prstGeom><a:ln w="19050"><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill><a:prstDash val="dash"/></a:ln></xdr:spPr><xdr:extLst><a:ext uri="{BEBA8EAE-BF5A-486C-A8C5-ECC9F3942E4B}"><a14:imgProps xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><a14:imgLayer><a14:imgEffect><a14:outerShdw blurRad="50800" dist="38100" dir="2700000" algn="tl" rotWithShape="0"><a14:srgbClr val="000000"><a14:alpha val="43000"/></a14:srgbClr></a14:outerShdw></a14:imgEffect></a14:imgLayer><a14:imgPropsPrst prst="shadowOuter"/></a14:imgProps></a:ext></xdr:extLst></xdr:pic><xdr:clientData fLocksWithSheet="1" fPrintsWithSheet="1"/></xdr:twoCellAnchor></xdr:wsDr>`

func TestPicturesReadExcelStyle(t *testing.T) {
	data := excelStyleWorkbook(t, excelStyleDrawing)
	wb := readBack(t, data)
	if len(wb.Sheets) == 0 || len(wb.Sheets[0].Images) != 1 {
		t.Fatalf("images = %+v", wb.Sheets)
	}
	im := wb.Sheets[0].Images[0]

	if im.Mode != "move" {
		t.Errorf("mode = %q, want move (editAs=oneCell)", im.Mode)
	}
	if im.From == nil || im.From.Col != 1 || im.From.Row != 2 || im.From.Dx != 4 || im.From.Dy != 3 {
		t.Errorf("from = %+v, want col1 row2 dx4 dy3", im.From)
	}
	if im.To == nil || im.To.Col != 4 || im.To.Row != 7 || im.To.Dx != 2 || im.To.Dy != 0 {
		t.Errorf("to = %+v, want col4 row7 dx2 dy0", im.To)
	}
	approx(t, "rot", im.Rot, 90, 0.01)
	if !im.FlipH {
		t.Errorf("flipH lost")
	}
	if im.Crop == nil || im.Crop.L != 0.15 || im.Crop.R != 0.05 || im.Crop.B != 0.1 || im.Crop.T != 0 {
		t.Errorf("crop = %+v", im.Crop)
	}
	if im.Geom != "roundRect" {
		t.Errorf("geom = %q, want roundRect", im.Geom)
	}
	if im.Ln == nil || im.Ln.Color != "#4472C4" || im.Ln.W != 1.5 || im.Ln.Dash != "dash" {
		t.Errorf("ln = %+v", im.Ln)
	}
	// a14:imgProps 里的阴影
	if im.Shadow == nil || im.Shadow.Kind != "outer" {
		t.Errorf("shadow = %+v (a14:imgProps 未解析)", im.Shadow)
	} else {
		approx(t, "shadow.blur", im.Shadow.Blur, 50800.0/9525, 0.01)
		approx(t, "shadow.dist", im.Shadow.Dist, 4, 0.01)
		approx(t, "shadow.dir", im.Shadow.Dir, 45, 0.01)
		approx(t, "shadow.alpha", im.Shadow.Alpha, 0.43, 0.001)
	}
	if im.StylePreset != "shadowOuter" {
		t.Errorf("stylePreset = %q", im.StylePreset)
	}
	if im.Name != "图片 5" || im.Alt != "风景照" || !im.LockAspect {
		t.Errorf("name/alt/lockAspect = %q/%q/%v", im.Name, im.Alt, im.LockAspect)
	}
	if im.Color == nil || im.Color.Brightness != 0.2 || im.Color.Contrast != 0.05 || len(im.Color.Duotone) != 2 {
		t.Errorf("color = %+v (blip 颜色变换未解析)", im.Color)
	}
	if im.Raw == "" || !strings.Contains(im.Raw, "a14:imgProps") {
		t.Errorf("raw anchor passthrough lost")
	}
	if im.RawBlipFill == "" || !strings.Contains(im.RawBlipFill, "a:duotone") {
		t.Errorf("raw blipFill passthrough lost")
	}
	if im.SrcRel != "rId1" {
		t.Errorf("srcRel = %q", im.SrcRel)
	}

	// 未编辑 → 保存原样写回原始锚点（仅换关系 id）
	out, err := WriteXLSXBytes(mustJSONMarshal(t, wb))
	if err != nil {
		t.Fatalf("rewrite: %v", err)
	}
	dx := drawingOf(t, out)
	for _, want := range []string{
		`editAs="oneCell"`,
		`rot="5400000" flipH="1"`,
		`<a:srcRect l="15000" t="0" r="5000" b="10000"/>`,
		`<a14:imgProps`,
		`<a14:imgPropsPrst prst="shadowOuter"/>`,
		`<a:duotone>`,
		`prst="roundRect"`,
		`name="图片 5" descr="风景照"`,
	} {
		if !strings.Contains(dx, want) {
			t.Errorf("保真写出缺少 %q", want)
		}
	}
	// 真 excelize 仍能解析
	vf, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("upstream excelize open rewritten: %v", err)
	}
	vf.Close()
}

// ---- 3. 组合 (grpSp) 内的图片 ----

const groupedDrawing = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>12</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="2" name="组 1"/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm><a:off x="1000000" y="500000"/><a:ext cx="800000" cy="600000"/><a:chOff x="0" y="0"/><a:chExt cx="800000" cy="600000"/></a:xfrm></xdr:grpSpPr><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="图片 2"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="200000" y="100000"/><a:ext cx="400000" cy="300000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic></xdr:grpSp><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`

func TestPicturesGroupedRead(t *testing.T) {
	wb := readBack(t, excelStyleWorkbook(t, groupedDrawing))
	if len(wb.Sheets) == 0 || len(wb.Sheets[0].Images) != 1 {
		t.Fatalf("images = %+v (组合内图片未提取)", wb.Sheets)
	}
	im := wb.Sheets[0].Images[0]
	// 组 off(1000000,500000) + 子 off(200000,100000) → (1200000,600000)EMU ≈ (126,63)px
	// 首列宽 = excelize 默认模板的 9.14 字符 → 69px；行高 20px → from ≈ (col1, dx57, row3, dy3)
	if im.From == nil {
		t.Fatal("from lost")
	}
	if im.From.Col != 1 || im.From.Row != 3 {
		t.Errorf("from = %+v, want col1 row3", im.From)
	}
	approx(t, "from.dx", im.From.Dx, 57, 2)
	approx(t, "from.dy", im.From.Dy, 3, 2)
	// 宽 = 400000EMU ≈ 42px
	approx(t, "width", float64(im.Width), 42, 2)
	if im.Raw != "" {
		t.Errorf("组合内图片不应保留 raw 锚点（坐标系不同）")
	}
}

// ---- 4. EMF 不可解码图片不再阻断保存 ----

func TestPicturesEMFRoundTrip(t *testing.T) {
	// 一个假 EMF（内容不重要，重要的是 Go image 无法解码它）
	emf := []byte{0x01, 0x00, 0x00, 0x00, 0x48, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}
	b64 := base64.StdEncoding.EncodeToString(emf)
	wb := workbookJSON{Sheets: []sheetJSON{{
		Name: "S1", Rows: 10, Cols: 10, Cells: map[string]cellJSON{},
		Images: []imageJSON{{Row: 1, Col: 1, Base64: b64, Ext: "emf", Width: 100, Height: 80,
			From: &picPointJSON{Col: 1, Row: 1}, To: &picPointJSON{Col: 3, Row: 5}, Mode: "moveSize"}},
	}}}
	data, err := WriteXLSXBytes(mustJSONMarshal(t, wb))
	if err != nil {
		t.Fatalf("EMF 工作簿保存失败（旧版会因解码失败整体失败）: %v", err)
	}
	// 媒体部件按 .emf 落盘
	zr, _ := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	foundEMF := false
	for _, zf := range zr.File {
		if strings.HasSuffix(zf.Name, ".emf") {
			foundEMF = true
		}
	}
	if !foundEMF {
		t.Errorf("输出里没有 .emf 媒体部件")
	}
	back := readBack(t, data)
	if len(back.Sheets[0].Images) != 1 || back.Sheets[0].Images[0].Ext != "emf" {
		t.Errorf("EMF 读回 = %+v", back.Sheets[0].Images)
	}
	if back.Sheets[0].Images[0].Base64 != b64 {
		t.Errorf("EMF 字节往返后发生变化")
	}
}

// ---- 5. 行高持久化 ----

func TestRowHeightsRoundTrip(t *testing.T) {
	wb := workbookJSON{Sheets: []sheetJSON{{
		Name: "S1", Rows: 10, Cols: 10, Cells: map[string]cellJSON{"0-0": {Value: "x"}},
		RowHeights: map[string]float64{"1": 40, "3": 25},
	}}}
	data, err := WriteXLSXBytes(mustJSONMarshal(t, wb))
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	// 用真 excelize 验证 pt 值：40px→30pt，25px→18.75pt
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if h, _ := f.GetRowHeight("S1", 2); h < 29.9 || h > 30.1 {
		t.Errorf("row2 height = %vpt, want 30", h)
	}
	if h, _ := f.GetRowHeight("S1", 4); h < 18.6 || h > 18.9 {
		t.Errorf("row4 height = %vpt, want 18.75", h)
	}
	f.Close()
	// 读回 px
	back := readBack(t, data)
	rh := back.Sheets[0].RowHeights
	if rh["1"] != 40 || rh["3"] != 25 {
		t.Errorf("rowHeights round trip = %v, want {1:40, 3:25}", rh)
	}
}

// ---- 6. 对象定位三种方式 + SVG 双媒体 ----

func TestPicturesModesAndSVG(t *testing.T) {
	b64 := base64.StdEncoding.EncodeToString(testPNGBytes(t))
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="red"/></svg>`)
	wb := workbookJSON{Sheets: []sheetJSON{{
		Name: "S1", Rows: 20, Cols: 10, Cells: map[string]cellJSON{},
		Images: []imageJSON{
			{Row: 1, Col: 1, Base64: b64, Ext: "png", Width: 80, Height: 60,
				From: &picPointJSON{Col: 1, Row: 1}, To: &picPointJSON{Col: 3, Row: 4}, Mode: "moveSize"},
			{Row: 6, Col: 1, Base64: b64, Ext: "png", Width: 80, Height: 60,
				From: &picPointJSON{Col: 1, Row: 6, Dx: 5, Dy: 5}, To: &picPointJSON{Col: 3, Row: 9},
				Mode: "fixed", Size: &picSizeJSON{W: 80, H: 60}, Abs: &picPosJSON{X: 100, Y: 160}},
			{Row: 12, Col: 1, Base64: b64, Ext: "png", Width: 24, Height: 24,
				From: &picPointJSON{Col: 1, Row: 12}, To: &picPointJSON{Col: 2, Row: 13},
				Mode: "moveSize", Name: "图标", SVG: base64.StdEncoding.EncodeToString(svg), SVGRel: "rIdX"},
		},
	}}}
	data, err := WriteXLSXBytes(mustJSONMarshal(t, wb))
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	dx := drawingOf(t, data)
	if c := strings.Count(dx, `editAs="twoCell"`); c != 2 {
		t.Errorf("editAs=twoCell count = %d, want 2\n%s", c, dx)
	}
	if !strings.Contains(dx, `editAs="absolute"`) {
		t.Errorf("缺少 editAs=absolute（固定位置和大小）")
	}
	if !strings.Contains(dx, `<a:off x="952500" y="1524000"/>`) {
		t.Errorf("固定定位的 xfrm off 缺失（100px,160px → EMU）")
	}
	// SVG：svgBlip 扩展 + 两个媒体部件 + 内容类型
	if !strings.Contains(dx, "asvg:svgBlip") {
		t.Errorf("缺少 svgBlip 扩展")
	}
	zr, _ := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	mediaPNG, mediaSVG := 0, 0
	for _, zf := range zr.File {
		if strings.HasSuffix(zf.Name, ".png") {
			mediaPNG++
		}
		if strings.HasSuffix(zf.Name, ".svg") {
			mediaSVG++
		}
	}
	if mediaSVG != 1 {
		t.Errorf("svg 媒体部件 = %d, want 1", mediaSVG)
	}
	_ = mediaPNG
	// 读回：SVG 部件还原
	back := readBack(t, data)
	icons := 0
	for _, im := range back.Sheets[0].Images {
		if im.Name == "图标" {
			icons++
			if im.SVG == "" {
				t.Errorf("SVG 矢量部件读回丢失")
			}
			if im.SVGRel == "" {
				t.Errorf("SVG 关系 id 读回丢失")
			}
		}
	}
	if icons != 1 {
		t.Errorf("图标图片读回 = %d", icons)
	}
}

// ---- 附：excelizelite 的 RegisterPictureMedia 行为 ----

func TestRegisterPictureMedia(t *testing.T) {
	f := lite.NewFile()
	defer f.Close()
	rID, draw, err := f.RegisterPictureMedia("Sheet1", testPNGBytes(t), ".png")
	if err != nil {
		t.Fatalf("RegisterPictureMedia: %v", err)
	}
	if rID == "" || draw == "" {
		t.Fatalf("rID/draw = %q/%q", rID, draw)
	}
	// 相同字节复用同一关系
	rID2, draw2, err := f.RegisterPictureMedia("Sheet1", testPNGBytes(t), ".png")
	if err != nil {
		t.Fatalf("second register: %v", err)
	}
	if rID2 != rID || draw2 != draw {
		t.Errorf("相同媒体未复用关系：%q vs %q", rID, rID2)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	// 媒体落盘 + drawing 部件存在
	zr, _ := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
	hasMedia, hasDrawing := false, false
	for _, zf := range zr.File {
		if strings.HasPrefix(zf.Name, "xl/media/") {
			hasMedia = true
		}
		if strings.HasPrefix(zf.Name, "xl/drawings/drawing") {
			hasDrawing = true
		}
	}
	if !hasMedia || !hasDrawing {
		t.Errorf("media=%v drawing=%v, want both", hasMedia, hasDrawing)
	}
}
