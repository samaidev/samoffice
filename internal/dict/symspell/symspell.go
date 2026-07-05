package symspell

import (
	"sort"
	"strings"
	"sync"
)

// SymSpell 是 SymSpell 模糊匹配算法的纯 Go 实现。
// 比传统 BK-Tree 快 1000 倍，是拼写纠错的核心。
//
// 算法原理：
//   预处理：对每个词生成所有"删除变体"（编辑距离 ≤ maxDist），
//           建立 deletes → 原词列表 的哈希表
//   查询：对查询词生成所有删除变体，查哈希表，取交集后用编辑距离过滤
//
// 空间换时间：词典 10 万词、maxDist=2 时，索引约 5MB 内存

type SymSpell struct {
	maxDist      int
	deletes      map[string][]string // 删除变体 → 原词列表
	words        map[string]int      // 原词 → 频率
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

// Lookup 查询 word 的建议词，返回按 (距离, 频率) 排序的前 N 个
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
		d := editDistance(word, w)
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

	// 排序：距离升序 → 频率降序
	result := make([]Candidate, 0, len(cands))
	for w, d := range cands {
		result = append(result, Candidate{Word: w, Distance: d, Frequency: s.words[w]})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Distance != result[j].Distance {
			return result[i].Distance < result[j].Distance
		}
		return result[i].Frequency > result[j].Frequency
	})

	if n > 0 && len(result) > n {
		result = result[:n]
	}
	return result
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

// editDistance 标准编辑距离 (Levenshtein)，仅支持单字节字符
// 对中文等 UTF-8 字符串，应先转换为 []rune 再调用
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

func min3(a, b, c int) int {
	if b < a {
		a = b
	}
	if c < a {
		a = c
	}
	return a
}
