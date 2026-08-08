package parser

import (
	"bytes"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"sync"

	"github.com/zai/samoffice/internal/core"
	"github.com/zai/samoffice/internal/parser/csv"
	"github.com/zai/samoffice/internal/parser/doc"
	"github.com/zai/samoffice/internal/parser/docx"
	"github.com/zai/samoffice/internal/parser/markdown"
	"github.com/zai/samoffice/internal/parser/ppt"
	"github.com/zai/samoffice/internal/parser/pptx"
	"github.com/zai/samoffice/internal/parser/xls"
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
	r.Register(&ppt.Parser{})
	r.Register(&xls.Parser{})
	r.Register(&markdown.Parser{})
	r.Register(&csv.Parser{})
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
	return r.parsePathData(path, data)
}

// ParseReader 解析 io.Reader
func (r *Registry) ParseReader(path string, reader io.Reader) (*core.Document, []core.Warning, error) {
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, nil, err
	}
	return r.parsePathData(path, data)
}

// parsePathData 中央解析入口：.doc 优先按内容嗅探，因为 SamOffice 将 .doc
// 以 OOXML(docx) 内容写出（ZIP/PK 容器）。若内容为 PK 头则走 docx 解析以保
// 留图片/公式/脚注/样式；否则回退到原生 OLE doc.Parser（真实老版 .doc）。
func (r *Registry) parsePathData(path string, data []byte) (*core.Document, []core.Warning, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".doc" {
		if len(data) >= 4 && data[0] == 'P' && data[1] == 'K' && data[2] == 0x03 && data[3] == 0x04 {
			return (&docx.Parser{}).Parse(bytes.NewReader(data))
		}
		return (&doc.Parser{}).Parse(bytes.NewReader(data))
	}
	p := r.PickByPath(path)
	if p == nil {
		return nil, nil, fmt.Errorf("unsupported format: %s", path)
	}
	return p.Parse(bytes.NewReader(data))
}
