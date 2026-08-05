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
	"bufio"
	"encoding/gob"
	"embed"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

//go:embed dict.txt
var dictFS embed.FS

// dictCacheVersion 随词典内容/格式变化而递增；变更后旧缓存自动失效
const dictCacheVersion = 1

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

// dictData 是序列化到磁盘的词典快照，避免每次启动都重新解析 35 万词文本
type dictData struct {
	Dict   map[string]int
	Bigram map[string]int
	MaxLen int
}

func cachePath() (string, error) {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	dir = filepath.Join(dir, "samoffice")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "zh_dict_v"+strconv.Itoa(dictCacheVersion)+".gob"), nil
}

// loadCache 尝试从磁盘加载词典快照；命中且有效返回 true
func (s *Segmenter) loadCache() bool {
	p, err := cachePath()
	if err != nil {
		return false
	}
	f, err := os.Open(p)
	if err != nil {
		return false
	}
	defer f.Close()
	var d dictData
	if err := gob.NewDecoder(f).Decode(&d); err != nil {
		return false
	}
	if d.Dict == nil || len(d.Dict) == 0 {
		return false
	}
	s.dict = d.Dict
	s.bigram = d.Bigram
	if s.bigram == nil {
		s.bigram = make(map[string]int)
	}
	s.maxLen = d.MaxLen
	if s.maxLen < 1 {
		s.maxLen = 1
	}
	return true
}

// saveCache 将当前词典快照写入磁盘，供下次启动复用
func (s *Segmenter) saveCache() {
	p, err := cachePath()
	if err != nil {
		return
	}
	s.mu.RLock()
	d := dictData{Dict: s.dict, Bigram: s.bigram, MaxLen: s.maxLen}
	s.mu.RUnlock()
	f, err := os.Create(p)
	if err != nil {
		return
	}
	defer f.Close()
	_ = gob.NewEncoder(f).Encode(d)
}

// LoadBuiltin 从 embed 词典加载（jieba dict.txt，~35万词）
// 首次启动解析并缓存；之后启动直接复用缓存快照，显著加快冷启动。
// 格式：word freq pos（如 "AT&T 3 nz"），空格分隔
func (s *Segmenter) LoadBuiltin() error {
	if s.loadCache() {
		return nil
	}
	data, err := dictFS.ReadFile("dict.txt")
	if err != nil {
		return err
	}
	if err := s.ParseDict(data); err != nil {
		return err
	}
	s.saveCache()
	return nil
}

// ParseDict 解析 jieba 格式词典字节流
func (s *Segmenter) ParseDict(data []byte) error {
        scanner := bufio.NewScanner(strings.NewReader(string(data)))
        scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
        for scanner.Scan() {
                line := strings.TrimSpace(scanner.Text())
                if line == "" || strings.HasPrefix(line, "#") {
                        continue
                }
                parts := strings.Fields(line)
                if len(parts) == 0 {
                        continue
                }
                word := parts[0]
                freq := 1
                if len(parts) > 1 {
                        if n, err := strconv.Atoi(parts[1]); err == nil {
                                freq = n
                        }
                }
                s.AddWord(word, freq)
        }
        return scanner.Err()
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
        if _, ok := s.dict[word]; !ok {
                s.dict[word] = freq
        } else {
                s.dict[word] += freq
        }
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
func (s *Segmenter) Segment(text string) []string {
        s.mu.RLock()
        defer s.mu.RUnlock()

        runes := []rune(text)
        var result []string
        i := 0
        for i < len(runes) {
                if !isCJK(runes[i]) {
                        j := i
                        for j < len(runes) && !isCJK(runes[j]) {
                                j++
                        }
                        result = append(result, string(runes[i:j]))
                        i = j
                        continue
                }

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
                        result = append(result, string(runes[i]))
                        i++
                }
        }
        return result
}

// SegmentForSpellCheck 为拼写检查分词
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

// DictSize 返回词典大小
func (s *Segmenter) DictSize() int {
        s.mu.RLock()
        defer s.mu.RUnlock()
        return len(s.dict)
}

// HasWord 检查词是否在词典中
func (s *Segmenter) HasWord(word string) bool {
        s.mu.RLock()
        defer s.mu.RUnlock()
        _, ok := s.dict[word]
        return ok
}

type Token struct {
        Word        string
        Start, End  int
}

func isCJK(r rune) bool {
        return (r >= 0x4E00 && r <= 0x9FFF) ||
                (r >= 0x3400 && r <= 0x4DBF) ||
                (r >= 0x20000 && r <= 0x2A6DF) ||
                (r >= 0xF900 && r <= 0xFAFF)
}
