// aff.go - Hunspell .aff 文件解析与派生词生成
//
// .aff 文件示例：
//   SET UTF-8
//   SFX A Y 2
//   SFX A 0 re .
//   SFX A e er .
//   PFX B N 1
//   PFX B 0 un .
//
// .dic 文件示例：
//   happy/A     ← 词根 happy 携带 flag A
//   definite/SM ← 词根 definite 携带 S 和 M
//
// 应用规则后生成派生词：
//   happy/A + SFX A rule 2 → happier, happily
//   definite/SM + SFX S → definites; + SFX M → definitely

package hunspell

import (
        "bufio"
        "strings"
)

// SFX/PFX rule 定义
type affixRule struct {
        CrossProduct bool
        Entries      []affixEntry
}

type affixEntry struct {
        Strip    string // 要剥除的后缀/前缀（"0" 表示无）
        Add      string // 要添加的后缀/前缀
        Condition string // 正则条件（"." 表示任意）
}

// AffRules 解析后的 aff 规则集合
type AffRules struct {
        Encoding string
        SFX      map[byte]*affixRule // flag → rule
        PFX      map[byte]*affixRule
}

// ParseAffRules 解析 .aff 文件，返回 SFX/PFX 规则
// 容错：解析失败的规则跳过
func ParseAffRules(data []byte) *AffRules {
        r := &AffRules{
                Encoding: "UTF-8",
                SFX:      make(map[byte]*affixRule),
                PFX:      make(map[byte]*affixRule),
        }

        scanner := bufio.NewScanner(strings.NewReader(string(data)))
        scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

        var current *affixRule
        var pending int // 待读取的规则条目数

        for scanner.Scan() {
                line := strings.TrimSpace(scanner.Text())
                if line == "" || strings.HasPrefix(line, "#") {
                        continue
                }

                fields := strings.Fields(line)

                // SET UTF-8
                if fields[0] == "SET" && len(fields) >= 2 {
                        r.Encoding = fields[1]
                        continue
                }

                // SFX A Y 2 / PFX B N 1（声明行：fields[2] 是 Y/N，fields[3] 是数字）
                isDecl := (fields[0] == "SFX" || fields[0] == "PFX") &&
                        len(fields) >= 4 &&
                        (fields[2] == "Y" || fields[2] == "N")
                if isDecl {
                        t := fields[0][0]
                        if len(fields[1]) == 0 {
                                continue
                        }
                        flag := fields[1][0]
                        cross := fields[2] == "Y"
                        count := 0
                        if n, ok := parseIntSafe(fields[3]); ok {
                                count = n
                        }

                        current = &affixRule{CrossProduct: cross}
                        _ = t

                        if t == 'S' {
                                r.SFX[flag] = current
                        } else {
                                r.PFX[flag] = current
                        }
                        pending = count
                        continue
                }

                // SFX A 0 re . / PFX B 0 un .（entry 行：fields[0] 是 SFX/PFX，fields[2] 非 Y/N）
                if pending > 0 && current != nil &&
                        (fields[0] == "SFX" || fields[0] == "PFX") &&
                        len(fields) >= 4 {
                        strip := fields[2]
                        if strip == "0" {
                                strip = ""
                        }
                        add := fields[3]
                        if add == "0" {
                                add = ""
                        }
                        if idx := strings.Index(add, "/"); idx >= 0 {
                                add = add[:idx]
                        }
                        cond := "."
                        if len(fields) >= 5 {
                                cond = fields[4]
                        }

                        current.Entries = append(current.Entries, affixEntry{
                                Strip:     strip,
                                Add:       add,
                                Condition: cond,
                        })
                        pending--
                }
        }

        return r
}

// Derive 返回 word + flags 对应的所有派生词
// 例如 word="definite", flags="SM" → ["definite", "definites", "definitely"]
func (r *AffRules) Derive(word string, flags string) []string {
        result := []string{word}

        for i := 0; i < len(flags); i++ {
                flag := flags[i]
                // SFX 规则
                if rule, ok := r.SFX[flag]; ok {
                        for _, e := range rule.Entries {
                                if derived := applySFX(word, e); derived != "" {
                                        result = append(result, derived)
                                }
                        }
                }
                // PFX 规则
                if rule, ok := r.PFX[flag]; ok {
                        for _, e := range rule.Entries {
                                if derived := applyPFX(word, e); derived != "" {
                                        result = append(result, derived)
                                }
                        }
                }
        }

        return result
}

// applySFX 应用后缀规则
// 例如：word="happy", strip="y", add="iness" → "happiness"
// 条件简化：仅检查 word 是否以 strip 结尾
func applySFX(word string, e affixEntry) string {
        if e.Strip != "" && !strings.HasSuffix(word, e.Strip) {
                return ""
        }
        stripped := word
        if e.Strip != "" {
                stripped = strings.TrimSuffix(word, e.Strip)
        }
        // 条件检查简化：仅支持 "." (任意) 和单字符结尾
        if e.Condition != "." && e.Condition != "" {
                if !checkCondition(word, e.Condition) {
                        return ""
                }
        }
        return stripped + e.Add
}

// applyPFX 应用前缀规则
func applyPFX(word string, e affixEntry) string {
        if e.Strip != "" && !strings.HasPrefix(word, e.Strip) {
                return ""
        }
        stripped := word
        if e.Strip != "" {
                stripped = strings.TrimPrefix(word, e.Strip)
        }
        return e.Add + stripped
}

// checkCondition 简化的条件检查
// Hunspell 条件是正则，这里仅支持最简单的"以某字符结尾"
// 例如 "y" 表示必须以 y 结尾，"[^aeiou]y" 表示非元音后跟 y
func checkCondition(word, cond string) bool {
        if cond == "." || cond == "" {
                return true
        }
        // 简化：直接 HasSuffix
        if !strings.ContainsAny(cond, "[]") {
                return strings.HasSuffix(word, cond)
        }
        return true // 复杂条件默认通过
}

func parseIntSafe(s string) (int, bool) {
        n := 0
        for _, r := range s {
                if r < '0' || r > '9' {
                        return 0, false
                }
                n = n*10 + int(r-'0')
        }
        return n, true
}
