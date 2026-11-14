package symspell

import (
        "bufio"
        "encoding/gob"
        "os"
        "path/filepath"
        "sort"
        "strings"
        "sync"
)

// SymSpell 是 SymSpell 模糊匹配算法的纯 Go 实现。
type SymSpell struct {
        maxDist      int
        deletes      map[string][]string
        words        map[string]int
        mu           sync.RWMutex
        built        bool
}

type Candidate struct {
        Word      string
        Distance  int
        Frequency int
}

func New(maxDist int) *SymSpell {
        if maxDist < 1 {
                maxDist = 2
        }
        return &SymSpell{
                maxDist: maxDist,
                deletes: make(map[string][]string),
                words:   make(map[string]int),
        }
}

// AddWord 添加一个词到词典
func (s *SymSpell) AddWord(word string, freq int) {
        s.mu.Lock()
        defer s.mu.Unlock()

        word = strings.ToLower(strings.TrimSpace(word))
        if word == "" {
                return
        }
        if freq <= 0 {
                freq = 1
        }
        if _, ok := s.words[word]; ok {
                s.words[word] += freq
                return
        }
        s.words[word] = freq
        s.built = false
}

// Build 构建删除变体索引。新增词后必须调用一次才能查询。
func (s *SymSpell) Build() {
        s.mu.Lock()
        defer s.mu.Unlock()

        s.deletes = make(map[string][]string, len(s.words)*3)
        for word := range s.words {
                for _, del := range editsDelete(word, s.maxDist) {
                        s.deletes[del] = append(s.deletes[del], word)
                }
        }
        s.built = true
}

// === 索引序列化（启动加速）===
// 启动时如果存在缓存文件，直接 load 而非 rebuild
// SymSpell 索引 5 万词 build 约耗时 1-2 秒，序列化后 load 仅 100ms

type serializedIndex struct {
        MaxDist int
        Deletes map[string][]string
        Words   map[string]int
}

// SaveIndex 将构建好的索引序列化到文件
func (s *SymSpell) SaveIndex(path string) error {
        s.mu.RLock()
        defer s.mu.RUnlock()

        if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
                return err
        }
        f, err := os.Create(path)
        if err != nil {
                return err
        }
        defer f.Close()

        bw := bufio.NewWriter(f)
        defer bw.Flush()

        enc := gob.NewEncoder(bw)
        return enc.Encode(serializedIndex{
                MaxDist: s.maxDist,
                Deletes: s.deletes,
                Words:   s.words,
        })
}

// LoadIndex 从文件加载索引（替代 Build）
// 失败时返回错误，调用方应回退到 AddWord + Build
func (s *SymSpell) LoadIndex(path string) error {
        s.mu.Lock()
        defer s.mu.Unlock()

        f, err := os.Open(path)
        if err != nil {
                return err
        }
        defer f.Close()

        bw := bufio.NewReader(f)
        dec := gob.NewDecoder(bw)
        var idx serializedIndex
        if err := dec.Decode(&idx); err != nil {
                return err
        }

        s.maxDist = idx.MaxDist
        s.deletes = idx.Deletes
        s.words = idx.Words
        s.built = true
        return nil
}

// Lookup 查询 word 的建议词，返回按 (距离, 频率) 排序的前 N 个
// 使用 Damerau-Levenshtein 距离，对相邻字符交换更友好
func (s *SymSpell) Lookup(word string, n int) []Candidate {
        s.mu.RLock()
        defer s.mu.RUnlock()

        if !s.built {
                return nil
        }
        word = strings.ToLower(strings.TrimSpace(word))
        if word == "" {
                return nil
        }

        // 完全匹配
        if _, ok := s.words[word]; ok {
                return []Candidate{{Word: word, Distance: 0, Frequency: s.words[word]}}
        }

        cands := make(map[string]int) // word → distance
        addCand := func(w, source string) {
                if w == word {
                        return
                }
                d := damerauDistance(word, w)
                if d <= s.maxDist {
                        if old, ok := cands[w]; !ok || d < old {
                                cands[w] = d
                        }
                }
        }

        // 对查询词生成所有删除变体
        for _, del := range editsDelete(word, s.maxDist) {
                for _, w := range s.deletes[del] {
                        addCand(w, del)
                }
        }

        // 排序：距离升序 → 频率降序 → 长度差小优先
        wordLen := len([]rune(word))
        result := make([]Candidate, 0, len(cands))
        for w, d := range cands {
                result = append(result, Candidate{Word: w, Distance: d, Frequency: s.words[w]})
        }
        sort.Slice(result, func(i, j int) bool {
                if result[i].Distance != result[j].Distance {
                        return result[i].Distance < result[j].Distance
                }
                // 距离相同：长度差小的优先（更可能是正确词）
                li := abs(len([]rune(result[i].Word)) - wordLen)
                lj := abs(len([]rune(result[j].Word)) - wordLen)
                if li != lj {
                        return li < lj
                }
                // 长度也相同：频率高的优先
                return result[i].Frequency > result[j].Frequency
        })

        if n > 0 && len(result) > n {
                result = result[:n]
        }
        return result
}

func abs(x int) int {
        if x < 0 {
                return -x
        }
        return x
}

// editsDelete 生成 word 的所有删除变体（编辑距离 ≤ maxDist）
// "hello", 2 → {"hello", "ello", "hllo", "helo", "hell",
//                "llo", "hlo", "hlo", "hel", ...}
func editsDelete(word string, maxDist int) []string {
        if maxDist <= 0 {
                return []string{word}
        }
        set := make(map[string]struct{})
        queue := []string{word}
        for dist := 0; dist < maxDist; dist++ {
                var next []string
                for _, w := range queue {
                        if len(w) <= 1 {
                                continue
                        }
                        for i := 0; i < len(w); i++ {
                                d := w[:i] + w[i+1:]
                                if _, ok := set[d]; !ok {
                                        set[d] = struct{}{}
                                        next = append(next, d)
                                }
                        }
                }
                queue = append(queue, next...)
        }
        // 包含原词
        set[word] = struct{}{}

        result := make([]string, 0, len(set))
        for k := range set {
                result = append(result, k)
        }
        return result
}

// editDistance 标准 Levenshtein 编辑距离
// 对中文等 UTF-8 字符串，先转换为 []rune 再调用
func editDistance(a, b string) int {
        ra, rb := []rune(a), []rune(b)
        la, lb := len(ra), len(rb)
        if la == 0 {
                return lb
        }
        if lb == 0 {
                return la
        }

        dp := make([]int, lb+1)
        for j := 0; j <= lb; j++ {
                dp[j] = j
        }
        for i := 1; i <= la; i++ {
                prev := dp[0]
                dp[0] = i
                for j := 1; j <= lb; j++ {
                        tmp := dp[j]
                        cost := 1
                        if ra[i-1] == rb[j-1] {
                                cost = 0
                        }
                        dp[j] = min3(dp[j]+1, dp[j-1]+1, prev+cost)
                        prev = tmp
                }
        }
        return dp[lb]
}

// damerauDistance Damerau-Levenshtein 距离
// 比标准 Levenshtein 多支持"相邻字符交换"操作（transposition）
// 例如 "recieve" → "receive" Levenshtein=2, Damerau=1
// 这对拼写纠错场景更友好（ie/ei, te/et 等常见错误）
func damerauDistance(a, b string) int {
        ra, rb := []rune(a), []rune(b)
        la, lb := len(ra), len(rb)
        if la == 0 {
                return lb
        }
        if lb == 0 {
                return la
        }

        // d[i][j] = edit distance between ra[:i] and rb[:j]
        d := make([][]int, la+1)
        for i := range d {
                d[i] = make([]int, lb+1)
                d[i][0] = i
        }
        for j := 0; j <= lb; j++ {
                d[0][j] = j
        }

        for i := 1; i <= la; i++ {
                for j := 1; j <= lb; j++ {
                        cost := 1
                        if ra[i-1] == rb[j-1] {
                                cost = 0
                        }
                        d[i][j] = min3(
                                d[i-1][j]+1,     // deletion
                                d[i][j-1]+1,     // insertion
                                d[i-1][j-1]+cost, // substitution
                        )
                        // Transposition (相邻交换)
                        if i > 1 && j > 1 &&
                                ra[i-1] == rb[j-2] &&
                                ra[i-2] == rb[j-1] {
                                d[i][j] = min2(d[i][j], d[i-2][j-2]+1)
                        }
                }
        }
        return d[la][lb]
}

func min3(a, b, c int) int {
        if b < a {
                a = b
        }
        if c < a {
                a = c
        }
        return a
}

func min2(a, b int) int {
        if a < b {
                return a
        }
        return b
}
