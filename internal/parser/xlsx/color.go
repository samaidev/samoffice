package xlsx

// color.go — xlsx 颜色解析：原始 styles.xml 的 rgb / theme / indexed 三种颜色
// 统一解析为 #RRGGBB。
//
// 背景：excelize 解码后的 Style.Fill.Color / Font.Color 依赖工作簿主题，
// 而 excelize 对 WPS 写出的 10 位 ARGB（如 FFFFF7FAFC，重复 alpha 前缀）以及
// theme/indexed 颜色会回退返回 "FF000000"（黑），导致打开带主题填充的表格
// 出现大片黑色背景。因此颜色一律从原始 styles.xml / theme1.xml 读取。

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"strconv"
	"strings"
)

// xlsx 的 theme 属性索引顺序（与 Excel UI 一致，dk1/lt1 与 clrScheme 顺序相反）：
// 0=lt1(bg1) 1=dk1(tx1) 2=lt2(bg2) 3=dk2(tx2) 4-9=accent1-6 10=hlink 11=folHlink
var themeSlotOrder = [12]string{
	"lt1", "dk1", "lt2", "dk2",
	"accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
	"hlink", "folHlink",
}

// parseThemeXML 从 xlsx 字节中读取 xl/theme/theme1.xml 的 clrScheme 颜色表。
func parseThemeXML(data []byte) map[string]string {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil
	}
	for _, zf := range zr.File {
		if zf.Name != "xl/theme/theme1.xml" {
			continue
		}
		rc, err := zf.Open()
		if err != nil {
			return nil
		}
		defer rc.Close()
		dec := xml.NewDecoder(rc)
		dec.Strict = false
		scheme := map[string]string{}
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
						scheme[curKey] = strings.ToUpper(attrValOf(t, "val"))
					}
				case "sysClr":
					if inScheme && depth == 1 && curKey != "" {
						if last := attrValOf(t, "lastClr"); last != "" {
							scheme[curKey] = strings.ToUpper(last)
						} else {
							switch attrValOf(t, "val") {
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
	return nil
}

func attrValOf(t xml.StartElement, name string) string {
	for _, a := range t.Attr {
		if a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}

// indexedPalette 是 ECMA-376 规定的标准索引调色板（0-63）。
// 64/65 是系统前景/背景色，视为无颜色处理。
var indexedPalette = [64]string{
	"000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
	"000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
	"800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
	"9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
	"000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
	"00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
	"3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
	"003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
}

// applyTint 按 ECMA-376 的 tint 定义调整颜色明度（tint>0 变亮，<0 变暗）。
// 与 Office 一致：先转 HSL，对 L 分量应用 tint，再转回 RGB。
func applyTint(hex string, tint float64) string {
	if tint == 0 {
		return strings.TrimPrefix(hex, "#")
	}
	h, s, l, ok := hexToHsl(hex)
	if !ok {
		return strings.TrimPrefix(hex, "#")
	}
	if tint > 0 {
		l = l*(1-tint) + tint
	} else {
		l = l * (1 + tint)
	}
	return hslToHex(h, s, l)
}

// hexToHsl 把 #RRGGBB 转为 HSL（h/s/l 均 0-1）。
func hexToHsl(hex string) (h, s, l float64, ok bool) {
	hex = strings.TrimPrefix(hex, "#")
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

// hslToHex 把 HSL 转回 #RRGGBB（不含 # 前缀）。
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
	h, s, l = clamp(h), clamp(s), clamp(l)
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
			if t < 1.0/6.0 {
				return p + (q-p)*6*t
			}
			if t < 0.5 {
				return q
			}
			if t < 2.0/3.0 {
				return p + (q-p)*(2.0/3.0-t)*6
			}
			return p
		}
		r, g, b = f(h+1.0/3.0), f(h), f(h-1.0/3.0)
	}
	to := func(v float64) int { return int(clamp(v)*255 + 0.5) }
	return fmtRGB(to(r), to(g), to(b))
}

func fmtRGB(r, g, b int) string {
	clamp := func(v int) int {
		if v < 0 {
			return 0
		}
		if v > 255 {
			return 255
		}
		return v
	}
	const hexDigits = "0123456789ABCDEF"
	out := make([]byte, 6)
	out[0] = hexDigits[clamp(r)>>4]
	out[1] = hexDigits[clamp(r)&0xF]
	out[2] = hexDigits[clamp(g)>>4]
	out[3] = hexDigits[clamp(g)&0xF]
	out[4] = hexDigits[clamp(b)>>4]
	out[5] = hexDigits[clamp(b)&0xF]
	return string(out)
}

// resolveStyleColor 把 styles.xml 的颜色元素（rgb/theme/indexed + tint）解析为 #RRGGBB。
func resolveStyleColor(c *styleColor, theme map[string]string) (string, bool) {
	if c == nil {
		return "", false
	}
	// 1) 直接 RGB（含 WPS 的 10 位重复 alpha）
	if c.RGB != "" {
		if hex, ok := normalizeColor(c.RGB); ok {
			if c.Tint != nil && *c.Tint != 0 {
				return "#" + applyTint(hex, *c.Tint), true
			}
			return hex, true
		}
	}
	// 2) 主题色（xlsx theme 索引顺序为 lt1,dk1,lt2,dk2,accent1-6,hlink,folHlink）
	if c.Theme != nil && theme != nil {
		idx := *c.Theme
		if idx >= 0 && int(idx) < len(themeSlotOrder) {
			if slot, ok := theme[themeSlotOrder[idx]]; ok && slot != "" {
				hex := strings.TrimPrefix(slot, "#")
				if c.Tint != nil && *c.Tint != 0 {
					hex = applyTint(hex, *c.Tint)
				}
				return "#" + strings.ToUpper(hex), true
			}
		}
	}
	// 3) 索引色（标准调色板；64/65 为系统色，视为无颜色）
	if c.Indexed != nil {
		idx := *c.Indexed
		if idx >= 0 && int(idx) < len(indexedPalette) {
			return "#" + indexedPalette[idx], true
		}
	}
	return "", false
}
