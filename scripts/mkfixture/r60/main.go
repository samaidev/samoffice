// mkfixture r60 —— 生成 e2e 探针用的 fixtures/r60.xlsx：
// 三张不同对象定位/样式的浮动图片 + 自定义行高，验证浏览器端的读取与往返。
//
// 跑法：go run ./scripts/mkfixture/r60/main.go
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"

	"github.com/zai/samoffice/internal/parser/xlsx"
)

// 与 xlsx 包的前端 JSON 约定对应（xlsx.sheetJSON 未导出，这里按 schema 构造）
type cellJ struct {
	Value string `json:"value"`
}
type pointJ struct {
	Col int     `json:"col"`
	Row int     `json:"row"`
	Dx  float64 `json:"dx"`
	Dy  float64 `json:"dy"`
}
type cropJ struct {
	L, T, R, B float64
}
type colorJ struct {
	Brightness   float64  `json:"brightness"`
	Contrast     float64  `json:"contrast"`
	Saturation   float64  `json:"saturation"`
	Transparency float64  `json:"transparency"`
	Grayscale    bool     `json:"grayscale"`
	Duotone      []string `json:"duotone"`
}
type lineJ struct {
	Color string  `json:"color"`
	W     float64 `json:"w"`
	Dash  string  `json:"dash"`
	Alpha float64 `json:"alpha"`
}
type shadowJ struct {
	Kind  string  `json:"kind"`
	Blur  float64 `json:"blur"`
	Dist  float64 `json:"dist"`
	Dir   float64 `json:"dir"`
	Color string  `json:"color"`
	Alpha float64 `json:"alpha"`
}
type imageJ struct {
	Row    int    `json:"row"`
	Col    int    `json:"col"`
	Base64 string `json:"base64"`
	Ext    string `json:"ext"`
	Width  int    `json:"width"`
	Height int    `json:"height"`

	From *pointJ `json:"from,omitempty"`
	To   *pointJ `json:"to,omitempty"`
	Mode string  `json:"mode,omitempty"`

	Rot  float64 `json:"rot,omitempty"`
	Crop *cropJ  `json:"crop,omitempty"`
	Geom string  `json:"geom,omitempty"`
	Name string  `json:"name,omitempty"`
	Alt  string  `json:"alt,omitempty"`

	LockAspect bool `json:"lockAspect,omitempty"`
	Locked     *bool `json:"locked,omitempty"`

	Color   *colorJ  `json:"color,omitempty"`
	Ln      *lineJ   `json:"ln,omitempty"`
	Shadow  *shadowJ `json:"shadow,omitempty"`
	SoftEdge float64 `json:"softEdge,omitempty"`

	GeomEdited  bool `json:"geomEdited,omitempty"`
	LnEdited    bool `json:"lnEdited,omitempty"`
	FxEdited    bool `json:"fxEdited,omitempty"`
	CropEdited  bool `json:"cropEdited,omitempty"`
	ColorEdited bool `json:"colorEdited,omitempty"`

	SVG string `json:"svgB64,omitempty"`
}
type sheetJ struct {
	Name       string           `json:"name"`
	Rows       int              `json:"rows"`
	Cols       int              `json:"cols"`
	Cells      map[string]cellJ `json:"cells"`
	ColWidths  map[string]float64 `json:"colWidths,omitempty"`
	RowHeights map[string]float64 `json:"rowHeights,omitempty"`
	Images     []imageJ         `json:"images,omitempty"`
}
type workbookJ struct {
	Sheets []sheetJ `json:"sheets"`
}

func mustPNG(w, h int, c color.RGBA) []byte {
	var buf bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			// 对角条纹，肉眼可辨方向
			if (x+y)%16 < 8 {
				img.Set(x, y, c)
			} else {
				img.Set(x, y, color.RGBA{R: 255, G: 255, B: 255, A: 255})
			}
		}
	}
	if err := png.Encode(&buf, img); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

func main() {
	out := filepath.Join("scripts", "e2e-web", "fixtures", "r60.xlsx")
	if len(os.Args) > 1 {
		out = os.Args[1]
	}

	red := base64.StdEncoding.EncodeToString(mustPNG(96, 64, color.RGBA{R: 220, G: 30, B: 30, A: 255}))
	blue := base64.StdEncoding.EncodeToString(mustPNG(80, 80, color.RGBA{R: 20, G: 60, B: 220, A: 255}))
	svg := base64.StdEncoding.EncodeToString([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#2563EB" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`))
	lock := true

	wb := workbookJ{Sheets: []sheetJ{{
		Name: "S1", Rows: 24, Cols: 14,
		Cells: map[string]cellJ{
			"0-0": {Value: "round60 图片 e2e"},
			"2-0": {Value: "第二张（仅移动）"},
		},
		ColWidths:  map[string]float64{"0": 110},
		RowHeights: map[string]float64{"1": 40, "5": 36},
		Images: []imageJ{
			{
				// A：随单元格改变位置和大小 + 旋转 + 裁剪 + 圆角矩形 + 边框 + 阴影
				Row: 1, Col: 1, Base64: red, Ext: "png", Width: 141, Height: 107,
				From: &pointJ{Col: 1, Row: 1, Dx: 4, Dy: 3},
				To:   &pointJ{Col: 4, Row: 6, Dx: 10, Dy: 6},
				Mode: "moveSize", Name: "红图", Alt: "红色条纹图",
				Rot: 15, Crop: &cropJ{L: 0.1, T: 0, R: 0, B: 0.1},
				Geom: "roundRect", LockAspect: true, Locked: &lock,
				Ln:         &lineJ{Color: "#4472C4", W: 1.5, Dash: "dash", Alpha: 1},
				Shadow:     &shadowJ{Kind: "outer", Blur: 5, Dist: 3, Dir: 90, Color: "#000000", Alpha: 0.4},
				GeomEdited: true, LnEdited: true, FxEdited: true, CropEdited: true,
			},
			{
				// B：只移动不调整大小 + 双色调 + 椭圆 + 柔化边缘
				Row: 8, Col: 5, Base64: blue, Ext: "png", Width: 80, Height: 80,
				From: &pointJ{Col: 5, Row: 8, Dx: 0, Dy: 0},
				To:   &pointJ{Col: 7, Row: 12, Dx: 0, Dy: 0},
				Mode: "move", Name: "蓝图",
				Geom: "ellipse",
				Color: &colorJ{
					Brightness: 0.1, Contrast: 0.05, Transparency: 0.15,
					Duotone: []string{"#000000", "#00B0F0"},
				},
				SoftEdge: 4, GeomEdited: true, ColorEdited: true,
			},
			{
				// C：SVG 图标（svgBlip 矢量 + PNG 兜底）
				Row: 14, Col: 1, Base64: red, Ext: "png", Width: 24, Height: 24,
				From: &pointJ{Col: 1, Row: 14, Dx: 0, Dy: 0},
				To:   &pointJ{Col: 2, Row: 15, Dx: 0, Dy: 0},
				Mode: "moveSize", Name: "图标", SVG: svg,
			},
		},
	}}}

	b, err := json.Marshal(wb)
	if err != nil {
		panic(err)
	}
	data, err := xlsx.WriteXLSXBytes(string(b))
	if err != nil {
		panic(err)
	}
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		panic(err)
	}
	if err := os.WriteFile(out, data, 0o644); err != nil {
		panic(err)
	}
	fmt.Println("written:", out, len(data), "bytes")
}
