package dict

import (
        "path/filepath"
        "runtime"
        "strings"
        "sync"

        "github.com/zai/gooffice/internal/dict/chinese"
        "github.com/zai/gooffice/internal/dict/symspell"
        "github.com/zai/gooffice/internal/dict/userdict"
)

// Manager 是词库系统的统一入口，负责：
//  1. 多语言路由 (按字符集自动选择词典)
//  2. 用户词库与内置词库的合并
//  3. 拼写检查 + 纠错建议
//  4. 用户词库自学习
//  5. SymSpell 索引缓存（启动加速）
type Manager struct {
        dicts    map[string]*symspell.SymSpell
        zhSeg    *chinese.Segmenter
        user     *userdict.Store
        cacheDir string
        mu       sync.RWMutex
        loaded   map[string]bool
}

type SpellError struct {
        Word    string   `json:"word"`
        Lang    string   `json:"lang"`
        Start   int      `json:"start"`
        End     int      `json:"end"`
        Suggest []string `json:"suggest"`
}

type Candidate struct {
        Word      string `json:"word"`
        Distance  int    `json:"distance"`
        Frequency int    `json:"frequency"`
}

func NewManager(userStore *userdict.Store) *Manager {
        m := &Manager{
                dicts:  make(map[string]*symspell.SymSpell),
                zhSeg:  chinese.New(),
                user:   userStore,
                loaded: make(map[string]bool),
        }
        // 同步加载 jieba 词典（启动时一次性，加载完触发 GC 释放临时分配）
        _ = m.zhSeg.LoadBuiltin()
        runtime.GC()
        return m
}

// SetCacheDir 设置索引缓存目录
// 设置后 RegisterLang 会优先加载缓存，构建后自动保存
func (m *Manager) SetCacheDir(dir string) {
        m.mu.Lock()
        defer m.mu.Unlock()
        m.cacheDir = dir
}

// RegisterLang 注册一个语言词典，词表通过回调注入
// 用于让上层决定从嵌入资源、文件或网络加载
func (m *Manager) RegisterLang(lang string, words map[string]int) error {
        m.mu.Lock()
        cacheDir := m.cacheDir
        m.mu.Unlock()

        // 尝试从缓存加载
        cachePath := ""
        if cacheDir != "" {
                cachePath = filepath.Join(cacheDir, "symspell-"+lang+".gob")
                idx := symspell.New(2)
                if err := idx.LoadIndex(cachePath); err == nil {
                        m.mu.Lock()
                        m.dicts[lang] = idx
                        m.loaded[lang] = true
                        m.mu.Unlock()
                        return nil
                }
        }

        m.mu.Lock()
        defer m.mu.Unlock()

        // 中文：仅填充分词器词典，不进 SymSpell（35万词 maxDist=2 索引会 OOM）
        // 中文拼写检查通过 zhSeg.HasWord 双重验证
        if lang == "zh" {
                for w, f := range words {
                        m.zhSeg.AddWord(w, f)
                }
                // 合并用户词库
                if m.user != nil {
                        entries, _ := m.user.All(lang)
                        for _, e := range entries {
                                m.zhSeg.AddWord(e.Word, e.Frequency+1)
                        }
                }
                // 中文用一个小型 SymSpell 索引（仅用户词库 + 少量词），maxDist=1
                idx := symspell.New(1)
                if m.user != nil {
                        entries, _ := m.user.All(lang)
                        for _, e := range entries {
                                idx.AddWord(e.Word, e.Frequency+1)
                        }
                }
                idx.Build()
                m.dicts[lang] = idx
                m.loaded[lang] = true
                if cachePath != "" {
                        go idx.SaveIndex(cachePath)
                }
                return nil
        }

        // 英文等其他语言：大词库用 maxDist=1 控制内存
        maxDist := 2
        if len(words) > 50000 {
                maxDist = 1
        }
        idx := symspell.New(maxDist)
        for w, f := range words {
                idx.AddWord(w, f)
        }

        // 合并用户词库
        if m.user != nil {
                entries, err := m.user.All(lang)
                if err == nil {
                        for _, e := range entries {
                                idx.AddWord(e.Word, e.Frequency+1)
                        }
                }
        }

        idx.Build()
        m.dicts[lang] = idx
        m.loaded[lang] = true

        // 异步保存缓存
        if cachePath != "" {
                go idx.SaveIndex(cachePath)
        }
        return nil
}

// SpellCheck 检查一段文本中的拼写错误（按词切分，跳过标点和数字）
func (m *Manager) SpellCheck(text, lang string) []SpellError {
        m.mu.RLock()
        idx, ok := m.dicts[lang]
        zhSeg := m.zhSeg
        m.mu.RUnlock()
        if !ok {
                return []SpellError{}
        }

        var errs []SpellError = make([]SpellError, 0)
        var tokens []token

        if lang == "zh" && zhSeg != nil {
                // 中文：用 jieba 词典分词
                for _, t := range zhSeg.SegmentForSpellCheck(text) {
                        tokens = append(tokens, token{word: t.Word, start: t.Start, end: t.End})
                }
        } else {
                // 其他语言：按字符切分
                tokens = tokenize(text)
        }

        for _, t := range tokens {
                if isSkipWord(t.word) {
                        continue
                }
                // 中文：单字 token 跳过（无意义）
                if lang == "zh" && len([]rune(t.word)) <= 1 {
                        continue
                }
                // 中文：纯非 CJK token 跳过
                if lang == "zh" && !containsCJK(t.word) {
                        continue
                }
                // 非中文语言：跳过包含 CJK 字符的 token（避免中文词被英文词典误报）
                if lang != "zh" && containsCJK(t.word) {
                        continue
                }
                lower := strings.ToLower(t.word)
                if cands := idx.Lookup(lower, 0); len(cands) > 0 && cands[0].Distance == 0 {
                        continue // 正确
                }
                // 中文：用分词器词典双重验证（jieba 词典为准）
                if lang == "zh" && zhSeg != nil && zhSeg.HasWord(lower) {
                        continue
                }
                // 检查用户词库
                if has, _ := m.user.Has(lower, lang); has {
                        continue
                }
                suggests := idx.Lookup(lower, 8)
                words := make([]string, 0, len(suggests))
                for _, c := range suggests {
                        words = append(words, c.Word)
                }
                errs = append(errs, SpellError{
                        Word:    t.word,
                        Lang:    lang,
                        Start:   t.start,
                        End:     t.end,
                        Suggest: words,
                })
        }
        return errs
}

// Suggest 给一个词返回纠错建议
func (m *Manager) Suggest(word, lang string, n int) []Candidate {
        m.mu.RLock()
        idx, ok := m.dicts[lang]
        m.mu.RUnlock()
        if !ok {
                return nil
        }
        cands := idx.Lookup(strings.ToLower(word), n)
        out := make([]Candidate, 0, len(cands))
        for _, c := range cands {
                out = append(out, Candidate{
                        Word: c.Word, Distance: c.Distance, Frequency: c.Frequency,
                })
        }
        return out
}

// LearnUserWord 把一个词加入用户词库
func (m *Manager) LearnUserWord(word, lang, source string) error {
        if err := m.user.Add(word, lang, source, 5); err != nil {
                return err
        }
        // 同步到内存索引
        m.mu.RLock()
        idx, ok := m.dicts[lang]
        m.mu.RUnlock()
        if ok {
                idx.AddWord(strings.ToLower(word), 5)
                idx.Build()
        }
        return nil
}

// ForgetUserWord 从用户词库移除
func (m *Manager) ForgetUserWord(word, lang string) error {
        return m.user.Remove(word, lang)
}

// === 内部工具 ===

type token struct {
        word        string
        start, end  int
}

// tokenize 简单切词：连续字母/数字/CJK 字符为一个 token
// 中文按字符切分（适合拼写检查场景）
func tokenize(text string) []token {
        var out []token
        runes := []rune(text)
        i := 0
        for i < len(runes) {
                r := runes[i]
                switch {
                case isCJK(r):
                        // 中文：单字成 token
                        out = append(out, token{
                                word:  string(r),
                                start: i,
                                end:   i + 1,
                        })
                        i++
                case isLetter(r) || isDigit(r):
                        j := i
                        for j < len(runes) && (isLetter(runes[j]) || isDigit(runes[j]) || runes[j] == '\'' || runes[j] == '-') {
                                j++
                        }
                        out = append(out, token{
                                word:  string(runes[i:j]),
                                start: i,
                                end:   j,
                        })
                        i = j
                default:
                        i++
                }
        }
        return out
}

func isLetter(r rune) bool {
        return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}
func isDigit(r rune) bool { return r >= '0' && r <= '9' }
func isCJK(r rune) bool {
        return (r >= 0x4E00 && r <= 0x9FFF) ||
                (r >= 0x3400 && r <= 0x4DBF) ||
                (r >= 0x20000 && r <= 0x2A6DF)
}

// containsCJK 检查字符串是否包含中文字符
func containsCJK(s string) bool {
        for _, r := range s {
                if isCJK(r) {
                        return true
                }
        }
        return false
}

// isSkipWord 跳过纯数字、单字符、URL 等
func isSkipWord(w string) bool {
        if len(w) <= 1 {
                return true
        }
        allDigit := true
        for _, r := range w {
                if !isDigit(r) && r != '.' && r != ',' {
                        allDigit = false
                        break
                }
        }
        return allDigit
}
