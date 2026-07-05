// Package hunspell 实现 Hunspell .dic/.aff 词库的纯 Go 加载器
// 仅做基础解析（不含 aff 复杂规则），用于给 SymSpell 提供词条
//
// .dic 格式：
//   第一行：词条数
//   后续行：word[/flags][TAB frequency]
//   示例：hello/MAT:100
//
// .aff 格式（仅解析 SET 编码和部分规则，其余忽略）：
//   SET UTF-8
//   SFX A Y 2 ...
//   PFX B N 1 ...
//
// 容错：解析失败时跳过该行，不报错
package hunspell

import (
        "bufio"
        "embed"
        "io"
        "strconv"
        "strings"
        "unicode/utf8"
)

//go:embed dicts/*.dic dicts/*.aff
var builtinFS embed.FS

// LoadBuiltin 从嵌入资源加载词库
// 返回 word → frequency map
func LoadBuiltin(lang string) (map[string]int, error) {
        dicPath := "dicts/" + lang + ".dic"
        data, err := builtinFS.ReadFile(dicPath)
        if err != nil {
                return nil, err
        }
        // 同时加载 .aff 规则
        affPath := "dicts/" + lang + ".aff"
        affData, affErr := builtinFS.ReadFile(affPath)
        var rules *AffRules
        if affErr == nil {
                rules = ParseAffRules(affData)
        }
        return ParseDicWithAff(data, rules)
}

// ParseDic 解析 .dic 文件字节流（不含 aff 派生）
func ParseDic(data []byte) (map[string]int, error) {
        return ParseDicWithAff(data, nil)
}

// ParseDicWithAff 解析 .dic 文件并应用 aff 派生规则
// 限制：每个词根最多派生 5 个词（避免组合爆炸）
// 限制：总词条数限制 80000（控制内存）
func ParseDicWithAff(data []byte, rules *AffRules) (map[string]int, error) {
        words := make(map[string]int)
        const MAX_WORDS = 50000
        scanner := bufio.NewScanner(strings.NewReader(string(data)))
        scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
        lineNo := 0
        for scanner.Scan() {
                if len(words) >= MAX_WORDS {
                        break
                }
                lineNo++
                line := strings.TrimSpace(scanner.Text())
                if line == "" {
                        continue
                }
                if lineNo == 1 {
                        if n, err := strconv.Atoi(line); err == nil && n > 0 {
                                continue
                        }
                }

                if !utf8.ValidString(line) {
                        continue
                }
                word := line
                flags := ""
                if idx := strings.IndexByte(word, '/'); idx > 0 {
                        flags = word[idx+1:]
                        word = word[:idx]
                }
                if idx := strings.IndexByte(word, '\t'); idx > 0 {
                        word = word[:idx]
                }
                word = strings.TrimSpace(word)
                if word == "" || containsSpace(word) {
                        continue
                }

                freq := max(1, 1000-len(word)*10)

                // 应用 aff 派生规则（限制总派生数避免爆炸）
                if rules != nil && flags != "" {
                        derived := rules.Derive(word, flags)
                        if len(derived) > 5 {
                                derived = derived[:5]
                        }
                        for _, w := range derived {
                                wl := strings.ToLower(w)
                                if existing, ok := words[wl]; ok {
                                        words[wl] = existing + freq/2
                                } else {
                                        words[wl] = freq
                                }
                        }
                } else {
                        words[strings.ToLower(word)] = freq
                }
        }
        return words, scanner.Err()
}

// ParseAff 解析 .aff 文件（仅提取 SET 编码，其余规则暂不实现）
// 用于未来扩展：处理 SFX/PFX 派生词
func ParseAff(data []byte) (encoding string, err error) {
        scanner := bufio.NewScanner(strings.NewReader(string(data)))
        for scanner.Scan() {
                line := strings.TrimSpace(scanner.Text())
                if strings.HasPrefix(line, "SET ") {
                        return strings.TrimSpace(strings.TrimPrefix(line, "SET ")), nil
                }
        }
        return "UTF-8", scanner.Err()
}

// LoadAffFromFS 从 embed FS 加载 aff（暂未使用，预留）
func LoadAffFromFS(lang string) (string, error) {
        data, err := builtinFS.ReadFile("dicts/" + lang + ".aff")
        if err != nil {
                return "UTF-8", nil
        }
        return ParseAff(data)
}

func containsSpace(s string) bool {
        for _, r := range s {
                if r == ' ' || r == '\t' {
                        return true
                }
        }
        return false
}

func max(a, b int) int {
        if a > b {
                return a
        }
        return b
}

// 让 io 包被引用以备扩展
var _ = io.EOF
