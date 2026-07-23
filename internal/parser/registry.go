package parser

import (
        "fmt"
        "io"
        "path/filepath"
        "strings"
        "sync"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/parser/doc"
	"github.com/zai/samoffice/internal/parser/docx"
	"github.com/zai/samoffice/internal/parser/markdown"
	"github.com/zai/samoffice/internal/parser/pptx"
	"github.com/zai/samoffice/internal/parser/xlsx"
)

// Parser 接口：所有格式解析器实现此接口
type Parser interface {
        Supported() []string
        CanParse(path string, header []byte) bool
        Parse(r io.Reader) (*core.Document, []core.Warning, error)
}

// Registry 注册中心，按扩展名自动路由
type Registry struct {
        parsers []Parser
        mu      sync.RWMutex
}

func NewRegistry() *Registry {
        r := &Registry{}
        r.Register(&docx.Parser{})
        r.Register(&doc.Parser{})
        r.Register(&xlsx.Parser{})
        r.Register(&pptx.Parser{})
        r.Register(&markdown.Parser{})
        return r
}

func (r *Registry) Register(p Parser) {
        r.mu.Lock()
        defer r.mu.Unlock()
        r.parsers = append(r.parsers, p)
}

// PickByPath 按文件路径选择解析器
func (r *Registry) PickByPath(path string) Parser {
        r.mu.RLock()
        defer r.mu.RUnlock()
        ext := strings.ToLower(filepath.Ext(path))
        for _, p := range r.parsers {
                for _, s := range p.Supported() {
                        if s == ext {
                                return p
                        }
                }
        }
        return nil
}

// ParseBytes 解析字节流，自动选择解析器
func (r *Registry) ParseBytes(path string, data []byte) (*core.Document, []core.Warning, error) {
        p := r.PickByPath(path)
        if p == nil {
                return nil, nil, fmt.Errorf("unsupported format: %s", path)
        }
        return p.Parse(strings.NewReader(string(data)))
}

// ParseReader 解析 io.Reader
func (r *Registry) ParseReader(path string, reader io.Reader) (*core.Document, []core.Warning, error) {
        p := r.PickByPath(path)
        if p == nil {
                return nil, nil, fmt.Errorf("unsupported format: %s", path)
        }
        return p.Parse(reader)
}
