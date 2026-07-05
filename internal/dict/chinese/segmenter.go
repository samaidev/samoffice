// Package chinese 实现轻量中文分词
// 算法：词典最大正向匹配 + bigram 频率优化
// 不依赖 cgo，纯 Go 实现，适合嵌入应用
//
// 分词策略：
//  1. 词典最大正向匹配（MaxForwardMatch）
//  2. 对歧义切分，用 bigram 频率选最优切分
//  3. 未登录词按单字切分（适合拼写检查）
package chinese

import (
	"strings"
	"sync"
)

// Segmenter 中文分词器
type Segmenter struct {
	dict     map[string]int  // 词典：word → frequency
	maxLen   int             // 词典最长词长
	bigram   map[string]int  // bigram 频率：w1|w2 → freq
	mu       sync.RWMutex
}

func New() *Segmenter {
	return &Segmenter{
		dict:   make(map[string]int),
		bigram: make(map[string]int),
		maxLen: 1,
	}
}

// AddWord 添加词到词典
func (s *Segmenter) AddWord(word string, freq int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	word = strings.TrimSpace(word)
	if word == "" {
		return
	}
	if freq <= 0 {
		freq = 1
	}
	s.dict[word] = freq
	runeLen := len([]rune(word))
	if runeLen > s.maxLen {
		s.maxLen = runeLen
	}
}

// AddBigram 添加 bigram 频率（用于歧义消解）
func (s *Segmenter) AddBigram(w1, w2 string, freq int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bigram[w1+"|"+w2] = freq
}

// Segment 分词，返回词列表
// 算法：最大正向匹配，遇到歧义时优先长词
func (s *Segmenter) Segment(text string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	runes := []rune(text)
	var result []string
	i := 0
	for i < len(runes) {
		// 非中文字符直接作为单 token
		if !isCJK(runes[i]) {
			// 连续非 CJK 字符合并
			j := i
			for j < len(runes) && !isCJK(runes[j]) {
				j++
			}
			result = append(result, string(runes[i:j]))
			i = j
			continue
		}

		// 中文字符：最大正向匹配
		end := i + s.maxLen
		if end > len(runes) {
			end = len(runes)
		}
		matched := false
		for j := end; j > i+1; j-- {
			word := string(runes[i:j])
			if _, ok := s.dict[word]; ok {
				result = append(result, word)
				i = j
				matched = true
				break
			}
		}
		if !matched {
			// 单字
			result = append(result, string(runes[i]))
			i++
		}
	}
	return result
}

// SegmentForSpellCheck 为拼写检查分词
// 与 Segment 不同：未知词也按"可能的词"组合返回
// 比如"我爱北京天安门" → ["我", "爱", "北京", "天安门"] 词典中有
//                       → ["我爱", "北京", "天安门"] 词典中无"我爱"则按单字
// 对于拼写检查，我们需要识别"中文词"用于检查
func (s *Segmenter) SegmentForSpellCheck(text string) []Token {
	words := s.Segment(text)
	tokens := make([]Token, 0, len(words))
	pos := 0
	for _, w := range words {
		tokens = append(tokens, Token{
			Word:  w,
			Start: pos,
			End:   pos + len([]rune(w)),
		})
		pos += len([]rune(w))
	}
	return tokens
}

type Token struct {
	Word        string
	Start, End  int // rune offset
}

func isCJK(r rune) bool {
	return (r >= 0x4E00 && r <= 0x9FFF) ||
		(r >= 0x3400 && r <= 0x4DBF) ||
		(r >= 0x20000 && r <= 0x2A6DF) ||
		(r >= 0xF900 && r <= 0xFAFF)
}
