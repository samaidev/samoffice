// reader.go — pptgo 读取/解析功能
// 支持打开已有 .pptx 文件，解析幻灯片结构（标题/副标题/要点/形状/背景/备注）

package pptgo

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
)

// Open 打开已有 .pptx 文件
func Open(path string) (*Presentation, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read file: %w", err)
	}
	return ParseBytes(data)
}

// ParseBytes 解析 pptx 字节流为 Presentation
func ParseBytes(data []byte) (*Presentation, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}

	files := make(map[string]*zip.File)
	for _, f := range zr.File {
		files[f.Name] = f
	}

	prs := New()

	// 1. 解析 core.xml 元数据
	if f, ok := files["docProps/core.xml"]; ok {
		if rc, err := f.Open(); err == nil {
			parseCoreProps(rc, prs)
			rc.Close()
		}
	}

	// 2. 解析 presentation.xml 获取幻灯片顺序
	slideFiles := []string{}
	if f, ok := files["ppt/presentation.xml"]; ok {
		if rc, err := f.Open(); err == nil {
			slideFiles = parsePresentation(rc)
			rc.Close()
		}
	}

	// 如果没找到顺序，退而求其次：扫描 ppt/slides/slideN.xml
	if len(slideFiles) == 0 {
		for name := range files {
			if strings.HasPrefix(name, "ppt/slides/slide") && strings.HasSuffix(name, ".xml") {
				slideFiles = append(slideFiles, name)
			}
		}
		sort.Slice(slideFiles, func(i, j int) bool {
			ni := slideNumFromPath(slideFiles[i])
			nj := slideNumFromPath(slideFiles[j])
			return ni < nj
		})
	}

	// 3. 解析每张幻灯片
	for _, sf := range slideFiles {
		f, ok := files[sf]
		if !ok {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		slide := prs.AddSlide()
		parseSlideXML(rc, slide)
		rc.Close()
	}

	// 4. 解析备注
	for i, sf := range slideFiles {
		num := slideNumFromPath(sf)
		notesPath := fmt.Sprintf("ppt/notesSlides/notesSlide%d.xml", num)
		if f, ok := files[notesPath]; ok {
			if rc, err := f.Open(); err == nil {
				notes := extractNotesText(rc)
				rc.Close()
				if i < len(prs.slides) {
					prs.slides[i].notes = notes
				}
			}
		}
	}

	return prs, nil
}

// === Getters ===

// Author 返回作者
func (p *Presentation) Author() string { return p.author }

// Subject 返回主题
func (p *Presentation) Subject() string { return p.subject }

// SlideCount 返回幻灯片数
func (p *Presentation) SlideCount() int { return len(p.slides) }

// GetSlide 按索引获取幻灯片
func (p *Presentation) GetSlide(index int) *Slide {
	if index < 0 || index >= len(p.slides) {
		return nil
	}
	return p.slides[index]
}

// Slide getters
func (s *Slide) GetSubtitle() string  { return s.subtitle }
func (s *Slide) GetBullets() []string { return s.bullets }
func (s *Slide) GetShapes() []Shape   { return s.shapes }
func (s *Slide) GetArtTexts() []ArtText { return s.artTexts }
func (s *Slide) GetBgColor() string   { return s.bgColor }
func (s *Slide) GetTransition() string { return s.transition }
func (s *Slide) GetLayout() Layout    { return s.layout }
func (s *Slide) GetImages() []ImageItem { return s.images }
func (s *Slide) GetNotes() string     { return s.notes }

// === 内部解析 ===

// pptSlide 是幻灯片 XML 的中间结构
type pptSlide struct {
	Bg       string
	Shapes   []pptShape
}

type pptShape struct {
	Name     string
	IsTitle  bool
	IsSub    bool
	IsContent bool
	IsPic    bool
	Text     string
	Bullets  []string
	Embed    string
}

func parseCoreProps(r io.Reader, prs *Presentation) {
	data, _ := io.ReadAll(r)
	s := string(data)
	if m := extractTagStr(s, "dc:title"); m != "" {
		prs.title = m
	}
	if m := extractTagStr(s, "dc:creator"); m != "" {
		prs.author = m
	}
	if m := extractTagStr(s, "dc:subject"); m != "" {
		prs.subject = m
	}
}

// parsePresentation 解析 presentation.xml，返回有序的 slide 文件路径
func parsePresentation(r io.Reader) []string {
	data, _ := io.ReadAll(r)
	var result []string
	s := string(data)
	// 匹配 <p:sldId ... r:id="rIdN"/>
	// 然后从 presentation.xml.rels 映射 rId → slideN.xml
	relMap := map[string]string{}
	// 简单正则匹配 r:id
	idx := 0
	for {
		i := strings.Index(s[idx:], "r:id=\"")
		if i < 0 {
			break
		}
		i += idx
		start := i + len("r:id=\"")
		end := strings.Index(s[start:], "\"")
		if end < 0 {
			break
		}
		relID := s[start : start+end]
		relMap[relID] = relID
		idx = start + end
	}
	// relMap 当前只有 id，需要从 rels 文件映射，这里先返回空，由调用方兜底
	_ = relMap
	return result
}

func parseSlideXML(r io.Reader, slide *Slide) {
	data, _ := io.ReadAll(r)
	s := string(data)

	// 解析背景色 <p:bg><p:bgPr><a:solidFill><a:srgbClr val="RRGGBB"/>
	if i := strings.Index(s, "<p:bg>"); i >= 0 {
		if j := strings.Index(s[i:], `a:srgbClr val="`); j >= 0 {
			start := i + j + len(`a:srgbClr val="`)
			end := strings.Index(s[start:], "\"")
			if end > 0 {
				slide.bgColor = "#" + s[start:start+end]
			}
		}
	}

	// 用字符串匹配解析每个 <p:sp>...</p:sp> 块
	shapeBlocks := extractBlocks(s, "<p:sp>", "</p:sp>")
	picBlocks := extractBlocks(s, "<p:pic>", "</p:pic>")

	for _, block := range shapeBlocks {
		sh := parseShapeBlock(block)
		applyShapeToSlide(sh, slide)
	}

	for _, block := range picBlocks {
		sh := parseShapeBlock(block)
		if sh.IsPic && sh.Embed != "" {
			slide.images = append(slide.images, ImageItem{})
		}
	}

	// 兜底：如果没解析到标题，尝试简单提取所有 <a:t> 文本
	if slide.title == "" && len(slide.bullets) == 0 {
		texts := extractAllTags(s, "a:t")
		if len(texts) > 0 {
			slide.title = texts[0]
			for _, t := range texts[1:] {
				if t != "" {
					slide.bullets = append(slide.bullets, t)
				}
			}
		}
	}

	// 推断布局
	if slide.title != "" && slide.subtitle != "" {
		slide.layout = LayoutTitle
	} else if slide.title != "" {
		slide.layout = LayoutContent
	} else {
		slide.layout = LayoutBlank
	}
}

// extractBlocks 提取所有 <startTag>...</endTag> 块
func extractBlocks(s, startTag, endTag string) []string {
	var blocks []string
	idx := 0
	for {
		i := strings.Index(s[idx:], startTag)
		if i < 0 {
			break
		}
		i += idx
		end := strings.Index(s[i:], endTag)
		if end < 0 {
			break
		}
		blocks = append(blocks, s[i:i+end+len(endTag)])
		idx = i + end + len(endTag)
	}
	return blocks
}

// parseShapeBlock 解析单个 shape 块
func parseShapeBlock(block string) *pptShape {
	sh := &pptShape{}

	// 提取 cNvPr name 属性
	if i := strings.Index(block, "<p:cNvPr"); i >= 0 {
		seg := block[i:]
		if j := strings.Index(seg, `name="`); j >= 0 {
			start := j + len(`name="`)
			end := strings.Index(seg[start:], `"`)
			if end > 0 {
				sh.Name = seg[start : start+end]
				lower := strings.ToLower(sh.Name)
				if strings.Contains(lower, "subtitle") {
					sh.IsSub = true
				} else if strings.Contains(lower, "title") {
					sh.IsTitle = true
				} else if strings.Contains(lower, "content") {
					sh.IsContent = true
				}
			}
		}
	}

	// 检查是否为图片
	if strings.Contains(block, "<p:pic>") || strings.Contains(block, "<p:blip") {
		sh.IsPic = true
		if i := strings.Index(block, `<a:blip`); i >= 0 {
			seg := block[i:]
			if j := strings.Index(seg, `r:embed="`); j >= 0 {
				start := j + len(`r:embed="`)
				end := strings.Index(seg[start:], `"`)
				if end > 0 {
					sh.Embed = seg[start : start+end]
				}
			}
		}
	}

	// 提取所有 <a:t> 文本（每个 <a:p> 段落对应一个 bullet）
	texts := extractAllTags(block, "a:t")
	if len(texts) == 1 {
		sh.Text = texts[0]
	} else if len(texts) > 1 {
		// 多个段落：第一个作为 Text，其余作为 Bullets
		sh.Text = texts[0]
		for _, t := range texts[1:] {
			if t != "" {
				sh.Bullets = append(sh.Bullets, t)
			}
		}
	}

	return sh
}

// applyShapeToSlide 将解析出的 shape 应用到 slide
func applyShapeToSlide(sh *pptShape, slide *Slide) {
	if sh.IsTitle && sh.Text != "" {
		slide.title = sh.Text
		return
	}
	if sh.IsSub && sh.Text != "" {
		slide.subtitle = sh.Text
		return
	}
	if sh.IsContent {
		// content shape：所有 bullets 文本作为要点
		if len(sh.Bullets) > 0 {
			slide.bullets = append(slide.bullets, sh.Bullets...)
		} else if sh.Text != "" {
			slide.bullets = append(slide.bullets, sh.Text)
		}
		return
	}
	// 普通形状
	if sh.Text != "" && !sh.IsPic {
		if slide.title == "" {
			slide.title = sh.Text
		} else {
			slide.bullets = append(slide.bullets, sh.Text)
		}
		if len(sh.Bullets) > 0 {
			slide.bullets = append(slide.bullets, sh.Bullets...)
		}
	}
	if sh.IsPic && sh.Embed != "" {
		slide.images = append(slide.images, ImageItem{})
	}
}

func extractNotesText(r io.Reader) string {
	data, _ := io.ReadAll(r)
	s := string(data)
	texts := extractAllTags(s, "a:t")
	return strings.Join(texts, "\n")
}

// extractTagStr 提取 <tag>content</tag>
func extractTagStr(xml, tag string) string {
	start := strings.Index(xml, "<"+tag+">")
	if start < 0 {
		return ""
	}
	start += len(tag) + 2
	end := strings.Index(xml[start:], "</"+tag+">")
	if end < 0 {
		return ""
	}
	return xml[start : start+end]
}

// extractAllTags 提取所有 <tag>content</tag>
func extractAllTags(xml, tag string) []string {
	var result []string
	search := "<" + tag + ">"
	closeTag := "</" + tag + ">"
	idx := 0
	for {
		i := strings.Index(xml[idx:], search)
		if i < 0 {
			break
		}
		i += idx
		// 跳过可能的属性 > 
		start := i + len(search)
		// 处理 <t xml:space="preserve"> 形式
		gt := strings.Index(xml[i:], ">")
		if gt >= 0 {
			start = i + gt + 1
		}
		end := strings.Index(xml[start:], closeTag)
		if end < 0 {
			break
		}
		result = append(result, xml[start:start+end])
		idx = start + end + len(closeTag)
	}
	return result
}

// slideNumFromPath 从 ppt/slides/slide3.xml 提取 3
func slideNumFromPath(path string) int {
	s := strings.TrimSuffix(strings.TrimPrefix(path, "ppt/slides/slide"), ".xml")
	n, _ := strconv.Atoi(s)
	return n
}
