package xlsx

// pictures.go —— round60：浮动图片数据模型与底层 XML/zip 辅助（对齐 MS Excel「设置图片格式」）。
//
// 读取不再经过 excelize GetPictures 的有损摘要（只有锚定单元格 + 缩放），而是直接解析
// xl/drawings/drawingN.xml，还原：
//   - 两单元格锚点 + 单元格内偏移（from/to，px）、对象定位方式（随单元格改变位置和大小 /
//     只移动不调整大小 / 固定位置和大小）
//   - 旋转 / 翻转、裁剪 (a:srcRect)、几何形状 (prstGeom/custGeom)
//   - 边框 (a:ln)、效果（阴影/发光/柔化边缘/映像，含 Excel 的 a14:imgProps 写法）、
//     三维旋转与棱台、颜色校正（透明度/亮度/对比度/饱和度/灰度/双色调/设置透明色）
//   - 名称、可选文字、隐藏、锁定纵横比、随工作表锁定/打印
// 未在模型内的属性（自定义几何、渐变填充、渐变边框、其他效果等）以原始 XML 片段透传，
// 用户没有编辑对应属性时保存原样写回，保证 Excel 文件的保真度。

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"math"
	"path"
	"regexp"
	"strconv"
	"strings"
)

// emuPerPx：OOXML 的长度单位 EMU，1px（96dpi）= 9525 EMU。
const emuPerPx = 9525.0

// picPointJSON：单元格锚点 = 0 基列/行号 + 单元格内偏移（px）。
type picPointJSON struct {
	Col int     `json:"col"`
	Row int     `json:"row"`
	Dx  float64 `json:"dx"`
	Dy  float64 `json:"dy"`
}

// picSizeJSON：显示尺寸（px）。
type picSizeJSON struct {
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// picPosJSON：固定定位时的绝对位置（工作表坐标 px，原点 = A1 左上角）。
type picPosJSON struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// picCropJSON：裁剪比例（相对原图尺寸的分数，0~1）。
type picCropJSON struct {
	L float64 `json:"l"`
	T float64 `json:"t"`
	R float64 `json:"r"`
	B float64 `json:"b"`
}

// picColorJSON：颜色校正（对应「设置图片格式 → 图片」）。取值均为 -1~1 的偏移量，
// Transparency 为透明度 0~1，Duotone 为 [暗色, 亮色]，Transparent 为“设置透明色”的颜色。
type picColorJSON struct {
	Brightness   float64  `json:"brightness"`
	Contrast     float64  `json:"contrast"`
	Saturation   float64  `json:"saturation"`
	Transparency float64  `json:"transparency"`
	Grayscale    bool     `json:"grayscale"`
	Duotone      []string `json:"duotone,omitempty"`
	Transparent  string   `json:"transparent,omitempty"`
}

// picLineJSON：图片边框。W 为磅（pt），Dash 为 DrawingML prstDash 预设名。
type picLineJSON struct {
	Color string  `json:"color"`
	W     float64 `json:"w"`
	Dash  string  `json:"dash,omitempty"`
	Alpha float64 `json:"alpha"`
}

// picShadowJSON：阴影。Blur/Dist 为 px，Dir 为角度（顺时针，0 = 向右）。
type picShadowJSON struct {
	Kind  string  `json:"kind"` // outer | inner
	Blur  float64 `json:"blur"`
	Dist  float64 `json:"dist"`
	Dir   float64 `json:"dir"`
	Color string  `json:"color"`
	Alpha float64 `json:"alpha"`
}

// picGlowJSON：发光。Size 为 px。
type picGlowJSON struct {
	Size  float64 `json:"size"`
	Color string  `json:"color"`
	Alpha float64 `json:"alpha"`
}

// picBevelJSON：三维格式里的棱台（顶部）。W/H 为 px。
type picBevelJSON struct {
	Preset string  `json:"preset"`
	W      float64 `json:"w"`
	H      float64 `json:"h"`
}

// imageJSON 描述一张浮动图片（与前端 pictures.ts 的 SheetPictureJSON 对应）。
//
// 兼容字段 Row/Col/Width/Height 始终填充：Row/Col 取 from 锚点，Width/Height 为显示尺寸；
// 旧快照只给这四个字段时，写出按“锚定单元格 + 显示尺寸”还原两单元格锚点。
type imageJSON struct {
	Row    int    `json:"row"`
	Col    int    `json:"col"`
	Base64 string `json:"base64"`
	Ext    string `json:"ext"`
	Width  int    `json:"width"`
	Height int    `json:"height"`

	From *picPointJSON `json:"from,omitempty"`
	To   *picPointJSON `json:"to,omitempty"`
	// Mode：moveSize=随单元格改变位置和大小 / move=只移动不调整大小 / fixed=固定位置和大小
	Mode     string       `json:"mode,omitempty"`
	Size     *picSizeJSON `json:"size,omitempty"`
	Abs      *picPosJSON  `json:"abs,omitempty"`
	Rot      float64      `json:"rot,omitempty"`
	FlipH    bool         `json:"flipH,omitempty"`
	FlipV    bool         `json:"flipV,omitempty"`
	Crop     *picCropJSON `json:"crop,omitempty"`
	Geom     string       `json:"geom,omitempty"`
	Name     string       `json:"name,omitempty"`
	Alt      string       `json:"alt,omitempty"`
	// Locked/PrintObj 为 nil 时取 Excel 默认值（锁定、打印对象均为是）
	LockAspect bool  `json:"lockAspect,omitempty"`
	Hidden     bool  `json:"hidden,omitempty"`
	Locked     *bool `json:"locked,omitempty"`
	PrintObj   *bool `json:"print,omitempty"`

	// 外观
	Color       *picColorJSON  `json:"color,omitempty"`
	Ln          *picLineJSON   `json:"ln,omitempty"`
	Shadow      *picShadowJSON `json:"shadow,omitempty"`
	Glow        *picGlowJSON   `json:"glow,omitempty"`
	SoftEdge    float64        `json:"softEdge,omitempty"`
	Reflection  float64        `json:"reflection,omitempty"`
	Bevel       *picBevelJSON  `json:"bevel,omitempty"`
	StylePreset string         `json:"stylePreset,omitempty"`
	// 三维旋转：相机预设 + 旋转角（度）+ 视场角
	Cam      string  `json:"cam,omitempty"`
	CamLat   float64 `json:"camLat,omitempty"`
	CamLon   float64 `json:"camLon,omitempty"`
	CamRev   float64 `json:"camRev,omitempty"`
	CamFov   float64 `json:"camFov,omitempty"`
	LightRig string  `json:"lightRig,omitempty"`
	LightDir string  `json:"lightDir,omitempty"`

	// 编辑标记：对应属性被用户改过时，写出不再沿用原始 XML 片段
	GeomEdited  bool `json:"geomEdited,omitempty"`
	LnEdited    bool `json:"lnEdited,omitempty"`
	FxEdited    bool `json:"fxEdited,omitempty"`
	CropEdited  bool `json:"cropEdited,omitempty"`
	ColorEdited bool `json:"colorEdited,omitempty"`

	// 原始 XML 透传（读取时填充；Raw 为整段锚点，图片完全没动过时原样写回）
	Raw         string `json:"raw,omitempty"`
	RawGeom     string `json:"rawGeom,omitempty"`
	RawFill     string `json:"rawFill,omitempty"`
	RawLn       string `json:"rawLn,omitempty"`
	RawFx       string `json:"rawFx,omitempty"`
	RawScene    string `json:"rawScene,omitempty"`
	RawSpExt    string `json:"rawSpExt,omitempty"`
	RawPicExt   string `json:"rawPicExt,omitempty"`
	RawBlipFill string `json:"rawBlipFill,omitempty"`
	SrcRel      string `json:"srcRel,omitempty"`
	// SVG 矢量部件（Excel 插入 SVG 图标时 blip 指向 PNG 兜底图，svgBlip 指向矢量图）
	SVG    string `json:"svgB64,omitempty"`
	SVGRel string `json:"svgRel,omitempty"`
}

// ---------------------------------------------------------------------------
// 极简 XML 树：保留前缀与原始片段（RawToken 不做命名空间归一化，属性键保留 "r:embed" 形式）
// ---------------------------------------------------------------------------

type xmlNode struct {
	space string // 前缀（如 a / xdr / r）
	local string // 不含前缀的标签名
	attrs map[string]string
	kids  []*xmlNode
	text  string
	raw   string // 从起始标签到结束标签（含两端）的原始 XML
	inner string // 子节点的原始 XML
}

func (n *xmlNode) attr(name string) string {
	if n == nil {
		return ""
	}
	return n.attrs[name]
}

// kid 返回第一个指定局部名的直接子节点。
func (n *xmlNode) kid(local string) *xmlNode {
	if n == nil {
		return nil
	}
	for _, k := range n.kids {
		if k.local == local {
			return k
		}
	}
	return nil
}

// children 返回全部指定局部名的直接子节点。
func (n *xmlNode) children(local string) []*xmlNode {
	if n == nil {
		return nil
	}
	var out []*xmlNode
	for _, k := range n.kids {
		if k.local == local {
			out = append(out, k)
		}
	}
	return out
}

// desc 返回深度优先的第一个指定局部名后代节点。
func (n *xmlNode) desc(local string) *xmlNode {
	if n == nil {
		return nil
	}
	for _, k := range n.kids {
		if k.local == local {
			return k
		}
		if d := k.desc(local); d != nil {
			return d
		}
	}
	return nil
}

// parseXMLTree 把一段 XML 解析成 xmlNode 树；每个节点都带原始片段。
func parseXMLTree(data []byte) (*xmlNode, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	dec.Strict = false
	type frame struct {
		n         *xmlNode
		openStart int64
		innerStar int64
	}
	var (
		root  *xmlNode
		stack []frame
	)
	for {
		start := dec.InputOffset()
		tok, err := dec.RawToken()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			n := &xmlNode{space: t.Name.Space, local: t.Name.Local, attrs: make(map[string]string, len(t.Attr))}
			for _, a := range t.Attr {
				key := a.Name.Local
				if a.Name.Space != "" {
					key = a.Name.Space + ":" + a.Name.Local
				}
				n.attrs[key] = a.Value
			}
			if len(stack) > 0 {
				p := stack[len(stack)-1].n
				p.kids = append(p.kids, n)
			} else if root == nil {
				root = n
			}
			stack = append(stack, frame{n: n, openStart: start, innerStar: dec.InputOffset()})
		case xml.EndElement:
			if len(stack) == 0 {
				continue
			}
			fr := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			end := dec.InputOffset()
			// 自闭合标签：RawToken 紧接着补一个 EndElement，此时 start 已在标签之后，inner 为空
			fr.n.raw = string(data[fr.openStart:end])
			if start > fr.innerStar {
				fr.n.inner = string(data[fr.innerStar:start])
			}
		case xml.CharData:
			if len(stack) > 0 {
				stack[len(stack)-1].n.text += string(t)
			}
		}
	}
	return root, nil
}

func nodeInt(n *xmlNode) int64 {
	if n == nil {
		return 0
	}
	v, err := strconv.ParseInt(strings.TrimSpace(n.text), 10, 64)
	if err != nil {
		return 0
	}
	return v
}

// pct 解析 DrawingML 百分比：整数形式为十万分比（"25000" → 0.25），也接受 "25%"。
func pct(v string) float64 {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	if strings.HasSuffix(v, "%") {
		f, err := strconv.ParseFloat(strings.TrimSuffix(v, "%"), 64)
		if err != nil {
			return 0
		}
		return f / 100
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0
	}
	return f / 100000
}

// angle 解析 DrawingML 角度属性（60000 分之一度）为度。
func angle(v string) float64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil {
		return 0
	}
	return f / 60000
}

func parseBool(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true":
		return true
	}
	return false
}

// hex6 把颜色规范为 6 位大写十六进制（不带 #）。
func hex6(c string) string {
	c = strings.ToUpper(strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(c, "#"), "0x")))
	if len(c) == 8 {
		c = c[2:] // 丢弃 alpha 通道
	}
	if len(c) != 6 {
		return "000000"
	}
	return c
}

var presetColorNames = map[string]string{
	"BLACK": "000000", "WHITE": "FFFFFF", "RED": "FF0000", "GREEN": "008000", "BLUE": "0000FF",
	"YELLOW": "FFFF00", "ORANGE": "FFA500", "PURPLE": "800080", "GRAY": "808080", "GREY": "808080",
	"DARKGRAY": "A9A9A9", "DARKGREY": "A9A9A9", "LIGHTGRAY": "D3D3D3", "LIGHTGREY": "D3D3D3",
	"DARKRED": "8B0000", "DARKGREEN": "006400", "DARKBLUE": "00008B", "NAVY": "000080",
	"TEAL": "008080", "SILVER": "C0C0C0", "MAROON": "800000", "OLIVE": "808000", "LIME": "00FF00",
	"AQUA": "00FFFF", "CYAN": "00FFFF", "FUCHSIA": "FF00FF", "MAGENTA": "FF00FF", "BROWN": "A52A2A",
	"CRIMSON": "DC143C", "TOMATO": "FF6347", "CORAL": "FF7F50", "GOLD": "FFD700",
	"SKYBLUE": "87CEEB", "ROYALBLUE": "4169E1", "DODGERBLUE": "1E90FF", "INDIGO": "4B0082",
	"VIOLET": "EE82EE", "PINK": "FFC0CB", "HOTPINK": "FF69B4", "TAN": "D2B48C", "BEIGE": "F5F5DC",
	"IVORY": "FFFFF0", "KHAKI": "F0E68C", "LAVENDER": "E6E6FA", "TURQUOISE": "40E0D0",
}

// dmlColor 解析 DrawingML 颜色元素（srgbClr / prstClr / schemeClr / sysClr / scrgbClr
// 及其 alpha / shade / tint / lumMod / lumOff 修饰）为 #RRGGBB + 不透明度。
func (rd *picReader) dmlColor(n *xmlNode) (string, float64) {
	if n == nil {
		return "", 1
	}
	hex, alpha := "", 1.0
	switch n.local {
	case "srgbClr":
		hex = hex6(n.attr("val"))
	case "scrgbClr":
		hex = fmtScRGB(pct(n.attr("r")), pct(n.attr("g")), pct(n.attr("b")))
	case "prstClr":
		hex = presetColorNames[strings.ToUpper(n.attr("val"))]
		if hex == "" {
			hex = "000000"
		}
	case "schemeClr":
		slot := n.attr("val")
		switch slot {
		case "bg1":
			slot = "lt1"
		case "tx1":
			slot = "dk1"
		case "bg2":
			slot = "lt2"
		case "tx2":
			slot = "dk2"
		}
		if rd.theme != nil {
			if v, ok := rd.theme[slot]; ok {
				hex = hex6(v)
			}
		}
		if hex == "" {
			hex = "000000"
		}
	case "sysClr":
		hex = hex6(n.attr("lastClr"))
		if n.attr("lastClr") == "" {
			hex = "000000"
			if strings.EqualFold(n.attr("val"), "window") {
				hex = "FFFFFF"
			}
		}
	default:
		return "", 1
	}
	r, g, b := hexRGB(hex)
	for _, m := range n.kids {
		switch m.local {
		case "alpha":
			alpha = pct(m.attr("val"))
		case "shade":
			v := pct(m.attr("val"))
			r, g, b = int(float64(r)*v), int(float64(g)*v), int(float64(b)*v)
		case "tint":
			// 与样式色一致：正数向白色靠拢，负数向黑色靠拢
			r, g, b = hexRGB(applyTint(fmtRGB(r, g, b), pct(m.attr("val"))))
		case "lumMod", "lumOff":
			// 亮度修饰在 HSL 空间近似
			hh, ss, l, ok := hexToHsl(fmtRGB(r, g, b))
			if ok {
				if m.local == "lumMod" {
					l *= pct(m.attr("val"))
				} else {
					l += pct(m.attr("val"))
				}
				r, g, b = hexRGB(hslToHex(hh, ss, l))
			}
		}
	}
	return "#" + fmtRGB(r, g, b), alpha
}

func hexRGB(hex string) (int, int, int) {
	hex = hex6(hex)
	v, err := strconv.ParseUint(hex, 16, 32)
	if err != nil {
		return 0, 0, 0
	}
	return int(v>>16) & 0xFF, int(v>>8) & 0xFF, int(v) & 0xFF
}

func fmtScRGB(r, g, b float64) string {
	cl := func(v float64) int {
		x := int(math.Round(v * 255))
		if x < 0 {
			x = 0
		}
		if x > 255 {
			x = 255
		}
		return x
	}
	return fmtRGB(cl(r), cl(g), cl(b))
}

// ---------------------------------------------------------------------------
// zip / 关系部件辅助
// ---------------------------------------------------------------------------

type xmlRel struct {
	ID         string
	Type       string
	Target     string
	TargetMode string
}

type zipIndex struct {
	files      map[string]*zip.File
	sheetNames []string
	sheetParts []string
	relsCache  map[string][]xmlRel
}

func newZipIndex(zr *zip.Reader) *zipIndex {
	zi := &zipIndex{files: map[string]*zip.File{}, relsCache: map[string][]xmlRel{}}
	for _, zf := range zr.File {
		zi.files[normalizePart(zf.Name)] = zf
	}
	if data, ok := zi.read("xl/workbook.xml"); ok {
		if root, err := parseXMLTree(data); err == nil && root != nil {
			rels := zi.rels("xl/workbook.xml")
			if sh := root.kid("sheets"); sh != nil {
				for _, s := range sh.kids {
					if s.local != "sheet" {
						continue
					}
					zi.sheetNames = append(zi.sheetNames, s.attr("name"))
					part := ""
					rid := s.attr("r:id")
					for _, r := range rels {
						if r.ID == rid {
							part = resolvePart("xl/workbook.xml", r.Target)
						}
					}
					zi.sheetParts = append(zi.sheetParts, part)
				}
			}
		}
	}
	return zi
}

// part 返回工作表部件路径：优先按表名匹配，其次按工作簿里的顺序。
func (zi *zipIndex) part(sheetIdx int, name string) string {
	for i, n := range zi.sheetNames {
		if n == name && i < len(zi.sheetParts) {
			return zi.sheetParts[i]
		}
	}
	if sheetIdx >= 0 && sheetIdx < len(zi.sheetParts) {
		return zi.sheetParts[sheetIdx]
	}
	return ""
}

func (zi *zipIndex) read(part string) ([]byte, bool) {
	zf, ok := zi.files[normalizePart(part)]
	if !ok {
		return nil, false
	}
	rc, err := zf.Open()
	if err != nil {
		return nil, false
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		return nil, false
	}
	return data, true
}

// rels 读取某个部件的关系文件（xl/a/b.xml → xl/a/_rels/b.xml.rels）。
func (zi *zipIndex) rels(part string) []xmlRel {
	part = normalizePart(part)
	if v, ok := zi.relsCache[part]; ok {
		return v
	}
	var out []xmlRel
	dir, base := path.Split(part)
	if data, ok := zi.read(dir + "_rels/" + base + ".rels"); ok {
		if root, err := parseXMLTree(data); err == nil && root != nil {
			for _, k := range root.kids {
				if k.local != "Relationship" {
					continue
				}
				out = append(out, xmlRel{
					ID: k.attr("Id"), Type: k.attr("Type"), Target: k.attr("Target"), TargetMode: k.attr("TargetMode"),
				})
			}
		}
	}
	zi.relsCache[part] = out
	return out
}

func normalizePart(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	for strings.HasPrefix(p, "/") {
		p = p[1:]
	}
	return path.Clean(p)
}

// resolvePart 按 OPC 规则把关系 Target 解析为包内绝对路径（以 "/" 开头的为绝对路径）。
func resolvePart(basePart, target string) string {
	if strings.Contains(target, "://") {
		return target
	}
	if strings.HasPrefix(target, "/") {
		return normalizePart(target)
	}
	dir, _ := path.Split(normalizePart(basePart))
	return path.Clean(dir + target)
}

var (
	reImageExt = regexp.MustCompile(`(?i)\.(png|jpe?g|gif|bmp|tiff?|svg|emf|emz|wmf|wmz|ico|webp)$`)
	reSVGBlip  = regexp.MustCompile(`(?s)<a:ext uri="\{96DAC541-7B7A-43D3-8B79-37D633B846F1\}">.*?</a:ext>`)
	reHlink    = regexp.MustCompile(`(?s)<a:hlink(?:Click|Hover)\b[^>]*?/>|<a:hlink(?:Click|Hover)\b[^>]*?>.*?</a:hlink(?:Click|Hover)>`)
	reRelAttr  = regexp.MustCompile(`\br:(?:id|embed|link)="([^"]*)"`)
)

func mediaExt(part string, raw []byte) string {
	ext := ""
	if m := reImageExt.FindStringSubmatch(part); m != nil {
		ext = strings.ToLower(m[1])
	}
	if ext == "" && len(raw) > 0 {
		switch {
		case bytes.HasPrefix(raw, []byte("\x89PNG")):
			ext = "png"
		case bytes.HasPrefix(raw, []byte("\xFF\xD8")):
			ext = "jpeg"
		case bytes.HasPrefix(raw, []byte("GIF8")):
			ext = "gif"
		case bytes.HasPrefix(raw, []byte("BM")) && len(raw) > 6:
			ext = "bmp"
		case bytes.HasPrefix(raw, []byte("II*\x00")) || bytes.HasPrefix(raw, []byte("MM\x00*")):
			ext = "tiff"
		case bytes.HasPrefix(raw, []byte("<svg")) || bytes.Contains(bytes.ToLower(raw[:min(len(raw), 512)]), []byte("<svg")):
			ext = "svg"
		}
	}
	switch ext {
	case "jpg":
		ext = "jpeg"
	case "tif":
		ext = "tiff"
	}
	return ext
}
