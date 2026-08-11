// Package pdf 将 UDM 渲染为 PDF 文件
// 基于 signintech/gopdf，嵌入 NotoSansSC 字体支持中文
package pdf

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"embed"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/signintech/gopdf"
	"github.com/zai/samoffice/internal/core"
)

//go:embed fonts/NotoSerifSC-Regular.ttf
var fontSerifFS embed.FS

//go:embed fonts/LiberationSans-Regular.ttf
var fontSansFS embed.FS

//go:embed fonts/LiberationMono-Regular.ttf
var fontMonoFS embed.FS

const (
	// 已内嵌（可靠）的字体
	fontSerif = "NotoSerifSC"  // 内嵌文件族 id
	fontSans  = "LiberationSans"  // 内嵌文件族 id
	fontMono  = "LiberationMono"  // 内嵌文件族 id
	// 运行时注册的字体族（宋/楷/黑/仿宋/ Times New Roman）
	fontSong = "Song"
	fontKai  = "Kai"
	fontHei  = "Hei"
	fontFang = "Fang"
	fontTNR  = "TNR"

	marginTop    = 50.0
	marginBottom = 50.0
	marginLeft   = 50.0
	marginRight  = 50.0
	pageWidth    = 595.28 // A4 width in points
	pageHeight   = 841.89 // A4 height in points
	lineHeight   = 18.0
)

// diskFontCandidates 各字体族在常见系统上的 TTF 候选路径（按序尝试，首个存在者生效）
var diskFontCandidates = map[string][]string{
	fontKai:  {"C:\\Windows\\Fonts\\simkai.ttf", "/usr/share/fonts/truetype/simkai.ttf", "/Library/Fonts/Kaiti.ttc"},
	fontHei:  {"C:\\Windows\\Fonts\\simhei.ttf", "/usr/share/fonts/truetype/simhei.ttf"},
	fontFang: {"C:\\Windows\\Fonts\\simfang.ttf", "/usr/share/fonts/truetype/simfang.ttf"},
	fontTNR:  {"C:\\Windows\\Fonts\\times.ttf", "/usr/share/fonts/truetype/times.ttf"},
}

// fontBook 统一管理本渲染所需的字体族：内嵌字体 + 系统 CJK 字体，
// 并把文档中的字体名解析到已注册的族。
type fontBook struct {
	pdf *gopdf.GoPdf
	reg map[string]bool
}

func newFontBook(pdf *gopdf.GoPdf) *fontBook {
	fb := &fontBook{pdf: pdf, reg: map[string]bool{}}
	// 内嵌字体（始终可用）
	fb.addEmbed(fontSong, fontSerifFS, "fonts/NotoSerifSC-Regular.ttf")
	fb.addEmbed(fontSans, fontSansFS, "fonts/LiberationSans-Regular.ttf")
	fb.addEmbed(fontMono, fontMonoFS, "fonts/LiberationMono-Regular.ttf")
	// 系统 CJK 字体（缺失则回退到 Song）
	for fam, cands := range diskFontCandidates {
		fb.addDisk(fam, cands)
	}
	return fb
}

func (fb *fontBook) addEmbed(fam string, fs embed.FS, path string) {
	data, err := fs.ReadFile(path)
	if err == nil && fb.pdf.AddTTFFontData(fam, data) == nil {
		fb.reg[fam] = true
	}
}

func (fb *fontBook) addDisk(fam string, cands []string) {
	for _, p := range cands {
		data, err := os.ReadFile(p)
		if err == nil && fb.pdf.AddTTFFontData(fam, data) == nil {
			fb.reg[fam] = true
			return
		}
	}
}

// resolve 把文档字体名映射到已注册族；未注册或未知一律回退到 Song（含中文）。
func (fb *fontBook) resolve(name string) string {
	var fam string
	switch name {
	case "宋体", "serif", "Noto Serif SC", "Songti SC", "SimSun", "宋":
		fam = fontSong
	case "楷体", "华文新魏", "KaiTi", "STXinwei", "楷", "华文行楷", "STXingkai":
		fam = fontKai
	case "黑体", "SimHei", "黑", "微软雅黑", "Microsoft YaHei":
		fam = fontHei
	case "仿宋", "FangSong", "仿":
		fam = fontFang
	case "Times New Roman", "Times", "TNR", "Calibri", "Arial":
		fam = fontTNR
	case "等宽", "mono", "monospace", "Consolas", "Courier":
		fam = fontMono
	default:
		fam = fontSong
	}
	if fb.reg[fam] {
		return fam
	}
	return fontSong
}

func (fb *fontBook) set(fam string, size float64) {
	_ = fb.pdf.SetFont(fam, "", size)
}

type Renderer struct{}

func New() *Renderer { return &Renderer{} }

func (r *Renderer) Supported() []string { return []string{".pdf"} }

// Render 将 UDM 渲染为 PDF 字节流
func (r *Renderer) Render(doc *core.Document) ([]byte, error) {
        pdf := gopdf.GoPdf{}
        pdf.Start(gopdf.Config{
                PageSize: *gopdf.PageSizeA4,
        })

	// 统一构建字体簿（内嵌 + 系统 CJK）
	fb := newFontBook(&pdf)
	// 默认用宋体
	if err := pdf.SetFont(fontSong, "", 14); err != nil {
		return nil, fmt.Errorf("set font: %w", err)
	}

        pdf.SetMargins(marginLeft, marginTop, marginRight, marginBottom)
        pdf.AddPage()
        y := marginTop

        // floatZone 记录当前页的浮动图片避让区（左/右环绕时后续文字在其旁排版）。
        // 浮动图片不跨页，换页即清空，避免坐标错乱。
        var fz struct {
                active  bool
                side    string // left | right
                x0, x1  float64
                yBottom float64
        }

        for _, b := range doc.Blocks {
                if y > pageHeight-marginBottom {
                        pdf.AddPage()
                        y = marginTop
                        fz = struct {
                                active  bool
                                side    string
                                x0, x1  float64
                                yBottom float64
                        }{}
                }
                if _, ok := b.(*core.PageBreak); ok {
                        pdf.AddPage()
                        y = marginTop
                        fz = struct {
                                active  bool
                                side    string
                                x0, x1  float64
                                yBottom float64
                        }{}
                        continue
                }
                // 浮动图片（左/右环绕）：画在页边，文字在剩余宽度内环绕，y 不前进
                if im, ok := b.(*core.Image); ok && (im.Float == "left" || im.Float == "right") {
                        iw := im.Width
                        if iw == 0 {
                                iw = 200
                        }
                        ih := im.Height
                        if ih == 0 {
                                ih = 100
                        }
                        var ix float64
                        if im.Float == "left" {
                                ix = marginLeft
                        } else {
                                ix = pageWidth - marginRight - iw
                        }
                        _, _, _ = drawImageAt(&pdf, im, ix, y)
                        fz.active = true
                        fz.side = im.Float
                        gap := 8.0
                        if im.Float == "left" {
                                fz.x0 = ix + iw + gap
                                fz.x1 = pageWidth - marginRight
                        } else {
                                fz.x0 = marginLeft
                                fz.x1 = ix - gap
                        }
                        fz.yBottom = math.Min(y+ih+gap, pageHeight-marginBottom)
                        continue
                }
                // 计算当前块可用水平范围（受浮动图片避让区约束）
                bx0, bx1 := marginLeft, pageWidth-marginRight
                if fz.active {
                        if y < fz.yBottom {
                                bx0, bx1 = fz.x0, fz.x1
                        } else {
                                fz.active = false
                        }
                }
                _, y = renderBlock(fb, &pdf, b, bx0, bx1, y)
        }

        // 文档全部画出后，逐页绘制页脚页码
        if doc.PageNumber != nil && doc.PageNumber.Enabled {
                // gopdf 不暴露总页数；渲染结束已知实际页数，回写每页页脚。
                total := pdf.GetNumberOfPages()
                if total < 1 {
                        total = 1
                }
                for pg := 1; pg <= total; pg++ {
                        pdf.SetPage(pg)
                        renderFooter(&pdf, doc.PageNumber, pg, total)
                }
        }

        var buf bytes.Buffer
        if err := pdf.Write(&buf); err != nil {
                return nil, fmt.Errorf("write pdf: %w", err)
        }
        return buf.Bytes(), nil
}

// renderFooter 在当前页底部绘制页码（参考 {n}=当前页，{total}=总页数）。
func renderFooter(pdf *gopdf.GoPdf, pn *core.PageNumberConfig, cur, total int) {
        fb := newFontBook(pdf)
        fb.set(fontSong, 10)
        var txt string
        if pn.Format != "" {
                txt = strings.ReplaceAll(pn.Format, "{n}", fmt.Sprintf("%d", cur))
                if total > 0 {
                        txt = strings.ReplaceAll(txt, "{total}", fmt.Sprintf("%d", total))
                } else {
                        txt = strings.ReplaceAll(txt, "{total}", "-")
                }
        } else {
                txt = fmt.Sprintf("%d", cur)
        }
        w, _ := pdf.MeasureTextWidth(txt)
        y := pageHeight - marginBottom + 18
        var x float64
        switch pn.Align {
        case "right":
                x = pageWidth - marginRight - w
        case "left":
                x = marginLeft
        default: // center
                x = (pageWidth - w) / 2
        }
        pdf.SetXY(x, y)
        pdf.Text(txt)
}

func renderBlock(fb *fontBook, pdf *gopdf.GoPdf, b core.Block, x0, x1, y float64) (float64, float64) {
	switch v := b.(type) {
	case *core.Paragraph:
		// 段前距 + 分页属性（参考 LibreOffice widorp 的分页规则）
		if propIsTrue(v.Props, "pageBreakBefore") && y > marginTop+1 {
			pdf.AddPage()
			y = marginTop
		}
		_, sb, _, _ := paragraphMetrics(v)
		y += sb
		return renderParagraph(fb, pdf, v, x0, x1, y)
	case *core.Heading:
		if propIsTrue(v.Props, "pageBreakBefore") && y > marginTop+1 {
			pdf.AddPage()
			y = marginTop
		}
		_, sb, _, _ := paragraphMetrics(&core.Paragraph{Props: v.Props})
		y += sb
		return renderHeading(fb, pdf, v, x0, x1, y)
	case *core.BulletList:
		return renderBulletList(fb, pdf, v, x0, x1, y)
	case *core.CodeBlock:
		return renderCodeBlock(pdf, v, x0, x1, y)
	case *core.Image:
		return renderImage(pdf, v, x0, y)
	case *core.Table:
		return renderTable(fb, pdf, v, x0, y)
	case *core.Textbox:
		return renderTextbox(fb, pdf, v, x0, y)
	case *core.RawBlock:
		return renderRawBlock(fb, pdf, v, x0, y)
	}
        return x0, y
}

// slideShape 是 PPT 幻灯片形状的本地定义（与 parser/pptx 的 shapeDef 字段一致，
// 但复制到渲染包内以避免跨包依赖）。几何单位均为 EMU。
type slideShape struct {
	Kind    string `json:"kind"` // text | rect | pic
	X       int64  `json:"x"`
	Y       int64  `json:"y"`
	Cx      int64  `json:"cx"`
	Cy      int64  `json:"cy"`
	Fill    string `json:"fill,omitempty"`
	Text    string `json:"text,omitempty"`
	Color   string `json:"color,omitempty"`
	SizePt  int    `json:"sizePt,omitempty"`
	Bold    bool   `json:"bold,omitempty"`
	Align   string `json:"align,omitempty"`
	Vanchor string `json:"vanchor,omitempty"`
	Img     string `json:"img,omitempty"`
}

// renderRawBlock 处理未结构化解析的块（目前主要服务 PPT 幻灯片）。
// PPT 解析器将整张幻灯片以 shapes 列表存于 Data["shapes"]（JSON 字符串），
// 这里按 EMU 比例把文本框/矩形/图片绘制到 A4 画布。
func renderRawBlock(fb *fontBook, pdf *gopdf.GoPdf, b *core.RawBlock, x, y float64) (float64, float64) {
	if b.Kind != "slide" {
		return x, y
	}
	raw, ok := b.Data["shapes"]
	if !ok {
		return x, y
	}
	js, ok := raw.(string)
	if !ok {
		return x, y
	}
	var shapes []slideShape
	if err := json.Unmarshal([]byte(js), &shapes); err != nil {
		return x, y
	}
	const emuPerInch = 914400.0
	const slideW = 10.0 * emuPerInch // 标准 10x7.5 英寸幻灯片
	const slideH = 7.5 * emuPerInch
	scaleX := (pageWidth - marginLeft - marginRight) / (slideW / 72.0)
	scaleY := (pageHeight - marginTop - marginBottom) / (slideH / 72.0)
	top := y
	for _, s := range shapes {
		px := float64(s.X) / emuPerInch / 72.0 * scaleX
		py := float64(s.Y) / emuPerInch / 72.0 * scaleY
		pw := float64(s.Cx) / emuPerInch / 72.0 * scaleX
		ph := float64(s.Cy) / emuPerInch / 72.0 * scaleY
		if pw <= 0 {
			pw = 50
		}
		if ph <= 0 {
			ph = 20
		}
		sx := x + px
		sy := top + py
		switch s.Kind {
		case "pic":
			if data, err := loadImageBytes(s.Img); err == nil {
				if img, _, derr := image.Decode(bytes.NewReader(data)); derr == nil {
					if tmp, terr := os.CreateTemp("", "pdfslide-*.png"); terr == nil {
						if _, werr := tmp.Write(data); werr == nil {
							tmp.Close()
							_ = pdf.Image(tmp.Name(), sx, sy, &gopdf.Rect{W: pw, H: ph})
							_ = os.Remove(tmp.Name())
							_ = img
						} else {
							tmp.Close()
						}
					}
				}
			}
		case "text", "rect":
			// 填充色
			if s.Fill != "" {
				var c [3]uint8
				if hexRGB2(s.Fill, &c) {
					pdf.SetFillColor(c[0], c[1], c[2])
					_ = pdf.Rectangle(sx, sy, sx+pw, sy+ph, "F", 0, 0)
				}
			}
			// 文本
			if s.Text != "" {
				size := float64(s.SizePt)
				if size <= 0 {
					size = 12
				}
				fb.set(fontSong, size)
				setColor(pdf, s.Color)
				tx := sx + 2
				if s.Align == "center" {
					tx = sx + pw/2 - 20
				} else if s.Align == "right" {
					tx = sx + pw - 20
				}
				pdf.SetXY(tx, sy+2)
				pdf.Cell(nil, s.Text)
			}
		}
	}
	return x, y + (slideH/72.0)*scaleY + 10
}

// hexRGB 解析 #RRGGBB 为 RGB，失败返回 false
func hexRGB(hex string) (uint8, uint8, uint8, bool) {
	c := strings.TrimPrefix(hex, "#")
	if len(c) < 6 {
		return 0, 0, 0, false
	}
	var r, g, b uint8
	if _, err := fmt.Sscanf(c[0:2], "%02x", &r); err != nil {
		return 0, 0, 0, false
	}
	if _, err := fmt.Sscanf(c[2:4], "%02x", &g); err != nil {
		return 0, 0, 0, false
	}
	if _, err := fmt.Sscanf(c[4:6], "%02x", &b); err != nil {
		return 0, 0, 0, false
	}
	return r, g, b, true
}

// renderTextbox 在 PDF 中绘制文本框/形状：边框（线宽/线型）、填充、圆角，并渲染内部块。
func renderTextbox(fb *fontBook, pdf *gopdf.GoPdf, tb *core.Textbox, x, y float64) (float64, float64) {
	const pxToPt = 0.75
	wpt := tb.Width * pxToPt
	if wpt <= 0 {
		wpt = 342.0 // 约 9.5cm
	}
	// 估算框高：按内部块数量 * 行高，最小 60pt
	const lineH = 18.0
	boxH := float64(len(tb.Blocks)) * lineH * 1.2
	if boxH < 50 {
		boxH = 50
	}
	if tb.H > 0 {
		boxH = tb.H * 28.35 * 0.04 // 粗略：cm 转 pt（H 通常小）
		if boxH < 50 {
			boxH = 50
		}
	}
	isRound := tb.Shape == "roundRect"
	// 填充
	fr, fg, fb_, hasFill := hexRGB(tb.FillColor)
	// 边框色
	br, bg, bb, hasBorder := hexRGB(tb.BorderColor)
	if !hasBorder {
		br, bg, bb = 0, 0, 0
	}
	pdf.SetStrokeColor(br, bg, bb)
	// 线型
	switch tb.LineStyle {
	case "dash":
		pdf.SetLineType("dashed")
	case "dot":
		pdf.SetLineType("dotted")
	case "dashDot":
		pdf.SetCustomLineType([]float64{5, 2, 1, 2}, 0)
	default:
		pdf.SetLineType("")
	}
	pdf.SetLineWidth(tb.BorderW)
	if hasFill {
		pdf.SetFillColor(fr, fg, fb_)
	}
	style := "D"
	if hasFill {
		style = "DF"
	}
	if isRound {
		radius := tb.Radius * pxToPt
		if radius <= 0 {
			radius = 8
		}
		_ = pdf.Rectangle(x, y, x+wpt, y+boxH, style, radius, 8)
	} else {
		_ = pdf.Rectangle(x, y, x+wpt, y+boxH, style, 0, 0)
	}
	pdf.SetLineType("")
	// 内部文本
	inY := y + 6
	for _, blk := range tb.Blocks {
		switch v := blk.(type) {
		case *core.Paragraph:
			runs := collectRuns(v.Inline)
			_, inY = drawRuns(fb, pdf, runs, x+4, inY, x+wpt-4, 0)
		case core.Paragraph:
			runs := collectRuns(v.Inline)
			_, inY = drawRuns(fb, pdf, runs, x+4, inY, x+wpt-4, 0)
		case *core.Heading:
			// 简化：把标题当普通段落文本
			runs := collectRuns(v.Inline)
			_, inY = drawRuns(fb, pdf, runs, x+4, inY, x+wpt-4, 0)
		}
	}
	return x, y + boxH + 8
}


type runStyle struct {
	text     string
	family   string
	bold     bool
	italic   bool
	under    bool
	strike   bool
	size     float64
	color    string
	bg       string // 单元格/文本背景填充色 #RRGGBB
	align    string // 单元格对齐 left|center|right
	highlight string // 文本高亮色 #RRGGBB
	super    bool   // 上标（脚注引用）
	inlineImg string // 行内图片 data URL
	imgW     float64
	imgH     float64
	footRef  int // 脚注编号（>0 表示脚注引用）
}

// collectRuns 把 Inline 列表拆成带格式片段
func collectRuns(inline []core.Inline) []runStyle {
	var runs []runStyle
	for _, in := range inline {
		switch v := in.(type) {
		case *core.Text:
			runs = append(runs, runStyle{text: v.Content, family: v.Font, bold: v.Bold, italic: v.Italic, under: v.Under, strike: v.Strike, size: v.FontSize, color: v.Color, bg: v.Bg, align: v.Align, highlight: v.Highlight})
		case core.Text:
			runs = append(runs, runStyle{text: v.Content, family: v.Font, bold: v.Bold, italic: v.Italic, under: v.Under, strike: v.Strike, size: v.FontSize, color: v.Color, bg: v.Bg, align: v.Align, highlight: v.Highlight})
		case *core.Hyperlink:
			for _, t := range v.Text {
				if tt, ok := t.(*core.Text); ok {
					runs = append(runs, runStyle{text: tt.Content, family: tt.Font, bold: tt.Bold, italic: tt.Italic, under: true, size: tt.FontSize, color: tt.Color})
				} else if tt, ok := t.(core.Text); ok {
					runs = append(runs, runStyle{text: tt.Content, family: tt.Font, bold: tt.Bold, italic: tt.Italic, under: true, size: tt.FontSize, color: tt.Color})
				}
			}
		case *core.Track:
			runs = append(runs, runStyle{text: v.Content, family: v.Font, bold: v.Bold, italic: v.Italic, under: v.Track == "insert", strike: v.Track == "delete", size: v.FontSize, color: v.Color})
		case core.Track:
			runs = append(runs, runStyle{text: v.Content, family: v.Font, bold: v.Bold, italic: v.Italic, under: v.Track == "insert", strike: v.Track == "delete", size: v.FontSize, color: v.Color})
		case *core.InlineImage:
			runs = append(runs, runStyle{inlineImg: v.Src, imgW: v.Width, imgH: v.Height, size: 12})
		case *core.FootnoteRef:
			runs = append(runs, runStyle{text: fmt.Sprintf("[%d]", v.Num), super: true, footRef: v.Num, size: 9})
		case *core.RawInline:
			if v.Kind == "html" {
				// 内嵌 HTML 片段：尽力用纯文本兜底
				if s, ok := v.Data["text"].(string); ok && s != "" {
					runs = append(runs, runStyle{text: s})
				}
			}
		}
	}
	return runs
}

// setStyle 按片段字体名设置字体族与字号（粗体/斜体在 drawRuns 中以描边伪造，
// 因为系统 CJK 字体大多没有独立的粗体 TTF，直接传 "B" 会导致缺字或报错）
func setStyle(fb *fontBook, family string, size float64) {
	if size <= 0 {
		size = 12
	}
	fb.set(fb.resolve(family), size)
}

// setColor 解析 #RRGGBB 并设置文字颜色（空则黑色）
func setColor(pdf *gopdf.GoPdf, color string) {
	if color == "" {
		pdf.SetTextColor(0, 0, 0)
		return
	}
	c := strings.TrimPrefix(color, "#")
	if len(c) >= 6 {
		var r, g, b uint8
		fmt.Sscanf(c[0:2], "%02x", &r)
		fmt.Sscanf(c[2:4], "%02x", &g)
		fmt.Sscanf(c[4:6], "%02x", &b)
		pdf.SetTextColor(r, g, b)
		return
	}
	pdf.SetTextColor(0, 0, 0)
}

// charWidth 估算单个字符宽度（CJK 取全角，其余取半角）
func charWidth(ch rune, size float64) float64 {
	if ch == '\n' {
		return 0
	}
	if size <= 0 {
		size = 12
	}
	if ch > 0x2E80 {
		return size
	}
	return size * 0.5
}

// wrappedLine 是一行已经按右边界折好的片段序列（每个片段是某 run 的子串切片）。
type wrappedLine struct {
	runs []runStyle
}

// frag 记录某个 run 在折行时所落入的子串范围（rune 索引）。
type frag struct {
	r   runStyle
	s, e int
}

// wrapRuns 与 drawRuns 完全一致的折行宽度算法，但不绘制，而是把 runs 折成
// 若干行的片段序列，供逐行绘制与分页（widow/orphan）使用。
func wrapRuns(runs []runStyle, x0, rightBoundary, lineH float64) []wrappedLine {
	if rightBoundary <= 0 {
		rightBoundary = pageWidth - marginRight
	}
	curX := x0
	var lines []wrappedLine
	var curFrags []frag
	flush := func() {
		if len(curFrags) == 0 {
			return
		}
		lr := make([]runStyle, 0, len(curFrags))
		for _, f := range curFrags {
			nr := f.r
			if f.r.text != "" {
				rs := []rune(f.r.text)
				if f.e > len(rs) {
					f.e = len(rs)
				}
				nr.text = string(rs[f.s:f.e])
			}
			lr = append(lr, nr)
		}
		lines = append(lines, wrappedLine{runs: lr})
		curFrags = nil
		curX = x0
	}
	for _, run := range runs {
		// 行内图片：作为不可分割单元，超界则另起一行
		if run.inlineImg != "" {
			iw := run.imgW
			if iw <= 0 {
				iw = run.size * 4
			}
			if curX+iw > rightBoundary && len(curFrags) > 0 {
				flush()
			}
			curFrags = append(curFrags, frag{r: run, s: 0, e: 1})
			curX += iw
			continue
		}
		if run.text == "" {
			continue
		}
		rs := []rune(run.text)
		for i, ch := range rs {
			if ch == '\n' {
				flush()
				continue
			}
			w := charWidth(ch, run.size)
			if curX+w > rightBoundary && len(curFrags) > 0 {
				flush()
			}
			curFrags = append(curFrags, frag{r: run, s: i, e: i + 1})
			curX += w
		}
	}
	flush()
	return lines
}

// drawWrappedLine 绘制一行（由 wrapRuns 生成的片段序列），行高 lineH，返回绘制后的 y。
func drawWrappedLine(fb *fontBook, pdf *gopdf.GoPdf, line wrappedLine, x0, y, lineH float64) float64 {
	curX := x0
	// 行高用于行内上移与高亮底纹：取本行最大字号推导的单倍与段落行高之大者，
	// 保证多字号混排时不互相压字（同 LibreOffice 取每行最大高度）。
	rowLineH := lineH
	maxSize := 0.0
	for _, run := range line.runs {
		if run.size*1.2 > rowLineH {
			rowLineH = run.size * 1.2
		}
		if run.size > maxSize {
			maxSize = run.size
		}
	}
	if rowLineH <= 0 {
		rowLineH = maxSize*1.2 + 0.1
	}
	for _, run := range line.runs {
		// 行内图片
		if run.inlineImg != "" {
			iw := run.imgW
			ih := run.imgH
			if iw <= 0 {
				iw = run.size * 4
			}
			if ih <= 0 {
				ih = run.size * 2
			}
			if data, err := loadImageBytes(run.inlineImg); err == nil {
				if _, _, derr := image.Decode(bytes.NewReader(data)); derr == nil {
					if tmp, terr := os.CreateTemp("", "pdfinl-*.png"); terr == nil {
						if _, werr := tmp.Write(data); werr == nil {
							tmp.Close()
							_ = pdf.Image(tmp.Name(), curX, y, &gopdf.Rect{W: iw, H: ih})
							_ = os.Remove(tmp.Name())
							curX += iw
						} else {
							tmp.Close()
						}
					}
				}
			}
			continue
		}
		if run.text == "" {
			continue
		}
		setStyle(fb, run.family, run.size)
		setColor(pdf, run.color)
		bufW := 0.0
		for _, ch := range []rune(run.text) {
			bufW += charWidth(ch, run.size)
		}
		runLineH := lineH
		if run.size*1.2 > runLineH {
			runLineH = run.size * 1.2
		}
		paint := func(startX float64) {
			if run.highlight != "" {
				var hl [3]uint8
				if hexRGB2(run.highlight, &hl) {
					pdf.SetFillColor(hl[0], hl[1], hl[2])
					_ = pdf.Rectangle(startX, y, startX+bufW, y+runLineH, "F", 0, 0)
				}
			}
			textY := y + (runLineH-run.size)/2
			if run.bold {
				pdf.SetXY(startX+0.6, textY)
				pdf.Cell(nil, run.text)
			}
			pdf.SetXY(startX, textY)
			pdf.Cell(nil, run.text)
			if run.under || run.strike {
				pdf.SetStrokeColor(0, 0, 0)
				if run.under {
					pdf.Line(startX, textY+run.size*0.95, startX+bufW, textY+run.size*0.95)
				}
				if run.strike {
					pdf.Line(startX, textY+run.size*0.5, startX+bufW, textY+run.size*0.5)
				}
				pdf.SetStrokeColor(0, 0, 0)
			}
		}
		paint(curX)
		curX += bufW
	}
	pdf.SetTextColor(0, 0, 0)
	return y + rowLineH
}

// drawRuns 兼容包装：wrapRuns 后逐行绘制，遇右边界自动换行。返回 (x, y)。
// lineH 为 0 时回退到旧行为（按最大字号 ×1.4），以兼容表格/列表等无显式行距场景。
func drawRuns(fb *fontBook, pdf *gopdf.GoPdf, runs []runStyle, x0, y, rightBoundary, lineH float64) (float64, float64) {
	if rightBoundary <= 0 {
		rightBoundary = pageWidth - marginRight
	}
	defLineH := 0.0
	for _, run := range runs {
		if run.size*1.2 > defLineH {
			defLineH = run.size * 1.2
		}
	}
	if lineH <= 0 {
		lineH = defLineH
	}
	if lineH <= 0 {
		lineH = 14
	}
	lines := wrapRuns(runs, x0, rightBoundary, lineH)
	curY := y
	for _, ln := range lines {
		curY = drawWrappedLine(fb, pdf, ln, x0, curY, lineH)
	}
	return x0, curY
}

// hexRGB2 解析 #RRGGBB，成功写入 out 并返回 true
func hexRGB2(hex string, out *[3]uint8) bool {
	if hex == "" {
		return false
	}
	c := strings.TrimPrefix(hex, "#")
	if len(c) < 6 {
		return false
	}
	var r, g, b uint8
	if _, err := fmt.Sscanf(c[0:2], "%02x", &r); err != nil {
		return false
	}
	if _, err := fmt.Sscanf(c[2:4], "%02x", &g); err != nil {
		return false
	}
	if _, err := fmt.Sscanf(c[4:6], "%02x", &b); err != nil {
		return false
	}
	out[0], out[1], out[2] = r, g, b
	return true
}

// blockStartX 根据对齐计算段落首行起始 X（居中/右对齐整体偏移）
func blockStartX(runs []runStyle, align string) float64 {
	x0 := marginLeft
	if align == "center" || align == "right" {
		total := 0.0
		for _, r := range runs {
			for _, ch := range r.text {
				total += charWidth(ch, r.size)
			}
		}
		if align == "center" {
			x0 = (pageWidth - total) / 2
			if x0 < marginLeft {
				x0 = marginLeft
			}
		} else {
			x0 = (pageWidth - marginRight) - total
			if x0 < marginLeft {
				x0 = marginLeft
			}
		}
	}
	return x0
}

// propStr 从 UDM 的 Props（map[string]any）中按 key 取字符串值。
func propStr(props map[string]any, key string) string {
	if v, ok := props[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// propIsTrue 判断某个 Props 布尔键是否为 true（兼容 "true"/"1"/"on"）。
func propIsTrue(props map[string]any, key string) bool {
	v, ok := props[key]
	if !ok {
		return false
	}
	switch t := v.(type) {
	case bool:
		return t
	case string:
		return t == "true" || t == "1" || t == "on"
	}
	return false
}

// parseLineHeight 解析段落行距规格（来自 OOXML w:spacing）为以 pt 为单位的行高。
// 参考 LibreOffice 的行距算法（porlay.cxx / itrform2.cxx）：
//   - 比例字符串（如 "1.5"、"2"、"1.15"）：行高 = 字体单倍基准 × 比例
//   - 固定/至少值（如 "18pt"）：行高 = 该 pt 值（单倍基准取字号本身，含内部 leading）
// 单倍基准采用 size × 1.2，与 LibreOffice 由字体 ascent/descent 推导的单倍行高相近。
func parseLineHeight(spec string, size float64) (float64, bool) {
	spec = strings.TrimSpace(spec)
	if spec == "" {
		return 0, false
	}
	if strings.HasSuffix(spec, "pt") {
		v, err := strconv.ParseFloat(strings.TrimSuffix(spec, "pt"), 64)
		if err != nil || v <= 0 {
			return 0, false
		}
		return v, true
	}
	if v, err := strconv.ParseFloat(spec, 64); err == nil && v > 0 {
		return size * 1.2 * v, true
	}
	return 0, false
}

// paragraphMetrics 提取段落的行距/段前距/段后距等排版属性（来自 Props）。
// 这些属性由 docx/xlsx parser 从原始格式解析而来，此处消费以还原原生版式。
func paragraphMetrics(p *core.Paragraph) (lineH, spaceBefore, spaceAfter float64, ok bool) {
	lineH, ok = parseLineHeight(propStr(p.Props, "lineHeight"), 11)
	if v, e := strconv.ParseFloat(propStr(p.Props, "spaceBefore"), 64); e == nil && v > 0 {
		spaceBefore = v
	}
	if v, e := strconv.ParseFloat(propStr(p.Props, "spaceAfter"), 64); e == nil && v > 0 {
		spaceAfter = v
	}
	return
}

// paragraphKeep 判断段落是否要求整体保留不拆分（keepLines/keepWithNext）。
func paragraphKeep(p *core.Paragraph) bool {
	return propIsTrue(p.Props, "keepLines") || propIsTrue(p.Props, "keepWithNext")
}

// decideWholeParagraphMove 参考 LibreOffice widorp.cxx 的 widow/orphan 分页算法，
// 决定段落是否应整体下移到下一页（而非在本页拆分）。
//   avail      : 当前页剩余可用高度（页底 - 当前 y）
//   lineH      : 行高
//   n          : 段落行数（measureRuns 测得）
//   spaceAfter : 段后距
//   keep       : 段落要求整体保留（keepLines/keepWithNext）
//   pageBody   : 单页正文区高度（pageHeight - marginBottom - marginTop）
//
// 规则（与 LibreOffice 一致）：
//   1. Keep：整段放不下本页且整段能放进一页 -> 下移。
//   2. 整段都放不下本页且整段能放进一页 -> 下移（避免在本页只留一两行再拆）。
//   3. Orphan：段首在本页剩余不足 orphans(默认2) 行 -> 整段下移，避免段首孤行。
//   4. 已在页顶（avail 接近整页）则不强行下移，留给主循环处理。
func decideWholeParagraphMove(avail, lineH float64, n int, spaceAfter float64, keep bool, pageBody float64) bool {
	if n <= 0 {
		return false
	}
	const orphans, widows = 2, 2
	h := float64(n)*lineH + spaceAfter
	// 已处于页顶（刚换页），不重复下移，交由主循环正常绘制
	if avail >= pageBody-0.5 {
		return false
	}
	// 整段超过一整页（超大段）：不强制下移，避免死循环，允许自然跨页
	if h > pageBody {
		return false
	}
	// 1 & 2：整段放不下本页
	if h > avail {
		return true
	}
	// 3：Orphan 控制——段首在本页剩余不足 orphans 行，整段下移
	if avail < lineH*float64(orphans) {
		return true
	}
	// 4：Widow 控制（保守）——若整段放本页会把段尾 widows 行挤到下一页且本页留白极少，
	//    在单遍渲染下采用：仅当本页连一行都放不下才下移，长段允许自然跨页。
	if avail < lineH {
		return true
	}
	_ = widows
	return false
}

// renderFlow 渲染一个按行折好的文本流（段落/标题共用），参考 LibreOffice
// widorp.cxx 实现严格的 widow/orphan 分页：
//   - keep（keepLines/keepWithNext）：整段不拆，放不下则整段下移。
//   - 整段能放进一页但本页放不下：整段下移，避免段首孤行/段尾寡行。
//   - 超长段必须跨页拆分时：本页放尽量多行，下页承接剩余行，并保证
//     落下一页的段尾（末页）行数 >= widows（默认2），即严格 widow 控制。
func renderFlow(fb *fontBook, pdf *gopdf.GoPdf, runs []runStyle, align string, x, y, lineH, sb, sa float64, keep bool, x1 float64) (float64, float64) {
	if len(runs) == 0 {
		return x, y + sb + sa + lineH
	}
	x0 := blockStartX(runs, align)
	if x1 <= 0 {
		x1 = pageWidth - marginLeft - marginRight
	}
	right := x1
	lines := wrapRuns(runs, x0, right, lineH)
	n := len(lines)
	pageBody := pageHeight - marginTop - marginBottom

	// 段前距（spaceBefore）
	if sb > 0 {
		if y+sb > pageHeight-marginBottom {
			pdf.AddPage()
			y = marginTop
		}
		y += sb
	}
	avail := pageHeight - marginBottom - y
	h := float64(n)*lineH + sa
	const widows = 2

	var splitAt int
	if keep && h <= pageBody && h > avail {
		// Keep：整段不拆，下移
		pdf.AddPage()
		y = marginTop
		splitAt = n
	} else if h <= avail {
		// 整段能放下本页
		splitAt = n
	} else if h <= pageBody {
		// 整段能放进一页但本页放不下 -> 整段下移（避免段首孤行/段尾寡行）
		pdf.AddPage()
		y = marginTop
		splitAt = n
	} else {
		// 超长段必须拆：本页放 k 行，下页 rem 行，保证 rem >= widows（严格 widow）
		k := int(avail / lineH)
		if k < 1 {
			k = 1
		}
		rem := n - k
		if rem < widows && k > widows {
			k -= (widows - rem)
			rem = widows
		}
		splitAt = k
	}

	// 绘制本页前 splitAt 行
	for i := 0; i < splitAt; i++ {
		y = drawWrappedLine(fb, pdf, lines[i], x0, y, lineH)
	}
	if sa > 0 {
		y += sa
	}
	// 跨页：剩余行画到下一页（段尾承接 widen 保证 >= widows 行）
	if splitAt < n {
		pdf.AddPage()
		y = marginTop
		for i := splitAt; i < n; i++ {
			y = drawWrappedLine(fb, pdf, lines[i], x0, y, lineH)
		}
		if sa > 0 {
			y += sa
		}
	}
	return x, y
}

func renderParagraph(fb *fontBook, pdf *gopdf.GoPdf, p *core.Paragraph, x, y, x1 float64) (float64, float64) {
	runs := collectRuns(p.Inline)
	if len(runs) == 0 {
		// 空段落：按行距/段后距占位（保证段落间距不被吞）
		_, sb, sa, _ := paragraphMetrics(p)
		return x, y + sb + sa + lineHeight
	}
	lineH, sb, sa, _ := paragraphMetrics(p)
	return renderFlow(fb, pdf, runs, p.Align, x, y, lineH, sb, sa, paragraphKeep(p), x1)
}

func renderHeading(fb *fontBook, pdf *gopdf.GoPdf, h *core.Heading, x, y, x1 float64) (float64, float64) {
	runs := collectRuns(h.Inline)
	if len(runs) == 0 {
		return x, y + lineHeight
	}
	size := runs[0].size
	if size <= 0 {
		size = 24.0 - float64(h.Level)*3.0
		if size < 12 {
			size = 12
		}
	}
	// 标题强制加粗，未指定字号则统一样式字号
	for i := range runs {
		runs[i].bold = true
		if runs[i].size <= 0 {
			runs[i].size = size
		}
	}
	// 标题同样消费行距：缺省取字号单倍（1.2×），若文档显式指定则覆盖
	lineH, _ := parseLineHeight(propStr(h.Props, "lineHeight"), size)
	if lineH <= 0 {
		lineH = size * 1.2
	}
	_, sb, sa, _ := paragraphMetrics(&core.Paragraph{Props: h.Props})
	// 标题通常 keepWithNext（与下一段同页），同样走严格 widow/orphan 分页
	return renderFlow(fb, pdf, runs, h.Align, x, y, lineH, sb, sa, paragraphKeep(&core.Paragraph{Props: h.Props}), x1)
}

func renderBulletList(fb *fontBook, pdf *gopdf.GoPdf, l *core.BulletList, x, y, x1 float64) (float64, float64) {
	if x1 <= 0 {
		x1 = pageWidth - marginLeft - marginRight
	}
	for i, item := range l.Items {
		var runs []runStyle
		if l.Ordered {
			if l.Style == "references" {
				runs = append(runs, runStyle{text: fmt.Sprintf("[%d] ", i+1), bold: true, size: 12})
			} else {
				runs = append(runs, runStyle{text: fmt.Sprintf("%d. ", i+1), bold: true, size: 12})
			}
		} else {
			runs = append(runs, runStyle{text: "• ", bold: true, size: 12})
		}
		for _, b := range item {
			if p, ok := b.(*core.Paragraph); ok {
				runs = append(runs, collectRuns(p.Inline)...)
			}
		}
		_, ny := drawRuns(fb, pdf, runs, x+20, y, x1-20, 0)
		y = ny
	}
	return x, y
}

func renderCodeBlock(pdf *gopdf.GoPdf, c *core.CodeBlock, x, y, x1 float64) (float64, float64) {
	if x1 <= 0 {
		x1 = pageWidth - marginLeft - marginRight
	}
        pdf.SetY(y)
        pdf.SetX(x)
        lines := strings.Split(c.Code, "\n")
        boxH := float64(len(lines))*14 + 10
        // 灰色背景
        pdf.SetFillColor(240, 240, 240)
        _ = pdf.Rectangle(x, y, x1, y+boxH, "F", 0, 0)
        pdf.SetY(y + 5)
        pdf.SetX(x + 5)

        for _, line := range lines {
                pdf.Cell(nil, line)
                pdf.SetY(pdf.GetY() + 14)
                pdf.SetX(x + 5)
        }
        return x, pdf.GetY() + 5
}

// drawImageAt 在 (x, y) 处绘制图片，返回图片实际宽高（按 im.Width/Height 或默认 200x100）。
// 成功嵌入返回 ok=true；失败时绘制灰框占位并仍返回尺寸，ok=false。
func drawImageAt(pdf *gopdf.GoPdf, im *core.Image, x, y float64) (w, h float64, ok bool) {
	w = im.Width
	if w == 0 {
		w = 200
	}
	h = im.Height
	if h == 0 {
		h = 100
	}

	// 尝试嵌入真实图片；失败（无数据/解码错误）才回退灰框占位
	if data, err := loadImageBytes(im.Src); err == nil && len(data) > 0 {
		img, _, derr := image.Decode(bytes.NewReader(data))
		if derr == nil {
			rect := &gopdf.Rect{W: w, H: h}
			embedded := false
			// 方式一：临时文件 + Image(path)，gopdf 对此支持最稳
			if tmp, terr := os.CreateTemp("", "pdfimg-*.png"); terr == nil {
				if _, werr := tmp.Write(data); werr == nil {
					tmp.Close()
					if ierr := pdf.Image(tmp.Name(), x, y, rect); ierr == nil {
						embedded = true
					}
				} else {
					tmp.Close()
				}
				_ = os.Remove(tmp.Name())
			}
			// 方式二：直接用 image.Image
			if !embedded {
				if ierr := pdf.ImageFrom(img, x, y, rect); ierr == nil {
					embedded = true
				}
			}
			if embedded {
				return w, h, true
			}
		}
	}

	// 回退：灰框占位
	pdf.SetFillColor(220, 220, 220)
	_ = pdf.Rectangle(x, y, x+w, y+h, "F", 0, 0)
	pdf.SetY(y + h/2)
	pdf.SetX(x + 10)
	pdf.Cell(nil, fmt.Sprintf("[Image: %s]", im.Src))
	return w, h, false
}

func renderImage(pdf *gopdf.GoPdf, im *core.Image, x, y float64) (float64, float64) {
	_, h, _ := drawImageAt(pdf, im, x, y)
	return x, y + h + 10
}

// loadImageBytes 从 UDM Image.Src 解析出图片字节。
// 支持 data:image/...;base64,<data> 与本地文件路径两种形式。
func loadImageBytes(src string) ([]byte, error) {
	src = strings.TrimSpace(src)
	if src == "" {
		return nil, fmt.Errorf("empty image src")
	}
	if strings.HasPrefix(src, "data:") {
		comma := strings.Index(src, ",")
		if comma < 0 {
			return nil, fmt.Errorf("bad data url")
		}
		mime := src[5:comma]
		if !strings.HasPrefix(mime, "image/") {
			return nil, fmt.Errorf("not an image mime: %s", mime)
		}
		enc := strings.TrimSpace(src[comma+1:])
		if strings.ContainsAny(enc, " \t\n\r") {
			enc = strings.Join(strings.Fields(enc), "")
		}
		return base64.StdEncoding.DecodeString(enc)
	}
	if strings.HasPrefix(src, "file://") {
		src = src[len("file://"):]
	}
	if !filepath.IsAbs(src) {
		if abs, err := filepath.Abs(src); err == nil {
			src = abs
		}
	}
	return os.ReadFile(src)
}

func renderTable(fb *fontBook, pdf *gopdf.GoPdf, t *core.Table, x, y float64) (float64, float64) {
	if len(t.Rows) == 0 {
		return x, y
	}
	cols := len(t.Rows[0])
	if cols == 0 {
		cols = 1
	}
	// 表格边框线宽（pt）：未解析到则用 0.5pt 默认
	borderW := t.Border
	if borderW <= 0 {
		borderW = 0.5
	}
	pdf.SetLineWidth(borderW)
	// 支持显式列宽，否则均分
	var colWidths []float64
	totalW := pageWidth - marginLeft - marginRight
	if len(t.Width) == cols {
		for _, w := range t.Width {
			colWidths = append(colWidths, w/100.0*totalW)
		}
	} else {
		cw := totalW / float64(cols)
		for i := 0; i < cols; i++ {
			colWidths = append(colWidths, cw)
		}
	}

	const cellSize = 9.0
	// 合并单元格占位矩阵：occupied[r][c]=true 表示该格已被上方/左侧的合并单元格覆盖，跳过
	occupied := make([][]bool, len(t.Rows))
	for r := range occupied {
		occupied[r] = make([]bool, cols)
	}
	// 每个合并单元格跨多少列（用于行高估算与跨列绘制）
	for ri, row := range t.Rows {
		// 先把每个单元格的片段收好，并估算行高（含合并列宽）
		cellRunss := make([][]runStyle, len(row))
		cellColSpan := make([]int, len(row))
		maxLines := 1
		for ci, cell := range row {
			if ci >= cols {
				break
			}
			if occupied[ri][ci] {
				cellRunss = append(cellRunss, nil)
				cellColSpan = append(cellColSpan, 0)
				continue
			}
			cs := cell.ColSpan
			if cs < 1 {
				cs = 1
			}
			if ci+cs > cols {
				cs = cols - ci
			}
			cellColSpan = append(cellColSpan, cs)
			// 累计跨列宽度
			cw := 0.0
			for k := 0; k < cs; k++ {
				cw += colWidths[ci+k]
			}
			runs := collectRuns(cell.Inline)
			for i := range runs {
				if runs[i].size <= 0 {
					runs[i].size = cellSize
				}
			}
			cellRunss = append(cellRunss, runs)
			tw := 0.0
			nl := 1
			avail := cw - 4
			for _, r := range runs {
				for _, ch := range r.text {
					if ch == '\n' {
						nl++
						tw = 0
						continue
					}
					tw += charWidth(ch, r.size)
					if tw > avail && tw > 0 {
						nl++
						tw = 0
					}
				}
			}
			if nl > maxLines {
				maxLines = nl
			}
		}
		rowH := float64(maxLines)*cellSize*1.4 + 4
		// 行高还要考虑 RowSpan：该行的合并单元格实际高度跨多行，取最大值
		if rs := rowSpanHeight(t, ri, cols, cellSize); rs > rowH {
			rowH = rs
		}
		cy := y
		ci := 0
		for idx, cell := range row {
			if ci >= cols {
				break
			}
			if occupied[ri][ci] {
				ci++
				continue
			}
			cs := cellColSpan[idx]
			if cs < 1 {
				cs = 1
			}
			// 纵向合并：找到该单元格垂直跨越的总高度
			rs := cell.RowSpan
			if rs < 1 {
				rs = 1
			}
			totalH := rowH
			for k := 1; k < rs; k++ {
				if ri+k < len(t.Rows) {
					for kc := 0; kc < cs; kc++ {
						occC := ci + kc
						if occC < cols {
							occupied[ri+k][occC] = true
						}
					}
					totalH += rowHeightOnly(t.Rows[ri+k], colWidths, cellSize, cols)
				}
			}
			cx := x
			for k := 0; k < ci; k++ {
				cx += colWidths[k]
			}
			cw := 0.0
			for k := 0; k < cs; k++ {
				cw += colWidths[ci+k]
			}
			// 单元格背景色（表头灰底或单元格自定义背景）
			var bg [3]uint8
			hasBG := false
			if cell.IsHeader {
				pdf.SetFillColor(225, 230, 240)
				hasBG = true
			} else if hexRGB2(cellBg(cell), &bg) {
				pdf.SetFillColor(bg[0], bg[1], bg[2])
				hasBG = true
			}
			if hasBG {
				_ = pdf.Rectangle(cx, cy, cx+cw, cy+totalH, "FD", 0, 0)
			} else {
				_ = pdf.Rectangle(cx, cy, cx+cw, cy+totalH, "D", 0, 0)
			}
			// 绘制文本（按对齐）
			if cellRunss[idx] != nil {
				align := cellAlign(cell)
				x0, rb := alignStartX(cellRunss[idx], align, cx+2, cx+cw-2)
				_ = rb
				drawRuns(fb, pdf, cellRunss[idx], x0, cy+2, cx+cw-2, 0)
			}
			ci += cs
		}
		y += rowH
	}
	return x, y
}

// cellBg 提取单元格背景色（优先 Inline 中 Text.Bg）
func cellBg(cell core.TableCell) string {
	for _, inl := range cell.Inline {
		if t, ok := inl.(*core.Text); ok && t.Bg != "" {
			return t.Bg
		}
		if t, ok := inl.(core.Text); ok && t.Bg != "" {
			return t.Bg
		}
	}
	return ""
}

// cellAlign 提取单元格对齐（优先 Inline 中 Text.Align）
func cellAlign(cell core.TableCell) string {
	for _, inl := range cell.Inline {
		if t, ok := inl.(*core.Text); ok && t.Align != "" {
			return t.Align
		}
		if t, ok := inl.(core.Text); ok && t.Align != "" {
			return t.Align
		}
	}
	return "left"
}

// alignStartX 根据单元格对齐计算文本首行 X
func alignStartX(runs []runStyle, align string, left, right float64) (float64, float64) {
	if align == "center" || align == "right" {
		total := 0.0
		for _, r := range runs {
			for _, ch := range r.text {
				total += charWidth(ch, r.size)
			}
		}
		if align == "center" {
			x0 := (left + right - total) / 2
			if x0 < left {
				x0 = left
			}
			return x0, right
		}
		x0 := right - total
		if x0 < left {
			x0 = left
		}
		return x0, right
	}
	return left, right
}

// rowHeightOnly 估算单行（无合并）的高度，供 RowSpan 累计
func rowHeightOnly(row []core.TableCell, colWidths []float64, cellSize float64, cols int) float64 {
	maxLines := 1
	for ci, cell := range row {
		if ci >= cols {
			break
		}
		runs := collectRuns(cell.Inline)
		for i := range runs {
			if runs[i].size <= 0 {
				runs[i].size = cellSize
			}
		}
		cw := colWidths[ci] - 4
		tw := 0.0
		nl := 1
		for _, r := range runs {
			for _, ch := range r.text {
				if ch == '\n' {
					nl++
					tw = 0
					continue
				}
				tw += charWidth(ch, r.size)
				if tw > cw && tw > 0 {
					nl++
					tw = 0
				}
			}
		}
		if nl > maxLines {
			maxLines = nl
		}
	}
	return float64(maxLines)*cellSize*1.4 + 4
}

// rowSpanHeight 计算某行中跨多行的合并单元格所要求的最小高度
func rowSpanHeight(t *core.Table, ri, cols int, cellSize float64) float64 {
	h := 0.0
	for ci := 0; ci < cols; ci++ {
		if ci >= len(t.Rows[ri]) {
			break
		}
		cell := t.Rows[ri][ci]
		if cell.RowSpan > 1 {
			hh := 0.0
			for k := 0; k < cell.RowSpan; k++ {
				if ri+k < len(t.Rows) {
					hh += rowHeightOnly(t.Rows[ri+k], nil, cellSize, cols)
				}
			}
			if hh > h {
				h = hh
			}
		}
	}
	return h
}

// registerFont 注册单个字体到 gopdf
func registerFont(pdf *gopdf.GoPdf, family string, fs embed.FS, path string) error {
        data, err := fs.ReadFile(path)
        if err != nil {
                return fmt.Errorf("read font %s: %w", family, err)
        }
        if err := pdf.AddTTFFontData(family, data); err != nil {
                return fmt.Errorf("add font %s: %w", family, err)
        }
        return nil
}


// selectFont 已废弃：字体名解析统一由 fontBook.resolve 处理

