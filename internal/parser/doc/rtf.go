// Package doc 内部工具：RTF 解析。
//
// SamOffice 将 .doc 导出为 Word/WPS 均可打开的 RTF 文本（见
// internal/server/api/handler.go 的 generateRTF）。为保证"保存后重新打开"
// 的闭环一致，此处提供一个最小但健壮的 RTF 解析器：将 RTF 还原为 UDM，
// 至少保留段落与基本的粗体/斜体/下划线格式。真实的二进制 OLE .doc 仍由
// parser.go 的 OLE 路径处理，二者通过 Parse 中的内容嗅探区分。
package doc

import (
	"strings"

	"github.com/zai/samoffice/internal/core"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

// rtfState 记录 RTF 解析过程中的字符格式状态。
type rtfState struct {
	bold   bool
	italic bool
	under  bool
}

// isRTFContent 嗅探字节流是否为 RTF（以可选的空白后跟 "{\rtf" 开头）。
func isRTFContent(data []byte) bool {
	s := string(data)
	// 跳过前导空白/控制字符
	start := 0
	for start < len(s) && (s[start] == ' ' || s[start] == '\t' || s[start] == '\r' || s[start] == '\n' || s[start] == '\x00') {
		start++
	}
	return strings.HasPrefix(s[start:], "{\\rtf") || strings.HasPrefix(s[start:], "{\\rtf1")
}

// rtfToUDM 将 RTF 文本解析为 UDM。支持：
//   - \par 段落分隔
//   - \b ... \b0 / \b1 粗体、\i ... \i0 斜体、\ul ... \ul0 下划线
//   - 转义字符：\\ \'xx（十六进制字节，按 GBK/UTF-8 容错解码）
//   - {\*\...} 目标（如 {\*\generator}）整体跳过
//   - 其它未知控制字：跳过其关键字，但若带参数则不消费后续空格
func rtfToUDM(data []byte) (*core.Document, []core.Warning) {
	warnings := []core.Warning{}
	// 仅取前若干字节判断是否在 RTF 解析范围内（调用方已嗅探，这里直接解析）
	text := string(data)
	runes := []rune(text)
	n := len(runes)

	var blocks []core.Block

	var st rtfState

	// 当前段落的 inline 累积
	var curInlines []core.Inline
	// 缓存当前文本 run（带当前格式），用于合并相邻同格式文本
	var runBuf strings.Builder
	var runFmt rtfState

	flushRun := func() {
		if runBuf.Len() == 0 {
			return
		}
		curInlines = append(curInlines, core.Text{
			Content: runBuf.String(),
			Bold:    runFmt.bold,
			Italic:  runFmt.italic,
			Under:   runFmt.under,
		})
		runBuf.Reset()
	}
	flushParagraph := func() {
		flushRun()
		if len(curInlines) == 0 {
			// 空段落也保留（保持段落结构）
			curInlines = []core.Inline{}
		}
		blocks = append(blocks, &core.Paragraph{Inline: curInlines})
		curInlines = nil
	}

	// 处理一个普通字符（非控制字、非组边界）
	appendChar := func(r rune) {
		// 合并同格式 run
		if runBuf.Len() == 0 {
			runFmt = st
		}
		runBuf.WriteRune(r)
	}

	// 跳过 {\*\...} 目标组：返回解析到的位置（右括号之后）
	skipDestination := func(i int) int {
		depth := 0
		for ; i < n; i++ {
			switch runes[i] {
			case '{':
				depth++
			case '}':
				if depth == 0 {
					return i + 1
				}
				depth--
			}
		}
		return n
	}

	i := 0
	// GBK 续字节缓存（处理 \' 双字节序列）
	var pendingHi byte = 0
	hasPending := false

	for i < n {
		ch := runes[i]
		switch ch {
		case '{':
			// 检查是否 {\*\ 目标
			if i+2 < n && runes[i+1] == '*' && runes[i+2] == '\\' {
				i = skipDestination(i)
				continue
			}
			// 普通组：进入，但不改变状态栈（RTF 组通常不影响段落结构，
			// 仅控制字影响格式；我们已有状态，这里不做栈保存以简化处理，
			// 因 generateRTF 不嵌套格式组）。为稳妥，不处理嵌套格式回滚。
			i++
		case '}':
			// 组结束：刷新当前 run（格式在组内已应用，无需回滚对于本工具足够）
			i++
		case '\\':
			// 控制字
			if i+1 < n {
				nc := runes[i+1]
				if nc == '\'' {
					// 转义字节 \'xx
					if i+3 < n {
						h := hexVal(runes[i+2])
						l := hexVal(runes[i+3])
						if h >= 0 && l >= 0 {
							b := byte(h<<4 | l)
							if hasPending {
								// 组合为 GBK 双字节
								combined := gbkDecode(pendingHi, b)
								for _, cr := range combined {
									appendChar(cr)
								}
								hasPending = false
							} else if b >= 0x80 {
								pendingHi = b
								hasPending = true
							} else {
								appendChar(rune(b))
							}
							i += 4
							continue
						}
					}
					// 非法 \' 序列：跳过
					i += 2
				} else if nc == '\\' || nc == '{' || nc == '}' {
					// 字面字符
					appendChar(nc)
					i += 2
				} else if nc == '~' {
					appendChar('\u00a0') // 不换行空格
					i += 2
				} else if nc == '-' {
					appendChar('-') // 可选连字符
					i += 2
				} else if nc == '_' {
					appendChar('\u2011') // 不换行连字符
					i += 2
				} else if nc == ' ' {
					// \* 续行（backslash-space）：忽略
					i += 2
				} else if nc == '\n' || nc == '\r' {
					// 控制字换行续行
					i += 2
				} else {
					// 字母控制字
					j := i + 1
					for j < n && isLetter(runes[j]) {
						j++
					}
					word := string(runes[i+1 : j])
					// 可选数字参数
					param := 0
					hasParam := false
					if j < n && (runes[j] == '-' || isDigit(runes[j])) {
						k := j
						neg := false
						if runes[k] == '-' {
							neg = true
							k++
						}
						start := k
						for k < n && isDigit(runes[k]) {
							k++
						}
						if k > start {
							param = atoi(string(runes[start:k]))
							if neg {
								param = -param
							}
							hasParam = true
						}
						j = k
					}
					// 控制字后可能有一个空格分隔符（被消费）
					if j < n && runes[j] == ' ' {
						j++
					}
					applyControlWord(word, param, hasParam, &st, flushParagraph)
					i = j
				}
			} else {
				i++
			}
		default:
			if hasPending && ch >= 0x80 {
				// 不应发生
				hasPending = false
			}
			appendChar(ch)
			i++
		}
	}
	flushParagraph()

	if len(blocks) == 0 {
		warnings = append(warnings, core.Warning{
			Level:   "warn",
			Stage:   "parse",
			Message: "RTF 解析未产生内容",
		})
	}

	return &core.Document{
		Meta:   core.Meta{},
		Blocks: blocks,
		Raw:    make(map[string]any),
	}, warnings
}

// applyControlWord 处理 RTF 控制字对当前状态/段落的影响。
func applyControlWord(word string, param int, hasParam bool, st *rtfState, flushParagraph func()) {
	switch word {
	case "par", "par2":
		flushParagraph()
	case "b":
		st.bold = !hasParam || param != 0
	case "i":
		st.italic = !hasParam || param != 0
	case "ul", "ulw", "ulnone":
		// ulnone 关闭下划线
		if word == "ulnone" {
			st.under = false
		} else {
			st.under = !hasParam || param != 0
		}
	case "ul0":
		st.under = false
	case "strike":
		// 暂不支持删除线还原，忽略
	case "line", "tab":
		// 行内换行/制表：当前实现不处理（flushRun 后继续），保持简单
	default:
		// 其它控制字（如 \fN \fsN \pard \plain \ql 等）忽略
	}
}

func isLetter(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}
func isDigit(r rune) bool {
	return r >= '0' && r <= '9'
}
func hexVal(r rune) int {
	switch {
	case r >= '0' && r <= '9':
		return int(r - '0')
	case r >= 'a' && r <= 'f':
		return int(r-'a') + 10
	case r >= 'A' && r <= 'F':
		return int(r-'A') + 10
	}
	return -1
}
func atoi(s string) int {
	v := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			break
		}
		v = v*10 + int(r-'0')
	}
	return v
}

// gbkDecode 将 GBK 双字节（hi, lo）解码为 UTF-8 字符序列。
func gbkDecode(hi, lo byte) []rune {
	b := []byte{hi, lo}
	// 优先按 GBK 解码（中文 RTF 最常见）
	if s, ok := tryGBK(b); ok && s != "" {
		return []rune(s)
	}
	// 回退：按 Latin-1 解释为单字符
	return []rune{rune(hi), rune(lo)}
}

// tryGBK 尝试用 GBK 解码字节序列，失败返回 ok=false。
func tryGBK(b []byte) (string, bool) {
	out, _, err := transform.Bytes(simplifiedchinese.GBK.NewDecoder(), b)
	if err != nil {
		return "", false
	}
	return string(out), true
}
