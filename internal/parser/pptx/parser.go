// Package pptx 实现 OOXML .pptx 演示文稿格式的自研解析器
// 结构：
//
//      ppt/presentation.xml   ← 主文件，定义幻灯片顺序
//      ppt/slides/slide1.xml  ← 每张幻灯片
//      ppt/slides/_rels/slideN.xml.rels ← 幻灯片内资源（图片 rId→media）
//      ppt/media/             ← 嵌入的图片字节
//      ppt/slideLayouts/      ← 布局
//      ppt/slideMasters/      ← 母版（含主题色映射 clrMap 与文本样式 txStyles）
//      ppt/theme/theme1.xml   ← 主题配色（accent1-6/dk/lt 等）
//
// 样式支持：srgbClr / schemeClr（主题色+色彩变换 lumMod/lumOff/shade/tint）/
// sysClr / 渐变首停 / 逐段落逐 run（颜色/字号/加粗/斜体/下划线/字体）/
// 占位符字号与颜色继承（母版 txStyles）/ 形状填充与几何预设 / 幻灯片背景
// （slide 自身 bg → 版式 bg → 母版 bg 逐级回退）
//
// 容错策略：与 docx 解析器一致
package pptx

import (
        "archive/zip"
        "bytes"
        "encoding/base64"
        "encoding/xml"
        "fmt"
        "io"
        "sort"
        "strconv"
        "strings"

        "github.com/zai/samoffice/internal/core"
)

type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".pptx"} }

func (p *Parser) CanParse(path string, header []byte) bool {
        return strings.HasSuffix(strings.ToLower(path), ".pptx")
}

// ---------- 样式数据结构（导出给前端的 JSON 形态） ----------

// runDef 单个文本 run 的样式
type runDef struct {
        Text      string `json:"text,omitempty"`
        Color     string `json:"color,omitempty"`  // #RRGGBB
        SizePt    int    `json:"sizePt,omitempty"` // 磅
        Bold      bool   `json:"bold,omitempty"`
        Italic    bool   `json:"italic,omitempty"`
        Underline bool   `json:"underline,omitempty"`
        Font      string `json:"font,omitempty"` // 字体族（latin）
}

// paraDef 单个段落：对齐 + 多 run
type paraDef struct {
        Align string   `json:"align,omitempty"` // l|c|r
        Runs  []runDef `json:"runs"`
}

// shapeDef 描述单个形状（文本/矩形/图片），几何单位均为 EMU
type shapeDef struct {
        Kind      string    `json:"kind"` // text | rect | pic
        X         int64     `json:"x"`
        Y         int64     `json:"y"`
        Cx        int64     `json:"cx"`
        Cy        int64     `json:"cy"`
        Fill      string    `json:"fill,omitempty"`   // 填充色 #RRGGBB
        Text      string    `json:"text,omitempty"`   // 兼容字段：全部段落文字（\n 分隔）
        Color     string    `json:"color,omitempty"`  // 兼容字段：首个 run 颜色
        SizePt    int       `json:"sizePt,omitempty"` // 兼容字段：首个 run 字号
        Bold      bool      `json:"bold,omitempty"`   // 兼容字段：首个 run 加粗
        Italic    bool      `json:"italic,omitempty"` // 兼容字段：首个 run 斜体
        Underline bool      `json:"underline,omitempty"`
        Font      string    `json:"font,omitempty"`      // 兼容字段：首个 run 字体
        Align     string    `json:"align,omitempty"`     // 兼容字段：首段对齐 l|c|r
        Vanchor   string    `json:"vanchor,omitempty"`   // t|ctr|b
        Geom      string    `json:"geom,omitempty"`      // prstGeom 预设几何（rect/ellipse/roundRect/...）
        Ph        string    `json:"ph,omitempty"`        // 占位符类型（title/ctrTitle/subTitle/body/...）
        LineColor string    `json:"lineColor,omitempty"` // 边框色（a:ln solidFill）
        LineWpt   int       `json:"lineWpt,omitempty"`   // 边框宽（磅）
        Gradient   string  `json:"gradient,omitempty"`   // 渐变 "RRGGBB,RRGGBB"（无 #，取前两个停止色）
        Shadow     bool    `json:"shadow,omitempty"`     // 外阴影（a:outerShdw）
        Glow       bool    `json:"glow,omitempty"`       // 发光（a:glow）
        GlowColor  string  `json:"glowColor,omitempty"`  // 发光色 #RRGGBB
        Rotation   float64 `json:"rotation,omitempty"`   // 旋转角度（度，xfrm rot/60000）
        Bullet     bool    `json:"bullet,omitempty"`     // 项目符号（a:buChar）
        Numbered   bool    `json:"numbered,omitempty"`   // 编号列表（a:buAutoNum）
        LineHeight float64 `json:"lineHeight,omitempty"` // 行距倍数（a:lnSpc spcPct/100000）
        Indent     int     `json:"indent,omitempty"`     // 缩进层级（由 marL/285750-1 推断）
        Link       string  `json:"link,omitempty"`       // 超链接目标（a:hlinkClick 的 rel Target）
        Paras     []paraDef `json:"paras,omitempty"`     // 逐段落逐 run 的完整样式
        Img       string    `json:"img,omitempty"`       // 图片 data URL
}

type slideContent struct {
        Title      string
        Bullets    []string
        Notes      string
        Bg         string
        Transition string // 切换效果：fade/push/wipe/cover/cut/zoom/morph
        Shapes     []shapeDef
}

// ---------- 主题与母版 ----------

// themeScheme 主题配色表（accent1 → RRGGBB，无 #）
type themeScheme map[string]string

// masterExtras 母版信息：颜色映射 + 文本样式默认值 + 母版背景
type masterExtras struct {
        clrMap   map[string]string // bg1→lt1 等
        txStyles map[string]runDef // title/body/other → lvl1 默认样式
}

// phXfrm 占位符几何 [x,y,cx,cy]（EMU）
type phXfrm [4]int64

// parsePlaceholderXfrms 解析版式/母版里各占位符的几何，
// 以 "t:类型" / "i:idx" / "b:类型|idx" 三种键存入，便于继承匹配
func parsePlaceholderXfrms(files map[string]*zip.File, path string) map[string]phXfrm {
        out := map[string]phXfrm{}
        f, ok := files[path]
        if !ok {
                return out
        }
        rc, err := f.Open()
        if err != nil {
                return out
        }
        defer rc.Close()
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        var inSp bool
        var phType, phIdx string
        var xf phXfrm
        var sawOff, sawExt bool
        for {
                tok, err := dec.Token()
                if err != nil {
                        break
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        switch t.Name.Local {
                        case "sp":
                                inSp = true
                                phType, phIdx = "", ""
                                sawOff, sawExt = false, false
                                xf = phXfrm{}
                        case "ph":
                                if inSp {
                                        phType = attrVal(t, "type")
                                        phIdx = attrVal(t, "idx")
                                }
                        case "off":
                                if inSp {
                                        for _, a := range t.Attr {
                                                switch a.Name.Local {
                                                case "x":
                                                        xf[0] = atoi64(a.Value)
                                                case "y":
                                                        xf[1] = atoi64(a.Value)
                                                }
                                        }
                                        sawOff = true
                                }
                        case "ext":
                                if inSp {
                                        for _, a := range t.Attr {
                                                switch a.Name.Local {
                                                case "cx":
                                                        xf[2] = atoi64(a.Value)
                                                case "cy":
                                                        xf[3] = atoi64(a.Value)
                                                }
                                        }
                                        sawExt = true
                                }
                        }
                case xml.EndElement:
                        if t.Name.Local == "sp" {
                                if inSp && sawOff && sawExt && (phType != "" || phIdx != "") {
                                        if phType != "" {
                                                out["t:"+phType] = xf
                                                if phIdx != "" {
                                                        out["b:"+phType+"|"+phIdx] = xf
                                                }
                                        }
                                        if phIdx != "" {
                                                out["i:"+phIdx] = xf
                                        }
                                }
                                inSp = false
                        }
                }
        }
        return out
}

// lookupPhXfrm 按 类型+idx → 类型 → 等价类型（ctrTitle→title 等）→ idx 的顺序，
// 先版式后母版地查找占位符几何
func lookupPhXfrm(layout, master map[string]phXfrm, ph, idx string) (phXfrm, bool) {
        altType := ph
        switch ph {
        case "ctrTitle":
                altType = "title"
        case "subTitle":
                altType = "body"
        }
        keys := make([]string, 0, 4)
        if ph != "" && idx != "" {
                keys = append(keys, "b:"+ph+"|"+idx)
        }
        if ph != "" {
                keys = append(keys, "t:"+ph)
                if altType != ph {
                        keys = append(keys, "t:"+altType)
                }
        }
        if idx != "" {
                keys = append(keys, "i:"+idx)
        }
        for _, m := range []map[string]phXfrm{layout, master} {
                for _, k := range keys {
                        if xf, ok := m[k]; ok {
                                return xf, true
                        }
                }
        }
        return phXfrm{}, false
}

// defaultClrMap 标准 Office 颜色映射
func defaultClrMap() map[string]string {
        return map[string]string{
                "bg1": "lt1", "tx1": "dk1", "bg2": "lt2", "tx2": "dk2",
                "accent1": "accent1", "accent2": "accent2", "accent3": "accent3",
                "accent4": "accent4", "accent5": "accent5", "accent6": "accent6",
                "hlink": "hlink", "folHlink": "folHlink",
                "phClr": "phClr",
        }
}

// findThemePath 找第一个主题文件
func findThemePath(files map[string]*zip.File) string {
        names := make([]string, 0, 4)
        for name := range files {
                if strings.HasPrefix(name, "ppt/theme/theme") && strings.HasSuffix(name, ".xml") {
                        names = append(names, name)
                }
        }
        sort.Strings(names)
        if len(names) > 0 {
                return names[0]
        }
        return ""
}

// parseTheme 解析 theme1.xml 的 clrScheme
func parseTheme(files map[string]*zip.File) themeScheme {
        scheme := themeScheme{}
        tp := findThemePath(files)
        if tp == "" {
                return scheme
        }
        f, ok := files[tp]
        if !ok {
                return scheme
        }
        rc, err := f.Open()
        if err != nil {
                return scheme
        }
        defer rc.Close()
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        inScheme := false
        depth := 0
        var curKey string
        for {
                tok, err := dec.Token()
                if err != nil {
                        break
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        switch t.Name.Local {
                        case "clrScheme":
                                inScheme = true
                                depth = 0
                                continue
                        case "srgbClr":
                                if inScheme && depth == 1 && curKey != "" {
                                        scheme[curKey] = strings.ToUpper(attrVal(t, "val"))
                                }
                        case "sysClr":
                                if inScheme && depth == 1 && curKey != "" {
                                        if last := attrVal(t, "lastClr"); last != "" {
                                                scheme[curKey] = strings.ToUpper(last)
                                        } else {
                                                switch attrVal(t, "val") {
                                                case "window":
                                                        scheme[curKey] = "FFFFFF"
                                                default:
                                                        scheme[curKey] = "000000"
                                                }
                                        }
                                }
                        }
                        if inScheme && t.Name.Local != "clrScheme" {
                                depth++
                        }
                        // 记录色槽名（dk1/lt1/accent1 等）
                        if inScheme && depth == 1 {
                                switch t.Name.Local {
                                case "dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3",
                                        "accent4", "accent5", "accent6", "hlink", "folHlink":
                                        curKey = t.Name.Local
                                }
                        }
                case xml.EndElement:
                        if t.Name.Local == "clrScheme" {
                                inScheme = false
                                continue
                        }
                        if inScheme && depth > 0 {
                                depth--
                        }
                }
        }
        return scheme
}

// parseMasterExtras 解析母版的 clrMap 与 txStyles（title/body/other 的 lvl1 默认样式）
func parseMasterExtras(files map[string]*zip.File, masterPath string) *masterExtras {
        me := &masterExtras{clrMap: defaultClrMap(), txStyles: map[string]runDef{}}
        f, ok := files[masterPath]
        if !ok {
                return me
        }
        rc, err := f.Open()
        if err != nil {
                return me
        }
        defer rc.Close()
        dec := xml.NewDecoder(rc)
        dec.Strict = false

        var curStyle string // title/body/other
        var inLvl1 bool     // 当前在 lvl1pPr 内
        var inDefRPr bool   // 当前在 defRPr 内
        curDef := runDef{}
        for {
                tok, err := dec.Token()
                if err != nil {
                        break
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        switch t.Name.Local {
                        case "clrMap":
                                for _, a := range t.Attr {
                                        me.clrMap[a.Name.Local] = a.Value
                                }
                        case "titleStyle":
                                curStyle = "title"
                        case "bodyStyle":
                                curStyle = "body"
                        case "otherStyle":
                                curStyle = "other"
                        case "lvl1pPr":
                                if curStyle != "" {
                                        inLvl1 = true
                                }
                        case "defRPr":
                                if inLvl1 {
                                        inDefRPr = true
                                        curDef = runDef{}
                                        for _, a := range t.Attr {
                                                switch a.Name.Local {
                                                case "sz":
                                                        curDef.SizePt = atoi(a.Value) / 100
                                                case "b":
                                                        curDef.Bold = a.Value == "1" || a.Value == "true"
                                                case "i":
                                                        curDef.Italic = a.Value == "1" || a.Value == "true"
                                                }
                                        }
                                }
                        case "srgbClr":
                                if inDefRPr {
                                        curDef.Color = "#" + strings.ToUpper(attrVal(t, "val"))
                                }
                        case "sysClr":
                                if inDefRPr {
                                        curDef.Color = "#" + sysColorHex(t)
                                }
                        }
                case xml.EndElement:
                        switch t.Name.Local {
                        case "lvl1pPr":
                                if inLvl1 && curStyle != "" {
                                        me.txStyles[curStyle] = curDef
                                }
                                inLvl1 = false
                                inDefRPr = false
                                curStyle = ""
                        case "defRPr":
                                inDefRPr = false
                        }
                }
        }
        return me
}

// parseBgColor 从指定 XML（slide/layout/master）中提取 <p:bg> 的纯色/渐变首停背景色，
// 返回 "#RRGGBB"（无背景时为空）。schemeClr 通过 theme/clrMap 解析。
func parseBgColor(files map[string]*zip.File, path string, theme themeScheme, clrMap map[string]string) string {
        f, ok := files[path]
        if !ok {
                return ""
        }
        rc, err := f.Open()
        if err != nil {
                return ""
        }
        defer rc.Close()
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        inBg := false
        inBgPr := false
        for {
                tok, err := dec.Token()
                if err != nil {
                        return ""
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        switch t.Name.Local {
                        case "bg":
                                inBg = true
                        case "bgPr":
                                if inBg {
                                        inBgPr = true
                                }
                        case "bgRef":
                                if inBg {
                                        // <p:bgRef idx="1000"><a:schemeClr val="accent1"/></p:bgRef>
                                }
                        case "srgbClr":
                                if inBgPr {
                                        return "#" + strings.ToUpper(attrVal(t, "val"))
                                }
                        case "sysClr":
                                if inBgPr {
                                        return "#" + sysColorHex(t)
                                }
                        case "schemeClr":
                                if inBgPr {
                                        return "#" + resolveScheme(theme, clrMap, attrVal(t, "val"))
                                }
                        }
                case xml.EndElement:
                        switch t.Name.Local {
                        case "bg":
                                return ""
                        case "bgPr":
                                inBgPr = false
                        }
                }
        }
}

// relsOfType 在 rels 文件里找第一个 Type 以 suffix 结尾的关系的 Target
func relsOfType(files map[string]*zip.File, relsPath, typeSuffix string) string {
        f, ok := files[relsPath]
        if !ok {
                return ""
        }
        rc, err := f.Open()
        if err != nil {
                return ""
        }
        defer rc.Close()
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        for {
                tok, err := dec.Token()
                if err != nil {
                        return ""
                }
                if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "Relationship" {
                        ty, target := "", ""
                        for _, a := range se.Attr {
                                switch a.Name.Local {
                                case "Type":
                                        ty = a.Value
                                case "Target":
                                        target = a.Value
                                }
                        }
                        if strings.HasSuffix(ty, typeSuffix) && target != "" {
                                return resolveRelPath(relsPath, target)
                        }
                }
        }
}

// resolveRelPath 把 rels 的相对 Target 解析为包内路径
func resolveRelPath(relsPath, target string) string {
        base := relsPath // ppt/slides/_rels/slide1.xml.rels
        if i := strings.Index(base, "/_rels/"); i >= 0 {
                base = base[:i] // ppt/slides
        } else {
                base = ""
        }
        parts := strings.Split(strings.TrimPrefix(target, "/"), "/")
        var stack []string
        for _, p := range parts {
                switch p {
                case "", ".":
                case "..":
                        if len(stack) > 0 {
                                stack = stack[:len(stack)-1]
                        }
                default:
                        stack = append(stack, p)
                }
        }
        if len(stack) == 0 {
                return ""
        }
        if strings.HasPrefix(target, "/") {
                return strings.Join(stack, "/")
        }
        // 相对于 base 目录解析
        baseParts := strings.Split(base, "/")
        return strings.Join(append(baseParts, stack...), "/")
}

// ---------- 颜色解析 ----------

func attrVal(se xml.StartElement, local string) string {
        for _, a := range se.Attr {
                if a.Name.Local == local {
                        return a.Value
                }
        }
        return ""
}

func sysColorHex(se xml.StartElement) string {
        if last := attrVal(se, "lastClr"); last != "" {
                return strings.ToUpper(last)
        }
        switch attrVal(se, "val") {
        case "window":
                return "FFFFFF"
        default:
                return "000000"
        }
}

// resolveScheme 把 schemeClr 的 val（可能是 bg1/tx1 等映射名）解析为 RRGGBB
func resolveScheme(theme themeScheme, clrMap map[string]string, val string) string {
        if clrMap != nil {
                if mapped, ok := clrMap[val]; ok {
                        val = mapped
                }
        }
        if c, ok := theme[val]; ok && c != "" {
                return c
        }
        switch val {
        case "dk1", "tx1":
                return "000000"
        case "lt1", "bg1":
                return "FFFFFF"
        case "dk2", "tx2":
                return "44546A"
        case "lt2", "bg2":
                return "E7E6E6"
        case "accent1":
                return "4472C4"
        case "accent2":
                return "ED7D31"
        case "accent3":
                return "A5A5A5"
        case "accent4":
                return "FFC000"
        case "accent5":
                return "5B9BD5"
        case "accent6":
                return "70AD47"
        case "hlink":
                return "0563C1"
        case "folHlink":
                return "954F72"
        }
        return ""
}

// hexToHsl / hslToHex：色彩变换用
func hexToHsl(hex string) (h, s, l float64, ok bool) {
        hex = strings.TrimPrefix(hex, "#")
        if len(hex) == 3 {
                hex = string([]byte{hex[0], hex[0], hex[1], hex[1], hex[2], hex[2]})
        }
        if len(hex) != 6 {
                return 0, 0, 0, false
        }
        v, err := strconv.ParseUint(hex, 16, 32)
        if err != nil {
                return 0, 0, 0, false
        }
        r := float64((v>>16)&0xFF) / 255
        g := float64((v>>8)&0xFF) / 255
        b := float64(v&0xFF) / 255
        max, min := r, r
        if g > max {
                max = g
        }
        if b > max {
                max = b
        }
        if g < min {
                min = g
        }
        if b < min {
                min = b
        }
        l = (max + min) / 2
        if max == min {
                return 0, 0, l, true
        }
        d := max - min
        if l > 0.5 {
                s = d / (2 - max - min)
        } else {
                s = d / (max + min)
        }
        switch max {
        case r:
                h = (g - b) / d
                if g < b {
                        h += 6
                }
        case g:
                h = (b-r)/d + 2
        default:
                h = (r-g)/d + 4
        }
        h /= 6
        return h, s, l, true
}

func hslToHex(h, s, l float64) string {
        clamp := func(v float64) float64 {
                if v < 0 {
                        return 0
                }
                if v > 1 {
                        return 1
                }
                return v
        }
        h = clamp(h)
        s = clamp(s)
        l = clamp(l)
        var r, g, b float64
        if s == 0 {
                r, g, b = l, l, l
        } else {
                q := l
                if q > 0.5 {
                        q = 1 - l
                }
                q = l + q*s
                p := 2*l - q
                f := func(t float64) float64 {
                        if t < 0 {
                                t++
                        }
                        if t > 1 {
                                t--
                        }
                        switch {
                        case t < 1.0/6.0:
                                return p + (q-p)*6*t
                        case t < 0.5:
                                return q
                        case t < 2.0/3.0:
                                return p + (q-p)*(2.0/3.0-t)*6
                        default:
                                return p
                        }
                }
                r, g, b = f(h+1.0/3.0), f(h), f(h-1.0/3.0)
        }
        to := func(v float64) int { return int(clamp(v)*255 + 0.5) }
        return fmt.Sprintf("%02X%02X%02X", to(r), to(g), to(b))
}

// applyColorTransforms 处理 lumMod/lumOff/shade/tint（Office 常见的明暗变体）
func applyColorTransforms(hex string, lumMod, lumOff, shade, tint float64) string {
        h, s, l, ok := hexToHsl(hex)
        if !ok {
                return strings.TrimPrefix(hex, "#")
        }
        if shade > 0 {
                l *= shade
        }
        if tint > 0 {
                l += (1 - l) * tint
        }
        if lumMod > 0 {
                l *= lumMod
        }
        if lumOff > 0 {
                l += lumOff
        }
        return hslToHex(h, s, l)
}

// readColorElement 读取一个颜色元素（srgbClr/schemeClr/sysClr）直到其结束，
// 解析 val 与子变换，返回 "#RRGGBB"。theme/clrMap 可为 nil。
func readColorElement(dec *xml.Decoder, start xml.StartElement, theme themeScheme, clrMap map[string]string) string {
        var base string
        var lumMod, lumOff, shade, tint float64
        switch start.Name.Local {
        case "srgbClr":
                base = strings.ToUpper(attrVal(start, "val"))
        case "sysClr":
                base = sysColorHex(start)
        case "schemeClr":
                base = resolveScheme(theme, clrMap, attrVal(start, "val"))
        case "prstClr":
                base = resolveScheme(theme, nil, attrVal(start, "val"))
        }
        depth := 1
        for depth > 0 {
                tok, err := dec.Token()
                if err != nil {
                        break
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        depth++
                        switch t.Name.Local {
                        case "lumMod":
                                if f, e := strconv.ParseFloat("0."+strings.TrimSuffix(attrVal(t, "val"), "000"), 64); e == nil {
                                        // val 为千分比字符串（如 "40000" → 0.4）
                                        if v, e2 := strconv.Atoi(attrVal(t, "val")); e2 == nil {
                                                lumMod = float64(v) / 100000
                                        } else {
                                                _ = f
                                        }
                                }
                        case "lumOff":
                                if v, e := strconv.Atoi(attrVal(t, "val")); e == nil {
                                        lumOff = float64(v) / 100000
                                }
                        case "shade":
                                if v, e := strconv.Atoi(attrVal(t, "val")); e == nil {
                                        shade = float64(v) / 100000
                                }
                        case "tint":
                                if v, e := strconv.Atoi(attrVal(t, "val")); e == nil {
                                        tint = float64(v) / 100000
                                }
                        }
                case xml.EndElement:
                        depth--
                }
        }
        if base == "" {
                return ""
        }
        base = strings.TrimPrefix(base, "#")
        if lumMod > 0 || lumOff > 0 || shade > 0 || tint > 0 {
                base = applyColorTransforms(base, lumMod, lumOff, shade, tint)
        }
        return "#" + strings.ToUpper(base)
}

// ---------- 解析入口 ----------

// Parse 解析 pptx 为 UDM
// 每张幻灯片转换为一个 RawBlock（kind="slide"），
// 包含 title、bullets、notes 以及完整的 shapes（文本/矩形/图片几何体，含逐段样式），
// 以便前端真正渲染幻灯片版面。
func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
        warnings := []core.Warning{}

        data, err := io.ReadAll(r)
        if err != nil {
                return nil, warnings, fmt.Errorf("read pptx: %w", err)
        }

        zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
        if err != nil {
                return nil, warnings, fmt.Errorf("open zip: %w", err)
        }

        files := make(map[string]*zip.File)
        for _, f := range zr.File {
                files[f.Name] = f
        }

        // 收集所有 slide 文件，按编号排序
        var slideNames []string
        for name := range files {
                if strings.HasPrefix(name, "ppt/slides/slide") && strings.HasSuffix(name, ".xml") {
                        slideNames = append(slideNames, name)
                }
        }
        sort.Slice(slideNames, func(i, j int) bool {
                return extractSlideNum(slideNames[i]) < extractSlideNum(slideNames[j])
        })

        // 幻灯片页面尺寸（EMU），默认 16:9
        pageWEMU, pageHEMU := int64(12192000), int64(6858000)
        if pf, ok := files["ppt/presentation.xml"]; ok {
                if prc, e := pf.Open(); e == nil {
                        pageWEMU, pageHEMU = parsePresentationSize(prc)
                        prc.Close()
                }
        }

        if len(slideNames) == 0 {
                return nil, warnings, fmt.Errorf("no slides found in pptx")
        }

        doc := &core.Document{
                Meta:   core.Meta{Title: "Presentation"},
                Blocks: []core.Block{},
        }

        // 提取元数据
        if coreFile, ok := files["docProps/core.xml"]; ok {
                if rc, err := coreFile.Open(); err == nil {
                        parseCoreProps(rc, &doc.Meta)
                        rc.Close()
                }
        }

        // 主题 + 母版（全局解析一次）
        theme := parseTheme(files)
        var master *masterExtras
        var masterBg string
        {
                masterPath := ""
                for name := range files {
                        if strings.HasPrefix(name, "ppt/slideMasters/slideMaster") && strings.HasSuffix(name, ".xml") {
                                if masterPath == "" || name < masterPath {
                                        masterPath = name
                                }
                        }
                }
                if masterPath != "" {
                        master = parseMasterExtras(files, masterPath)
                        masterBg = parseBgColor(files, masterPath, theme, master.clrMap)
                } else {
                        master = &masterExtras{clrMap: defaultClrMap(), txStyles: map[string]runDef{}}
                }
        }

        // 解析每张幻灯片
        for _, slideName := range slideNames {
                f := files[slideName]
                rc, err := f.Open()
                if err != nil {
                        warnings = append(warnings, core.Warning{
                                Level: "warn", Stage: "unzip",
                                Message: fmt.Sprintf("open %s: %v", slideName, err),
                        })
                        continue
                }
                relsName := slideRelsName(slideName)
                var rels map[string]string
                if rf, ok := files[relsName]; ok {
                        if rrc, e := rf.Open(); e == nil {
                                rels = parseRels(rrc)
                                rrc.Close()
                        }
                }

                // 版式背景（幻灯片未设背景时回退）+ 版式/母版占位符几何
                layoutBg := ""
                layoutPh := map[string]phXfrm{}
                if layoutPath := relsOfType(files, relsName, "slideLayout"); layoutPath != "" {
                        layoutBg = parseBgColor(files, layoutPath, theme, master.clrMap)
                        layoutPh = parsePlaceholderXfrms(files, layoutPath)
                }
                masterPh := map[string]phXfrm{}
                for nm := range files {
                        if strings.HasPrefix(nm, "ppt/slideMasters/slideMaster") && strings.HasSuffix(nm, ".xml") {
                                for k, v := range parsePlaceholderXfrms(files, nm) {
                                        if _, dup := masterPh[k]; !dup {
                                                masterPh[k] = v
                                        }
                                }
                        }
                }

                slide := parseSlide(rc, slideName, files, rels, theme, master, layoutPh, masterPh)
                rc.Close()

                // 背景逐级回退：slide 自身 → 版式 → 母版
                if slide.Bg == "" {
                        slide.Bg = layoutBg
                }
                if slide.Bg == "" {
                        slide.Bg = masterBg
                }

                // 幻灯片标题作为 Heading，正文作为段落列表（供大纲视图使用）
                if slide.Title != "" {
                        doc.Blocks = append(doc.Blocks, &core.Heading{
                                Level:  2,
                                Inline: []core.Inline{core.Text{Content: slide.Title, Bold: true}},
                        })
                }
                for _, b := range slide.Bullets {
                        doc.Blocks = append(doc.Blocks, &core.BulletList{
                                Items: [][]core.Block{{
                                        &core.Paragraph{Inline: []core.Inline{core.Text{Content: b}}},
                                }},
                                Ordered: false,
                        })
                }
                // 保存原始信息到 RawBlock（含完整 shapes）
                doc.Blocks = append(doc.Blocks, &core.RawBlock{
                        Kind: "slide",
                        Data: map[string]any{
                                "slideNum":  extractSlideNum(slideName),
                                "slideName": slideName,
                                "title":     slide.Title,
                                "bullets":   slide.Bullets,
                                "notes":     slide.Notes,
                                "bg":        slide.Bg,
                                "transition": slide.Transition,
                                "shapes":    slide.Shapes,
                                "pageW":     pageWEMU,
                                "pageH":     pageHEMU,
                        },
                })
        }

        return doc, warnings, nil
}

// slideRelsName 由 ppt/slides/slideN.xml 得到 ppt/slides/_rels/slideN.xml.rels
func slideRelsName(slideName string) string {
        base := slideName
        if i := strings.LastIndex(base, "/"); i >= 0 {
                dir := base[:i]
                file := base[i+1:]
                return dir + "/_rels/" + file + ".rels"
        }
        return "_rels/" + base + ".rels"
}

// parsePresentationSize 读取 ppt/presentation.xml 的 <p:sldSz cx cy/>（EMU）。
// 默认返回 16:9 (12192000 x 6858000)。
func parsePresentationSize(r io.Reader) (int64, int64) {
        w, h := int64(12192000), int64(6858000)
        dec := xml.NewDecoder(r)
        dec.Strict = false
        for {
                tok, err := dec.Token()
                if err != nil {
                        break
                }
                t, ok := tok.(xml.StartElement)
                if !ok {
                        continue
                }
                if t.Name.Local == "sldSz" {
                        for _, a := range t.Attr {
                                switch a.Name.Local {
                                case "cx":
                                        w = atoi64(a.Value)
                                case "cy":
                                        h = atoi64(a.Value)
                                }
                        }
                        break
                }
        }
        return w, h
}

// parseRels 解析 .rels 文件，返回 rId -> Target
func parseRels(r io.Reader) map[string]string {
        out := map[string]string{}
        dec := xml.NewDecoder(r)
        dec.Strict = false
        for {
                tok, err := dec.Token()
                if err != nil {
                        return out
                }
                if se, ok := tok.(xml.StartElement); ok && se.Name.Local == "Relationship" {
                        var id, target string
                        for _, a := range se.Attr {
                                switch a.Name.Local {
                                case "Id":
                                        id = a.Value
                                case "Target":
                                        target = a.Value
                                }
                        }
                        if id != "" && target != "" {
                                out[id] = target
                        }
                }
        }
}

// ---------- 幻灯片状态机 ----------

// slideParseCtx 单张幻灯片的解析上下文
type slideParseCtx struct {
        theme    themeScheme
        clrMap   map[string]string
        txStyles map[string]runDef
        layoutPh map[string]phXfrm // 版式占位符几何
        masterPh map[string]phXfrm // 母版占位符几何
}

// parseSlide 解析单张幻灯片 XML，提取形状（文本/矩形/图片），含完整段落样式
func parseSlide(r io.Reader, name string, files map[string]*zip.File, rels map[string]string,
        theme themeScheme, master *masterExtras, layoutPh, masterPh map[string]phXfrm) *slideContent {

        slide := &slideContent{}
        dec := xml.NewDecoder(r)
        dec.Strict = false

        ctx := &slideParseCtx{
                theme:    theme,
                clrMap:   master.clrMap,
                txStyles: master.txStyles,
                layoutPh: layoutPh,
                masterPh: masterPh,
        }

        var shapes []shapeDef
        var cur *shapeDef
        var curBlipRID string
        var sawOff, sawExt bool // 当前形状是否自带完整 xfrm（占位符可继承版式/母版）
        var curPhIdx string     // 当前占位符 idx

        // 文本形状累积状态
        var paras []paraDef  // 当前形状的所有段落
        var curPara *paraDef // 当前段落
        var curRun *runDef   // 当前 run

        // 形状级默认样式（txBody/lstStyle/lvl1pPr/defRPr）
        var shapeDefault runDef
        var inLstLvl1 bool
        var inShapeDefRPr bool

        // 上下文标志
        var inTxBody, inPara, inRun, inFld, inPic, inBlipFill bool
        var inSpPr, inLn, inBgPr, inBgElem, inEndPr bool
        var fillCtx string // solidFill/gradFill 的归属：run|defrpr|bg|shape|ln|""
        var bodyVanchor string

        // 新增样式状态（与写入器支持的特性一一对应）
        var inTransition bool   // p:transition 内
        var inPPr, inLnSpc bool // 段落属性 / 行距内
        var pPrMarL int64       // 当前段落 pPr 的 marL（用于推断缩进层级）
        var inGs bool           // 渐变停止点 a:gs 内
        var gsColors []string   // 当前形状渐变已收集的停止色（≤2）
        var inGlow bool         // a:glow 内
        var inBgBlipFill bool   // 背景图片填充内
        var bgBlipRID string    // 背景图 rId
        // 段落是否为空（无任何 run）
        paraHasRun := false

        // finalizePara 结束当前段落：应用默认样式并追加
        finalizePara := func() {
                if curPara == nil {
                        return
                }
                if !paraHasRun && len(curPara.Runs) == 0 {
                        // 空段落：保留为空行（前端渲染换行）
                        paras = append(paras, *curPara)
                        curPara = nil
                        paraHasRun = false
                        return
                }
                // 默认样式回退：run 缺失的属性 → 形状默认 → 母版样式
                styleKey := "other"
                if cur != nil {
                        switch cur.Ph {
                        case "title", "ctrTitle":
                                styleKey = "title"
                        case "body", "subTitle":
                                styleKey = "body"
                        }
                }
                defSize := shapeDefault.SizePt
                defColor := shapeDefault.Color
                defBold := shapeDefault.Bold
                if defSize == 0 && defColor == "" {
                        if ms, ok := ctx.txStyles[styleKey]; ok {
                                if defSize == 0 {
                                        defSize = ms.SizePt
                                }
                                if defColor == "" {
                                        defColor = ms.Color
                                }
                                if !defBold {
                                        defBold = ms.Bold
                                }
                        }
                }
                for i := range curPara.Runs {
                        r := &curPara.Runs[i]
                        if r.SizePt == 0 {
                                r.SizePt = defSize
                        }
                        if r.Color == "" {
                                r.Color = defColor
                        }
                        if !r.Bold {
                                r.Bold = defBold
                        }
                }
                paras = append(paras, *curPara)
                curPara = nil
                paraHasRun = false
        }

        // finalizeShape 结束当前形状：由 paras 计算兼容的扁平字段
        finalizeShape := func() {
                if cur == nil {
                        return
                }
                finalizePara()
                cur.Paras = paras
                var sb strings.Builder
                for pi, pa := range paras {
                        if pi > 0 {
                                sb.WriteString("\n")
                        }
                        for _, rn := range pa.Runs {
                                sb.WriteString(rn.Text)
                        }
                }
                cur.Text = sb.String()
                if cur.Align == "" {
                        for _, pa := range paras {
                                if pa.Align != "" {
                                        cur.Align = pa.Align
                                        break
                                }
                        }
                }
                for _, pa := range paras {
                        done := false
                        for _, rn := range pa.Runs {
                                if rn.Text == "" || strings.TrimSpace(rn.Text) == "" {
                                        continue
                                }
                                if cur.Color == "" {
                                        cur.Color = rn.Color
                                }
                                if cur.SizePt == 0 {
                                        cur.SizePt = rn.SizePt
                                }
                                if !cur.Bold {
                                        cur.Bold = rn.Bold
                                }
                                if !cur.Italic {
                                        cur.Italic = rn.Italic
                                }
                                if !cur.Underline {
                                        cur.Underline = rn.Underline
                                }
                                if cur.Font == "" {
                                        cur.Font = rn.Font
                                }
                                done = true
                                break
                        }
                        if done {
                                break
                        }
                }
                paras = nil
                shapeDefault = runDef{}
        }

        for {
                tok, err := dec.Token()
                if err != nil {
                        break
                }

                switch t := tok.(type) {
                case xml.StartElement:
                        local := t.Name.Local
                        switch local {
                        case "sp":
                                finalizeShape()
                                cur = &shapeDef{Kind: "text"}
                                paras = nil
                                inTxBody = false
                                bodyVanchor = ""
                                sawOff, sawExt = false, false
                                curPhIdx = ""
                        case "pic":
                                finalizeShape()
                                cur = &shapeDef{Kind: "pic"}
                                inPic = true
                                paras = nil
                                sawOff, sawExt = false, false
                                curPhIdx = ""
                        case "cxnSp":
                                // 连接线按矩形处理（无文字）
                                finalizeShape()
                                cur = &shapeDef{Kind: "rect"}
                        case "prstGeom":
                                if cur != nil {
                                        cur.Geom = attrVal(t, "prst")
                                }
                        case "ph":
                                if cur != nil {
                                        cur.Ph = attrVal(t, "type")
                                        curPhIdx = attrVal(t, "idx")
                                }
                        case "xfrm":
                                // 形状/图片的几何容器
                                if cur != nil {
                                        // 旋转（xfrm rot 单位 1/60000 度 → 存度数）
                                        if rv := attrVal(t, "rot"); rv != "" {
                                                if deg, e := strconv.ParseFloat(rv, 64); e == nil && deg != 0 {
                                                        cur.Rotation = deg / 60000
                                                }
                                        }
                                }
                        case "off":
                                if cur != nil {
                                        for _, a := range t.Attr {
                                                switch a.Name.Local {
                                                case "x":
                                                        cur.X = atoi64(a.Value)
                                                case "y":
                                                        cur.Y = atoi64(a.Value)
                                                }
                                        }
                                        sawOff = true
                                }
                        case "ext":
                                if cur != nil && !inBlipFill {
                                        for _, a := range t.Attr {
                                                switch a.Name.Local {
                                                case "cx":
                                                        cur.Cx = atoi64(a.Value)
                                                case "cy":
                                                        cur.Cy = atoi64(a.Value)
                                                }
                                        }
                                        sawExt = true
                                }
                        case "txBody":
                                inTxBody = true
                                shapeDefault = runDef{}
                                paras = nil
                        case "p":
                                pPrMarL = 0
                                if inTxBody {
                                        finalizePara()
                                        curPara = &paraDef{}
                                        paraHasRun = false
                                        inPara = true
                                }
                        case "pPr":
                                inPPr = true
                                if cur != nil {
                                        if mv := atoi64(attrVal(t, "marL")); mv > 0 {
                                                pPrMarL = mv
                                        }
                                }
                                if inPara && curPara != nil {
                                        for _, a := range t.Attr {
                                                if a.Name.Local == "algn" {
                                                        curPara.Align = mapAlign(a.Value)
                                                }
                                        }
                                }
                        case "bodyPr":
                                for _, a := range t.Attr {
                                        if a.Name.Local == "anchor" {
                                                bodyVanchor = mapVanchor(a.Value)
                                        }
                                }
                        case "lvl1pPr":
                                if inTxBody {
                                        inLstLvl1 = true
                                }
                        case "defRPr":
                                if inTxBody && inLstLvl1 {
                                        inShapeDefRPr = true
                                        shapeDefault = runDef{}
                                        for _, a := range t.Attr {
                                                switch a.Name.Local {
                                                case "sz":
                                                        shapeDefault.SizePt = atoi(a.Value) / 100
                                                case "b":
                                                        shapeDefault.Bold = a.Value == "1" || a.Value == "true"
                                                case "i":
                                                        shapeDefault.Italic = a.Value == "1" || a.Value == "true"
                                                }
                                        }
                                }
                        case "r":
                                if inPara {
                                        inRun = true
                                        curRun = &runDef{}
                                }
                        case "fld":
                                if inPara {
                                        inFld = true
                                        curRun = &runDef{}
                                }
                        case "br":
                                if inPara && curPara != nil {
                                        curPara.Runs = append(curPara.Runs, runDef{Text: "\n"})
                                        paraHasRun = true
                                }
                        case "rPr":
                                if (inRun || inFld) && curRun != nil {
                                        for _, a := range t.Attr {
                                                switch a.Name.Local {
                                                case "sz":
                                                        curRun.SizePt = atoi(a.Value) / 100
                                                case "b":
                                                        curRun.Bold = a.Value == "1" || a.Value == "true"
                                                case "i":
                                                        curRun.Italic = a.Value == "1" || a.Value == "true"
                                                case "u":
                                                        curRun.Underline = a.Value != "none" && a.Value != ""
                                                }
                                        }
                                }
                        case "latin":
                                if (inRun || inFld) && curRun != nil {
                                        curRun.Font = attrVal(t, "typeface")
                                } else if inShapeDefRPr {
                                        shapeDefault.Font = attrVal(t, "typeface")
                                }
                        case "endParaRPr":
                                inEndPr = true
                        case "solidFill":
                                // 归属在颜色子元素处判定
                                switch {
                                case inEndPr:
                                        fillCtx = ""
                                case inBgPr:
                                        fillCtx = "bg"
                                case inRun || inFld:
                                        fillCtx = "run"
                                case inShapeDefRPr:
                                        fillCtx = "defrpr"
                                case inLn:
                                        fillCtx = "ln"
                                case inSpPr:
                                        fillCtx = "shape"
                                case inTxBody:
                                        // rPr 外的 solidFill（罕见），按形状填充处理
                                        fillCtx = "shape"
                                default:
                                        fillCtx = "shape"
                                }
                        case "gradFill":
                                switch {
                                case inBgPr:
                                        fillCtx = "bg"
                                case inRun || inFld:
                                        fillCtx = "run"
                                case inLn:
                                        fillCtx = "ln"
                                default:
                                        fillCtx = "shape"
                                }
                                gsColors = nil
                        case "gs":
                                // 渐变停止点：颜色按 fillCtx 归属（取首停即可，但末停会覆盖；
                                // 只在还没有值时赋值 → 由 setColor 调用方保证）
                                if fillCtx == "shape" && cur != nil {
                                        inGs = true
                                }
                        case "transition":
                                inTransition = true
                        case "fade", "push", "wipe", "cover", "cut", "zoom", "morph":
                                // p:transition 的子元素名即切换类型（morph 视为 fade）
                                if inTransition && slide.Transition == "" {
                                        slide.Transition = local
                                }
                        case "lnSpc":
                                if inPara && inPPr {
                                        inLnSpc = true
                                }
                        case "spcPct":
                                if inPara && inPPr && inLnSpc && cur != nil {
                                        if v := atoi64(attrVal(t, "val")); v > 0 {
                                                cur.LineHeight = float64(v) / 100000
                                        }
                                }
                        case "buChar":
                                if inPara && cur != nil && !cur.Numbered {
                                        cur.Bullet = true
                                        // marL=285750*(lvl+1) → 推断缩进层级
                                        if cur.Indent == 0 && pPrMarL >= 2*285750 {
                                                cur.Indent = int(pPrMarL/285750) - 1
                                        }
                                }
                        case "buAutoNum":
                                if inPara && cur != nil && !cur.Bullet {
                                        cur.Numbered = true
                                        if cur.Indent == 0 && pPrMarL >= 2*285750 {
                                                cur.Indent = int(pPrMarL/285750) - 1
                                        }
                                }
                        case "outerShdw":
                                if cur != nil && inSpPr && !inRun && !inFld && !inEndPr {
                                        cur.Shadow = true
                                }
                        case "glow":
                                if cur != nil && inSpPr && !inRun && !inFld && !inEndPr {
                                        cur.Glow = true
                                        inGlow = true
                                }
                        case "hlinkClick":
                                // 超链接：r:id → slide rels 的 Target（外部 URL）
                                if cur != nil && cur.Link == "" && rels != nil {
                                        if rid := attrVal(t, "id"); rid != "" {
                                                if target, ok := rels[rid]; ok {
                                                        cur.Link = target
                                                }
                                        }
                                }
                        case "srgbClr", "sysClr", "schemeClr", "prstClr":
                                // 段落 pPr 里的颜色不存在；此处按 fillCtx 分派
                                switch {
                                case inEndPr:
                                        // endParaRPr 的颜色忽略
                                case inBgPr || inBgElem:
                                        hex := readColorElement(dec, t, ctx.theme, ctx.clrMap)
                                        if hex != "" && slide.Bg == "" {
                                                slide.Bg = hex
                                        }
                                default:
                                        hex := readColorElement(dec, t, ctx.theme, ctx.clrMap)
                                        if hex != "" {
                                                switch fillCtx {
                                                case "run":
                                                        if curRun != nil && curRun.Color == "" {
                                                                curRun.Color = hex
                                                        }
                                                case "defrpr":
                                                        if shapeDefault.Color == "" {
                                                                shapeDefault.Color = hex
                                                        }
                                                case "bg":
                                                        if slide.Bg == "" {
                                                                slide.Bg = hex
                                                        }
                                                case "shape":
                                                        if cur != nil && cur.Fill == "" {
                                                                cur.Fill = hex
                                                        }
                                                case "ln":
                                                        if cur != nil && cur.LineColor == "" {
                                                                cur.LineColor = hex
                                                        }
                                                }
                                                // 渐变停止色（形状渐变取前两个，hashless）
                                                if inGs && fillCtx == "shape" && cur != nil && len(gsColors) < 2 {
                                                        gsColors = append(gsColors, strings.TrimPrefix(hex, "#"))
                                                }
                                                // 发光色
                                                if inGlow && cur != nil && cur.GlowColor == "" {
                                                        cur.GlowColor = hex
                                                }
                                        }
                                }
                        case "t":
                                if (inRun || inFld) && curRun != nil {
                                        text := readCharData(dec)
                                        curRun.Text += text
                                        if strings.TrimSpace(text) != "" {
                                                paraHasRun = true
                                        }
                                }
                        case "blipFill":
                                if inPic {
                                        inBlipFill = true
                                }
                                if inBgPr || inBgElem {
                                        inBgBlipFill = true
                                }
                        case "blip":
                                if inBlipFill {
                                        for _, a := range t.Attr {
                                                if a.Name.Local == "embed" {
                                                        curBlipRID = a.Value
                                                }
                                        }
                                } else if inBgBlipFill && bgBlipRID == "" {
                                        bgBlipRID = attrVal(t, "embed")
                                }
                        case "bg":
                                inBgElem = true
                        case "bgPr":
                                inBgPr = true
                        case "spPr":
                                if cur != nil || inPic {
                                        inSpPr = true
                                }
                        case "ln":
                                inLn = true
                                if cur != nil {
                                        if wv := atoi(attrVal(t, "w")); wv > 0 {
                                                cur.LineWpt = wv / 12700
                                        }
                                }
                        }
                case xml.EndElement:
                        local := t.Name.Local
                        switch local {
                        case "sp", "cxnSp":
                                if cur != nil && cur.Kind != "pic" {
                                        // 占位符无自有 xfrm 时从版式/母版继承几何
                                        if cur.Ph != "" && !(sawOff && sawExt) {
                                                if xf, ok := lookupPhXfrm(layoutPh, masterPh, cur.Ph, curPhIdx); ok {
                                                        cur.X, cur.Y, cur.Cx, cur.Cy = xf[0], xf[1], xf[2], xf[3]
                                                }
                                        }
                                        if cur.Vanchor == "" {
                                                cur.Vanchor = bodyVanchor
                                        }
                                        finalizeShape()
                                        shapes = append(shapes, *cur)
                                        cur = nil
                                        inTxBody = false
                                        bodyVanchor = ""
                                }
                        case "pic":
                                if cur != nil {
                                        // 解析图片字节
                                        if curBlipRID != "" && rels != nil {
                                                if target, ok := rels[curBlipRID]; ok {
                                                        if img, ok := loadMedia(files, name, target); ok {
                                                                cur.Img = img
                                                        }
                                                }
                                        }
                                        finalizeShape()
                                        shapes = append(shapes, *cur)
                                        cur = nil
                                        inPic = false
                                        inBlipFill = false
                                        curBlipRID = ""
                                }
                        case "p":
                                if inPara {
                                        finalizePara()
                                        inPara = false
                                }
                        case "r":
                                if inRun {
                                        if curPara != nil && curRun != nil {
                                                curPara.Runs = append(curPara.Runs, *curRun)
                                                if strings.TrimSpace(curRun.Text) != "" {
                                                        paraHasRun = true
                                                }
                                        }
                                        curRun = nil
                                        inRun = false
                                }
                        case "fld":
                                if inFld {
                                        if curPara != nil && curRun != nil {
                                                curPara.Runs = append(curPara.Runs, *curRun)
                                                paraHasRun = true
                                        }
                                        curRun = nil
                                        inFld = false
                                }
                        case "txBody":
                                finalizePara()
                                inTxBody = false
                                inLstLvl1 = false
                                inShapeDefRPr = false
                        case "lvl1pPr":
                                inLstLvl1 = false
                        case "defRPr":
                                inShapeDefRPr = false
                        case "endParaRPr":
                                inEndPr = false
                        case "solidFill":
                                fillCtx = ""
                        case "gradFill":
                                // 渐变结束：前两个停止色 → Gradient（hashless "C1,C2"）
                                if fillCtx == "shape" && cur != nil && cur.Gradient == "" && len(gsColors) == 2 {
                                        cur.Gradient = gsColors[0] + "," + gsColors[1]
                                }
                                gsColors = nil
                                fillCtx = ""
                        case "bg":
                                // 背景图：p:bg/bgPr/blipFill/blip@r:embed → 解析图片为 data URL
                                if slide.Bg == "" && bgBlipRID != "" && rels != nil {
                                        if target, ok := rels[bgBlipRID]; ok {
                                                if img, ok := loadMedia(files, name, target); ok {
                                                        slide.Bg = `url("` + img + `")`
                                                }
                                        }
                                }
                                inBgElem = false
                                bgBlipRID = ""
                                inBgBlipFill = false
                        case "bgPr":
                                inBgPr = false
                        case "spPr":
                                inSpPr = false
                        case "ln":
                                inLn = false
                        case "transition":
                                inTransition = false
                        case "pPr":
                                inPPr = false
                                pPrMarL = 0
                        case "lnSpc":
                                inLnSpc = false
                        case "gs":
                                inGs = false
                        case "glow":
                                inGlow = false
                        }
                }
        }
        finalizeShape()

        // 推断标题与 bullets：取最大的文本形状作为标题，其余作为要点
        var texts []string
        for _, s := range shapes {
                if s.Kind == "text" && strings.TrimSpace(s.Text) != "" {
                        texts = append(texts, s.Text)
                }
        }
        if len(texts) > 0 {
                slide.Title = texts[0]
                slide.Bullets = texts[1:]
        }

        slide.Shapes = shapes
        return slide
}

// loadMedia 根据 rels 的 Target 解析图片字节，返回 data URL
func loadMedia(files map[string]*zip.File, slideName, target string) (string, bool) {
        // target 形如 "../media/image1.png"，相对幻灯片所在目录解析。
        // 必须把基目录与 target 拼成完整包路径再逐层消化 ".."，
        // 否则 "ppt/slides" + "../media/image1.png" 只会得到 "media/image1.png"，
        // 而 zip 里的真实路径是 "ppt/media/image1.png"（图片永远加载不出的根因）。
        dir := "ppt/slides"
        if i := strings.LastIndex(slideName, "/"); i >= 0 {
                dir = slideName[:i]
        }
        if strings.HasPrefix(target, "/") {
                // 包内绝对路径
                mediaPath := strings.TrimPrefix(target, "/")
                f, ok := files[mediaPath]
                if !ok {
                        return "", false
                }
                return readMediaData(files, f, mediaPath)
        }
        baseParts := strings.Split(dir, "/")
        parts := strings.Split(target, "/")
        stack := make([]string, 0, len(baseParts)+len(parts))
        for _, p := range append(append([]string{}, baseParts...), parts...) {
                switch p {
                case "", ".":
                        // skip
                case "..":
                        if len(stack) > 0 {
                                stack = stack[:len(stack)-1]
                        }
                default:
                        stack = append(stack, p)
                }
        }
        if len(stack) == 0 {
                return "", false
        }
        mediaPath := strings.Join(stack, "/")
        f, ok := files[mediaPath]
        if !ok {
                return "", false
        }
        return readMediaData(files, f, mediaPath)
}

// readMediaData 读取 zip 内媒体字节并编码为 data URL
func readMediaData(files map[string]*zip.File, f *zip.File, mediaPath string) (string, bool) {
        rc, err := f.Open()
        if err != nil {
                return "", false
        }
        defer rc.Close()
        raw, err := io.ReadAll(rc)
        if err != nil {
                return "", false
        }
        mime := mimeOf(mediaPath)
        enc := base64.StdEncoding.EncodeToString(raw)
        return "data:" + mime + ";base64," + enc, true
}

func mimeOf(path string) string {
        lower := strings.ToLower(path)
        switch {
        case strings.HasSuffix(lower, ".png"):
                return "image/png"
        case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
                return "image/jpeg"
        case strings.HasSuffix(lower, ".gif"):
                return "image/gif"
        case strings.HasSuffix(lower, ".bmp"):
                return "image/bmp"
        case strings.HasSuffix(lower, ".svg"):
                return "image/svg+xml"
        case strings.HasSuffix(lower, ".webp"):
                return "image/webp"
        default:
                return "application/octet-stream"
        }
}

func mapAlign(a string) string {
        switch a {
        case "ctr":
                return "c"
        case "r":
                return "r"
        case "just", "dist":
                return "l"
        default:
                return "l"
        }
}

func mapVanchor(a string) string {
        switch a {
        case "t":
                return "t"
        case "b":
                return "b"
        default:
                return "ctr"
        }
}

func atoi(s string) int {
        n := 0
        for _, r := range s {
                if r < '0' || r > '9' {
                        break
                }
                n = n*10 + int(r-'0')
        }
        return n
}

func atoi64(s string) int64 {
        n := int64(0)
        for _, r := range s {
                if r < '0' || r > '9' {
                        break
                }
                n = n*10 + int64(r-'0')
        }
        return n
}

func readCharData(dec *xml.Decoder) string {
        var sb strings.Builder
        for {
                tok, err := dec.Token()
                if err != nil {
                        return sb.String()
                }
                switch t := tok.(type) {
                case xml.CharData:
                        sb.Write(t)
                case xml.EndElement:
                        return sb.String()
                }
        }
}

// extractSlideNum 从 "ppt/slides/slide1.xml" 提取 1
func extractSlideNum(name string) int {
        s := name
        s = strings.TrimPrefix(s, "ppt/slides/slide")
        s = strings.TrimSuffix(s, ".xml")
        n := 0
        for _, r := range s {
                if r < '0' || r > '9' {
                        break
                }
                n = n*10 + int(r-'0')
        }
        return n
}

// parseCoreProps 解析 docProps/core.xml 提取元数据（与 docx 共用逻辑）
func parseCoreProps(r io.Reader, meta *core.Meta) {
        dec := xml.NewDecoder(r)
        dec.Strict = false
        depth := 0
        for {
                tok, err := dec.Token()
                if err != nil {
                        return
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        depth++
                        if depth == 2 {
                                text := readCharData(dec)
                                depth--
                                switch t.Name.Local {
                                case "title":
                                        meta.Title = strings.TrimSpace(text)
                                case "creator":
                                        meta.Author = strings.TrimSpace(text)
                                case "subject":
                                        meta.Subject = strings.TrimSpace(text)
                                case "description":
                                        meta.Description = strings.TrimSpace(text)
                                case "language":
                                        meta.Language = strings.TrimSpace(text)
                                }
                        }
                case xml.EndElement:
                        depth--
                }
        }
}
