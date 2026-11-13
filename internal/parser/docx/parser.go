// Package docx 实现 OOXML .docx 格式的自研解析器
// 容错策略：ZIP 容错解压 + XML 宽松解析 + 未知元素保留
package docx

import (
        "archive/zip"
        "bytes"
        "encoding/base64"
        "encoding/xml"
        "fmt"
        "io"
        "math"
        "strconv"
        "strings"

        "github.com/zai/samoffice/internal/core"
)

// Parser 实现 core.Parser 接口
type Parser struct{}

func New() *Parser { return &Parser{} }

func (p *Parser) Supported() []string { return []string{".docx"} }

func (p *Parser) CanParse(path string, header []byte) bool {
        return strings.HasSuffix(strings.ToLower(path), ".docx") ||
                (len(header) >= 4 && bytes.Equal(header[:2], []byte{0x50, 0x4B})) // PK
}

// Parse 解析 docx 字节流为 UDM
// 返回 (document, warnings, error)，永不 panic
func (p *Parser) Parse(r io.Reader) (*core.Document, []core.Warning, error) {
        warnings := []core.Warning{}

        // 1. 读取全部字节（zip 需要 ReaderAt）
        data, err := io.ReadAll(r)
        if err != nil {
                return nil, warnings, fmt.Errorf("read docx: %w", err)
        }

        // 2. 容错 ZIP 解压
        zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
        if err != nil {
                return nil, warnings, fmt.Errorf("open zip: %w", err)
        }

        // 3. 定位关键文件
        files := make(map[string]*zip.File)
        for _, f := range zr.File {
                files[f.Name] = f
        }
        docFile, ok := files["word/document.xml"]
        if !ok {
                // 尝试备用路径
                for name, f := range files {
                        if strings.HasSuffix(name, "document.xml") {
                                docFile = f
                                break
                        }
                }
                if docFile == nil {
                        return nil, warnings, fmt.Errorf("missing word/document.xml")
                }
                warnings = append(warnings, core.Warning{
                        Level: "warn", Stage: "unzip",
                        Message: "document.xml path is non-standard: " + docFile.Name,
                })
        }

        // 4. 解析核心 XML
        doc := &core.Document{
                Meta:   core.Meta{},
                Blocks: []core.Block{},
                Raw:    make(map[string]any),
        }

        // 提取元数据
        if coreFile, ok := files["docProps/core.xml"]; ok {
                if rc, err := coreFile.Open(); err == nil {
                        parseCoreProps(rc, &doc.Meta)
                        rc.Close()
                }
        }

        // 提取 SamOffice 文档保护（密码锁定）信息
        if protectFile, ok := files["docProps/samoffice_protect.xml"]; ok {
                if rc, err := protectFile.Open(); err == nil {
                        if p, perr := parseProtect(rc); perr == nil {
                                doc.Protect = p
                        }
                        rc.Close()
                }
        }

                // 解析脚注（word/footnotes.xml），id -> 文本
                footnotes := parseFootnotes(files)

                // 解析批注（word/comments.xml）→ doc.Comments
                if cs := parseComments(files); len(cs) > 0 {
                        doc.Comments = cs
                }

                // 预载 document.xml 的图片资源（rels + media）与列表编号格式
                media := loadDocMedia(files, docFile.Name)
                numFmt := parseNumbering(files)

                // 解析 document.xml
                if rc, err := docFile.Open(); err != nil {
                        return nil, warnings, fmt.Errorf("open document.xml: %w", err)
                } else {
                        defer rc.Close()
                        blocks, warns, fn, ntf := parseDocumentXMLCtx(rc, footnotes, media, numFmt)
                        doc.Blocks = blocks
                        warnings = append(warnings, warns...)
                        // 文档含脚注引用时，在正文末尾追加脚注区
                        if len(fn) > 0 {
                                items := make([]core.FootnoteItem, 0, len(fn))
                                for num := 1; num <= len(fn); num++ {
                                        fid := ntf[num]
                                        items = append(items, core.FootnoteItem{
                                                Num:    num,
                                                Inline: []core.Inline{core.Text{Content: footnotes[fid]}},
                                        })
                                }
                                doc.Blocks = append(doc.Blocks, &core.FootnoteSection{Type: "footnote_section", Items: items})
                        }
                }

        // 解析页脚中的 PAGE / NUMPAGES 域，生成页码配置
        if pn := extractPageNumber(files); pn != nil {
                doc.PageNumber = pn
        }
        // 解析页眉/页脚富文本（文字 + 主导样式），供前端展示/编辑；
        // 仅含页码域的页眉页脚不算文字内容（由 PageNumberConfig 负责）
        doc.Header, doc.Footer = extractHeaderFooter(files)

        // 解析 sectPr 的纸张/方向/页边距/分栏，持久化到 UDM.pageSetup，
        // 否则打开横向/自定义纸张的文档再保存会退回默认 A4 纵向。
        if ps := parsePageSetup(docFile); ps != nil {
                doc.PageSetup = ps
        }

        return doc, warnings, nil
}

// parsePageSetup 从 document.xml 的 sectPr 提取 w:pgSz / w:pgMar / w:cols。
func parsePageSetup(docFile *zip.File) *core.PageSetup {
        if docFile == nil {
                return nil
        }
        rc, err := docFile.Open()
        if err != nil {
                return nil
        }
        defer rc.Close()
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        ps := &core.PageSetup{}
        inSectPr := false
        depth := 0
        for {
                tok, err := dec.Token()
                if err != nil {
                        break
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        if t.Name.Local == "sectPr" {
                                // 文档可能有多个 sectPr（分节符）；以最后一个（全局）为准
                                ps = &core.PageSetup{}
                                inSectPr = true
                                depth = 0
                                continue
                        }
                        if !inSectPr {
                                continue
                        }
                        depth++
                        switch t.Name.Local {
                        case "pgSz":
                                for _, a := range t.Attr {
                                        switch a.Name.Local {
                                        case "w":
                                                ps.WidthTwips = atoiSafe(a.Value)
                                        case "h":
                                                ps.HeightTwips = atoiSafe(a.Value)
                                        case "orient":
                                                ps.Orientation = a.Value
                                        }
                                }
                        case "pgMar":
                                for _, a := range t.Attr {
                                        switch a.Name.Local {
                                        case "top":
                                                ps.MarginTop = atoiSafe(a.Value)
                                        case "right":
                                                ps.MarginRight = atoiSafe(a.Value)
                                        case "bottom":
                                                ps.MarginBottom = atoiSafe(a.Value)
                                        case "left":
                                                ps.MarginLeft = atoiSafe(a.Value)
                                        }
                                }
                        case "cols":
                                for _, a := range t.Attr {
                                        if a.Name.Local == "num" {
                                                ps.Cols = atoiSafe(a.Value)
                                        }
                                }
                        }
                case xml.EndElement:
                        if t.Name.Local == "sectPr" {
                                inSectPr = false
                                depth = 0
                                continue
                        }
                        if inSectPr && depth > 0 {
                                depth--
                        }
                }
        }
        if ps.WidthTwips == 0 && ps.HeightTwips == 0 {
                return nil
        }
        return ps
}

func atoiSafe(s string) int {
        n := 0
        for _, ch := range s {
                if ch < '0' || ch > '9' {
                        return n
                }
                n = n*10 + int(ch-'0')
        }
        return n
}

// parseDocumentXML 宽松解析 document.xml，提取块级内容（无图片/列表上下文的兼容入口）
func parseDocumentXML(r io.Reader, footnotes map[string]string) ([]core.Block, []core.Warning, map[string]int, map[int]string) {
        return parseDocumentXMLCtx(r, footnotes, nil, nil)
}

// parseDocumentXMLCtx 同上，另带图片资源（media）与列表编号格式（numFmt）上下文：
// media 供 run 内 w:drawing 读取嵌入图片；numFmt 供连续段落聚合为 Word 列表。
func parseDocumentXMLCtx(r io.Reader, footnotes map[string]string, media *docMedia, numFmt map[int]map[int]string) ([]core.Block, []core.Warning, map[string]int, map[int]string) {
        dec := xml.NewDecoder(r)
        dec.Strict = false
        dec.AutoClose = xml.HTMLAutoClose
        dec.Entity = xml.HTMLEntity

        var blocks []core.Block
        var warnings []core.Warning
        fn := map[string]int{}
        ntf := map[int]string{}
        depth := 0
        // 列表聚合：连续相同 (numId,ilvl) 的段落并入同一 core.BulletList
        var curList *core.BulletList
        var curNumID, curIlvl int
        flushList := func() {
                if curList != nil && len(curList.Items) > 0 {
                        blocks = append(blocks, curList)
                }
                curList = nil
        }

        for {
                tok, err := dec.Token()
                if err == io.EOF {
                        break
                }
                if err != nil {
                        warnings = append(warnings, core.Warning{
                                Level: "warn", Stage: "xml",
                                Message: "xml token error: " + err.Error(),
                        })
                        break
                }

                switch t := tok.(type) {
                case xml.StartElement:
                        depth++
                        // 进入段落
                        if t.Name.Local == "p" && t.Name.Space == "http://schemas.openxmlformats.org/wordprocessingml/2006/main" {
                                var np numPrInfo
                                for _, b := range parseParagraph(dec, footnotes, fn, ntf, media, &np) {
                                        if b == nil {
                                                continue
                                        }
                                        // numId>0 的段落聚合进列表；其余块先冲刷当前列表再追加
                                        if p, ok := b.(*core.Paragraph); ok && np.NumID > 0 {
                                                fmtName := ""
                                                if lvls, ok2 := numFmt[np.NumID]; ok2 {
                                                        fmtName = lvls[np.Ilvl]
                                                }
                                                if fmtName == "" {
                                                        fmtName = "bullet" // numbering.xml 缺失时按项目符号兜底
                                                }
                                                ordered := fmtName != "bullet" && fmtName != "none"
                                                if curList == nil || curNumID != np.NumID || curIlvl != np.Ilvl || curList.Ordered != ordered {
                                                        flushList()
                                                        curList = &core.BulletList{Items: [][]core.Block{}, Ordered: ordered}
                                                        curNumID, curIlvl = np.NumID, np.Ilvl
                                                }
                                                curList.Items = append(curList.Items, []core.Block{p})
                                                continue
                                        }
                                        flushList()
                                        blocks = append(blocks, b)
                                }
                                depth--
                        }
                        if t.Name.Local == "tbl" && t.Name.Space == "http://schemas.openxmlformats.org/wordprocessingml/2006/main" {
                                tbl := parseTable(dec, footnotes, fn, ntf, media)
                                if tbl != nil {
                                        flushList()
                                        blocks = append(blocks, tbl)
                                }
                                depth--
                        }
                case xml.EndElement:
                        depth--
                }
                }
        flushList()
        return blocks, warnings, fn, ntf
        }

// parseProtect 解析 docProps/samoffice_protect.xml，返回文档保护配置。
func parseProtect(r io.Reader) (*core.DocumentProtect, error) {
        dec := xml.NewDecoder(r)
        var (
                inEnabled bool
                inHash    bool
                enabled   bool
                hash      strings.Builder
        )
        for {
                tok, err := dec.Token()
                if err != nil {
                        break
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        switch t.Name.Local {
                        case "enabled":
                                inEnabled = true
                        case "hash":
                                inHash = true
                        }
                case xml.CharData:
                        if inEnabled {
                                enabled = strings.EqualFold(strings.TrimSpace(string(t)), "true")
                                inEnabled = false
                        }
                        if inHash {
                                hash.Write(t)
                                inHash = false
                        }
                case xml.EndElement:
                        if t.Name.Local == "samProtect" {
                                return &core.DocumentProtect{Enabled: enabled, Hash: strings.TrimSpace(hash.String())}, nil
                        }
                }
        }
        return &core.DocumentProtect{Enabled: enabled, Hash: strings.TrimSpace(hash.String())}, nil
}

// parseFootnotes 从 word/footnotes.xml 提取脚注 id -> 文本。
// 分隔符脚注（id 为 -1 / 0）会被跳过。
func parseFootnotes(files map[string]*zip.File) map[string]string {
        result := map[string]string{}
        f, ok := files["word/footnotes.xml"]
        if !ok {
                return result
        }
        rc, err := f.Open()
        if err != nil {
                return result
        }
        defer rc.Close()
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        dec.AutoClose = xml.HTMLAutoClose
        dec.Entity = xml.HTMLEntity
        var curID string
        var curText strings.Builder
        inFootnote := false
        for {
                tok, err := dec.Token()
                if err == io.EOF {
                        break
                }
                if err != nil {
                        break
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        if t.Name.Local == "footnote" {
                                curID = ""
                                for _, a := range t.Attr {
                                        if a.Name.Local == "id" {
                                                curID = a.Value
                                        }
                                }
                                curText.Reset()
                                inFootnote = true
                        } else if t.Name.Local == "t" && inFootnote {
                                curText.WriteString(readCharData(dec))
                        }
                case xml.EndElement:
                        if t.Name.Local == "footnote" && inFootnote {
                                if curID != "-1" && curID != "0" {
                                        result[curID] = strings.TrimSpace(curText.String())
                                }
                                inFootnote = false
                        }
                }
        }
        return result
}

// parseComments 读取 word/comments.xml（w:comment 的 w:id/w:author + w:t 文本）
// → core.Comment 列表；文件缺失时返回 nil。
func parseComments(files map[string]*zip.File) []core.Comment {
        f, ok := files["word/comments.xml"]
        if !ok {
                return nil
        }
        rc, err := f.Open()
        if err != nil {
                return nil
        }
        defer rc.Close()
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        dec.AutoClose = xml.HTMLAutoClose
        dec.Entity = xml.HTMLEntity
        var out []core.Comment
        var curID, curAuthor string
        var curText strings.Builder
        inComment := false
        for {
                tok, err := dec.Token()
                if err == io.EOF {
                        break
                }
                if err != nil {
                        break
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        if t.Name.Local == "comment" {
                                curID, curAuthor = "", ""
                                for _, a := range t.Attr {
                                        switch a.Name.Local {
                                        case "id":
                                                curID = a.Value
                                        case "author":
                                                curAuthor = a.Value
                                        }
                                }
                                curText.Reset()
                                inComment = true
                        } else if t.Name.Local == "t" && inComment {
                                curText.WriteString(readCharData(dec))
                        }
                case xml.EndElement:
                        if t.Name.Local == "comment" && inComment {
                                out = append(out, core.Comment{
                                        ID:      curID,
                                        Author:  curAuthor,
                                        Content: strings.TrimSpace(curText.String()),
                                })
                                inComment = false
                        }
                }
        }
        return out
}

// numPrInfo 记录段落 pPr/numPr 的列表编号引用（numId/ilvl），
// 由 parseParagraph 经 numOut 回传，供 parseDocumentXMLCtx 聚合连续列表段落。
type numPrInfo struct {
        NumID int
        Ilvl  int
}

// parseNumbering 解析 word/numbering.xml，建立 numId → (ilvl → numFmt) 映射。
// Word 结构：w:num w:numId → 子元素 w:abstractNumId w:val；
// w:abstractNum w:abstractNumId → w:lvl w:ilvl → w:numFmt w:val。
func parseNumbering(files map[string]*zip.File) map[int]map[int]string {
        out := map[int]map[int]string{}
        f, ok := files["word/numbering.xml"]
        if !ok {
                return out
        }
        rc, err := f.Open()
        if err != nil {
                return out
        }
        defer rc.Close()
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        dec.AutoClose = xml.HTMLAutoClose
        dec.Entity = xml.HTMLEntity
        abstractFmt := map[int]map[int]string{} // abstractNumId → ilvl → numFmt
        numToAbstract := map[int]int{}          // numId → abstractNumId
        curAbstract, curNum, curLvl := -1, -1, -1
        for {
                tok, err := dec.Token()
                if err == io.EOF {
                        break
                }
                if err != nil {
                        break
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        switch t.Name.Local {
                        case "abstractNum":
                                curAbstract = atoiSafe(attrOf(t, "abstractNumId"))
                                curNum, curLvl = -1, -1
                        case "num":
                                curNum = atoiSafe(attrOf(t, "numId"))
                                curAbstract, curLvl = -1, -1
                        case "lvl":
                                if curAbstract >= 0 {
                                        curLvl = atoiSafe(attrOf(t, "ilvl"))
                                }
                        case "numFmt":
                                v := attrOf(t, "val")
                                if curAbstract >= 0 && curLvl >= 0 {
                                        m := abstractFmt[curAbstract]
                                        if m == nil {
                                                m = map[int]string{}
                                                abstractFmt[curAbstract] = m
                                        }
                                        m[curLvl] = v
                                }
                        case "abstractNumId": // <w:num><w:abstractNumId w:val="0"/>（值在 w:val 属性）
                                if curNum >= 0 {
                                        numToAbstract[curNum] = atoiSafe(attrOf(t, "val"))
                                }
                        }
                case xml.EndElement:
                        switch t.Name.Local {
                        case "abstractNum":
                                curAbstract = -1
                        case "num":
                                curNum = -1
                        case "lvl":
                                curLvl = -1
                        }
                }
        }
        for numID, absID := range numToAbstract {
                if m, ok := abstractFmt[absID]; ok {
                        out[numID] = m
                }
        }
        return out
}

// attrOf 取元素的指定本地名属性值（缺失返回空串）
func attrOf(t xml.StartElement, name string) string {
        for _, a := range t.Attr {
                if a.Name.Local == name {
                        return a.Value
                }
        }
        return ""
}

// wordHighlightHex 将 Word 高亮命名色映射为 #RRGGBB；none/未知返回 ""。
func wordHighlightHex(name string) string {
        switch strings.ToLower(strings.TrimSpace(name)) {
        case "yellow":
                return "#FFFF00"
        case "green":
                return "#00FF00"
        case "cyan":
                return "#00FFFF"
        case "magenta":
                return "#FF00FF"
        case "blue":
                return "#0000FF"
        case "red":
                return "#FF0000"
        case "black":
                return "#000000"
        case "white":
                return "#FFFFFF"
        case "darkyellow":
                return "#808000"
        case "darkblue":
                return "#00008B"
        case "darkcyan":
                return "#008B8B"
        case "darkmagenta":
                return "#8B008B"
        case "darkred":
                return "#8B0000"
        case "darkgray", "darkgrey":
                return "#A9A9A9"
        case "lightgray", "lightgrey":
                return "#D3D3D3"
        default:
                return ""
        }
}

// readPBdr 消费 <w:pBdr> 子树，把四方向边框聚合为写器 paraBorderXML 认识的
// props.border 字符串：唯一底边且为红头线（C00000, sz=12）时输出 "redBottom"，
// 其余按 top/left/bottom/right 方向名空格组合输出（与写器字符串形态互逆）。
func readPBdr(dec *xml.Decoder) string {
        type sideSpec struct {
                color string
                sz    int
        }
        sides := map[string]sideSpec{}
        for {
                tok, err := dec.Token()
                if err != nil {
                        return ""
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        name := t.Name.Local
                        if name == "top" || name == "bottom" || name == "left" || name == "right" {
                                s := sideSpec{}
                                none := false
                                for _, a := range t.Attr {
                                        switch a.Name.Local {
                                        case "color":
                                                s.color = a.Value
                                        case "sz":
                                                s.sz = atoiSafe(a.Value)
                                        case "val":
                                                if strings.EqualFold(a.Value, "none") {
                                                        none = true
                                                }
                                        }
                                }
                                if !none {
                                        sides[name] = s
                                } else {
                                        delete(sides, name)
                                }
                        }
                case xml.EndElement:
                        if t.Name.Local == "pBdr" {
                                if len(sides) == 1 {
                                        if s, ok := sides["bottom"]; ok {
                                                if strings.EqualFold(s.color, "C00000") && s.sz == 12 {
                                                        return "redBottom"
                                                }
                                        }
                                }
                                var names []string
                                for _, n := range []string{"top", "left", "bottom", "right"} {
                                        if _, ok := sides[n]; ok {
                                                names = append(names, n)
                                        }
                                }
                                return strings.Join(names, " ")
                        }
                }
        }
}

// docMedia 保存 document.xml 的图片解析上下文：rels 映射与 zip 文件表，
// 供 run 内 w:drawing 的 a:blip r:embed 取回媒体字节。
type docMedia struct {
        baseDir string            // document.xml 所在目录（如 "word"）
        rels    map[string]string // rId → Target（相对 baseDir 或包内绝对路径）
        files   map[string]*zip.File
}

// loadDocMedia 预载 document.xml 对应 rels 文件的关系表（rId → Target）。
func loadDocMedia(files map[string]*zip.File, docPath string) *docMedia {
        m := &docMedia{rels: map[string]string{}, files: files}
        m.baseDir = "word"
        base := docPath
        if i := strings.LastIndex(docPath, "/"); i >= 0 {
                m.baseDir = docPath[:i]
                base = docPath[i+1:]
        }
        rf, ok := files[m.baseDir + "/_rels/" + base + ".rels"]
        if !ok {
                return m
        }
        rc, err := rf.Open()
        if err != nil {
                return m
        }
        defer rc.Close()
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        for {
                tok, err := dec.Token()
                if err != nil {
                        break
                }
                if t, ok := tok.(xml.StartElement); ok && t.Name.Local == "Relationship" {
                        id, target := "", ""
                        for _, a := range t.Attr {
                                switch a.Name.Local {
                                case "Id":
                                        id = a.Value
                                case "Target":
                                        target = a.Value
                                }
                        }
                        if id != "" && target != "" {
                                m.rels[id] = target
                        }
                }
        }
        return m
}

// dataURI 按 r:embed 关系取回媒体字节并编码为 data URL（找不到返回 ok=false）。
func (m *docMedia) dataURI(rid string) (string, bool) {
        if m == nil {
                return "", false
        }
        target, ok := m.rels[rid]
        if !ok {
                return "", false
        }
        if strings.HasPrefix(target, "/") {
                p := strings.TrimPrefix(target, "/")
                f, ok := m.files[p]
                if !ok {
                        return "", false
                }
                return readMediaFile(f, p)
        }
        // 相对 baseDir 逐层消化 "../"
        stack := make([]string, 0, 8)
        for _, p := range strings.Split(m.baseDir+"/"+target, "/") {
                switch p {
                case "", ".":
                        // skip
                case "..":
                        if len(stack) > 0 {
                                stack = stack[:len(stack)-1]
                        }
                default:
                        stack = append(stack, p)
                }
        }
        if len(stack) == 0 {
                return "", false
        }
        p := strings.Join(stack, "/")
        f, ok := m.files[p]
        if !ok {
                return "", false
        }
        return readMediaFile(f, p)
}

// readMediaFile 读取 zip 内媒体字节并按扩展名编码为 data URL
func readMediaFile(f *zip.File, path string) (string, bool) {
        rc, err := f.Open()
        if err != nil {
                return "", false
        }
        defer rc.Close()
        raw, err := io.ReadAll(rc)
        if err != nil {
                return "", false
        }
        return "data:" + mediaMime(path) + ";base64," + base64.StdEncoding.EncodeToString(raw), true
}

// mediaMime 按扩展名推断媒体 MIME 类型
func mediaMime(path string) string {
        lower := strings.ToLower(path)
        switch {
        case strings.HasSuffix(lower, ".png"):
                return "image/png"
        case strings.HasSuffix(lower, ".jpg"), strings.HasSuffix(lower, ".jpeg"):
                return "image/jpeg"
        case strings.HasSuffix(lower, ".gif"):
                return "image/gif"
        case strings.HasSuffix(lower, ".bmp"):
                return "image/bmp"
        case strings.HasSuffix(lower, ".webp"):
                return "image/webp"
        case strings.HasSuffix(lower, ".tiff"), strings.HasSuffix(lower, ".tif"):
                return "image/tiff"
        default:
                return "application/octet-stream"
        }
}

// emuToPx EMU → px（9525 EMU = 1px @96dpi，与写器 pxToEMU 互逆），非法输入返回 0。
func emuToPx(emu string) float64 {
        v, err := strconv.ParseFloat(strings.TrimSpace(emu), 64)
        if err != nil || v <= 0 {
                return 0
        }
        return math.Round(v/9525*100) / 100
}

// readDrawing 流式消费 <w:drawing> 子树，抓取 wp:inline|wp:anchor 下的
// a:blip r:embed 与 wp:extent 的 cx/cy，经 rels→media 还原为 data URI，
// 返回 core.InlineImage（宽高按 EMU/9525 转 px）；无图片时返回 nil。
func readDrawing(dec *xml.Decoder, media *docMedia) *core.InlineImage {
        embed, cx, cy := "", "", ""
        depth := 1
        for depth > 0 {
                tok, err := dec.Token()
                if err != nil {
                        return nil
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        depth++
                        switch t.Name.Local {
                        case "blip":
                                if embed == "" {
                                        embed = attrOf(t, "embed")
                                }
                        case "extent":
                                if cx == "" {
                                        cx = attrOf(t, "cx")
                                        cy = attrOf(t, "cy")
                                }
                        }
                case xml.EndElement:
                        depth--
                }
        }
        if embed == "" {
                return nil
        }
        src, ok := media.dataURI(embed)
        if !ok {
                return nil
        }
        return &core.InlineImage{
                Src:    src,
                Width:  emuToPx(cx),
                Height: emuToPx(cy),
        }
}

// headingLevel 根据 Word 内置标题样式 ID（Heading1..Heading9）推断标题级别，
// 非标题样式返回 0。大小写均可识别（Heading1 / heading1）。
func headingLevel(style string) int {
        if style == "" {
                return 0
        }
        const prefix = "heading"
        lower := strings.ToLower(style)
        if !strings.HasPrefix(lower, prefix) {
                return 0
        }
        n, err := strconv.Atoi(strings.TrimPrefix(lower, prefix))
        if err != nil || n < 1 || n > 9 {
                return 0
        }
        return n
}

// parseParagraph 解析 <w:p> 段落。若段落内含 OMML 公式，则返回 *core.Math 块。
// 返回 []core.Block：可能包含其前/后的分页符块（pageBreakBefore / w:br type=page）。
func parseParagraph(dec *xml.Decoder, footnotes map[string]string, fn map[string]int, ntf map[int]string, media *docMedia, numOut *numPrInfo) []core.Block {
        para := &core.Paragraph{Inline: []core.Inline{}}
        var inRun bool
        var curText core.Text
        hasMath := false
        var mathXML strings.Builder
        leadingPageBreak := false  // pageBreakBefore：段前分页
        trailingPageBreak := false // w:br type="page"：段后分页
        inPPr := false // 当前是否处于 <w:pPr> 内（用于区分段落属性与 run 属性的同名元素，如 w:spacing）
        inNumPr := false   // 当前是否处于 <w:numPr> 内（列表编号引用）
        paraNum := numPrInfo{} // 段落的 numId/ilvl，经 numOut 回传给调用方聚合列表
        setProp := func(k string, v any) {
                if para.Props == nil {
                        para.Props = map[string]any{}
                }
                para.Props[k] = v
        }

        for {
                tok, err := dec.Token()
                if err != nil {
                        return []core.Block{para}
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        switch t.Name.Local {
                        case "pPr":
                                inPPr = true
                        case "numPr": // 列表编号引用（容器，子元素 ilvl/numId）
                                if inPPr {
                                        inNumPr = true
                                        paraNum = numPrInfo{}
                                }
                        case "ilvl": // 列表级别
                                if inNumPr {
                                        for _, a := range t.Attr {
                                                if a.Name.Local == "val" {
                                                        paraNum.Ilvl = atoiSafe(a.Value)
                                                }
                                        }
                                }
                        case "numId": // 列表编号 id（0 表示无编号）
                                if inNumPr {
                                        for _, a := range t.Attr {
                                                if a.Name.Local == "val" {
                                                        paraNum.NumID = atoiSafe(a.Value)
                                                }
                                        }
                                }
                        case "r": // <w:r> run
                                inRun = true
                                curText = core.Text{}
                case "t": // <w:t> text
                        if inRun {
                                text := readCharData(dec)
                                curText.Content += text
                        }
                case "footnoteReference": // 脚注引用标记 <w:footnoteReference w:id=".."/>
                        if inRun && curText.Content != "" {
                                // 先flush 已在 run 内的文本，保证引用标记顺序正确
                                para.Inline = append(para.Inline, curText)
                                curText = core.Text{}
                        }
                        var fid string
                        for _, a := range t.Attr {
                                if a.Name.Local == "id" {
                                        fid = a.Value
                                }
                        }
                        if _, ok := fn[fid]; !ok {
                                fn[fid] = len(fn) + 1
                                ntf[fn[fid]] = fid
                        }
                        num := fn[fid]
                        para.Inline = append(para.Inline, &core.FootnoteRef{Type: "footnote", Num: num, Content: footnotes[fid]})
                        case "b": // bold
                                if inRun {
                                        curText.Bold = readOnOffAttr(t)
                                }
                        case "i":
                                if inRun {
                                        curText.Italic = readOnOffAttr(t)
                                }
                case "u":
                        if inRun {
                                curText.Under = true
                        }
                case "vertAlign": // 上下标
                        if inRun {
                                for _, a := range t.Attr {
                                        if a.Name.Local == "val" {
                                                switch strings.ToLower(a.Value) {
                                                case "superscript":
                                                        curText.Superscript = true
                                                case "subscript":
                                                        curText.Subscript = true
                                                }
                                        }
                                }
                        }
                case "strike": // 删除线（on/off）
                        if inRun {
                                curText.Strike = readOnOffAttr(t)
                        }
                case "color": // 字体颜色（auto 跳过，补 # 前缀归一）
                        if inRun {
                                for _, a := range t.Attr {
                                        if a.Name.Local == "val" && a.Value != "" && !strings.EqualFold(a.Value, "auto") {
                                                v := a.Value
                                                if !strings.HasPrefix(v, "#") {
                                                        v = "#" + v
                                                }
                                                curText.Color = v
                                        }
                                }
                        }
                case "highlight": // 高亮（Word 命名色 → #RRGGBB）
                        if inRun {
                                for _, a := range t.Attr {
                                        if a.Name.Local == "val" {
                                                if hex := wordHighlightHex(a.Value); hex != "" {
                                                        curText.Highlight = hex
                                                }
                                        }
                                }
                        }
                case "commentReference": // 批注引用 <w:commentReference w:id=".."/>
                        if inRun {
                                for _, a := range t.Attr {
                                        if a.Name.Local == "id" && a.Value != "" {
                                                curText.CommentID = a.Value
                                        }
                                }
                        }
                case "drawing": // DrawingML 图片（wp:inline|wp:anchor → a:blip）
                        if im := readDrawing(dec, media); im != nil {
                                // 先 flush run 内已有文本，保证图片插入位置正确
                                if curText.Content != "" {
                                        para.Inline = append(para.Inline, curText)
                                        curText = core.Text{}
                                }
                                para.Inline = append(para.Inline, *im)
                        }
                case "pict": // VML 图片/文本框：整棵子树跳过（不支持解析）
                        collectElement(dec, &strings.Builder{}, t.Name.Local)
                case "br": // 换行；type="page" 表示分页符
                        if inRun {
                                for _, a := range t.Attr {
                                        if a.Name.Local == "type" && strings.EqualFold(a.Value, "page") {
                                                trailingPageBreak = true
                                        }
                                }
                        }
                case "rFonts": // 字体名：优先 eastAsia（中文字体），其次 ascii/hAnsi
                        if inRun {
                                for _, a := range t.Attr {
                                        switch a.Name.Local {
                                        case "eastAsia":
                                                if a.Value != "" {
                                                        curText.Font = a.Value
                                                }
                                        case "ascii", "hAnsi":
                                                if curText.Font == "" && a.Value != "" {
                                                        curText.Font = a.Value
                                                }
                                        }
                                }
                        }
                case "sz", "szCs": // 字号（半磅 → 磅）
                        if inRun {
                                for _, a := range t.Attr {
                                        if a.Name.Local == "val" && a.Value != "" {
                                                if v, err := strconv.ParseFloat(a.Value, 64); err == nil && v > 0 {
                                                        curText.FontSize = v / 2
                                                }
                                        }
                                }
                        }
                case "pStyle": // paragraph style
                                for _, a := range t.Attr {
                                        if a.Name.Local == "val" {
                                                para.Style = a.Value
                                        }
                                }
                        case "jc": // justify/align
                                for _, a := range t.Attr {
                                        if a.Name.Local == "val" {
                                                para.Align = a.Value
                                        }
                                }
                        case "ind": // 缩进（仅在 pPr 上下文）
                                if !inPPr {
                                        break
                                }
                                var leftTw, rightTw, firstTw, hangTw, leftCh, firstCh, hangCh float64
                                for _, a := range t.Attr {
                                        f, _ := strconv.ParseFloat(a.Value, 64)
                                        switch a.Name.Local {
                                        case "left":
                                                leftTw = f
                                        case "right":
                                                rightTw = f
                                        case "firstLine":
                                                firstTw = f
                                        case "hanging":
                                                hangTw = f
                                        case "leftChars":
                                                leftCh = f
                                        case "firstLineChars":
                                                firstCh = f
                                        case "hangingChars":
                                                hangCh = f
                                        }
                                }
                                // 优先使用字符单位，否则用 twips（1 字符 ≈ 240twips @12pt）
                                if leftCh != 0 {
                                        setProp("indentLeft", leftCh/100)
                                } else if leftTw != 0 {
                                        setProp("indentLeft", leftTw/240)
                                }
                                if rightTw != 0 {
                                        setProp("indentRight", rightTw/240)
                                }
                                if firstCh != 0 {
                                        setProp("firstLine", firstCh/100)
                                } else if firstTw != 0 {
                                        setProp("firstLine", firstTw/240)
                                }
                                if hangCh != 0 {
                                        setProp("hanging", hangCh/100)
                                } else if hangTw != 0 {
                                        setProp("hanging", hangTw/240)
                                }
                        case "spacing": // 段前/段后/行距（仅在 pPr 上下文）
                                if !inPPr {
                                        break
                                }
                                var before, after, line float64
                                rule := ""
                                for _, a := range t.Attr {
                                        f, _ := strconv.ParseFloat(a.Value, 64)
                                        switch a.Name.Local {
                                        case "before":
                                                before = f
                                        case "after":
                                                after = f
                                        case "line":
                                                line = f
                                        case "lineRule":
                                                rule = a.Value
                                        }
                                }
                                if before != 0 {
                                        setProp("spaceBefore", before/20) // twips → pt
                                }
                                if after != 0 {
                                        setProp("spaceAfter", after/20)
                                }
                                if line != 0 {
                                        if rule == "exact" || rule == "atLeast" {
                                                setProp("lineHeight", fmt.Sprintf("%.0fpt", line/20))
                                        } else {
                                                mult := line / 240.0
                                                setProp("lineHeight", strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", mult), "0"), "."))
                                        }
                                }
                        case "keepLines":
                                if inPPr {
                                        setProp("keepLines", readOnOffAttr(t))
                                }
                        case "pBdr": // 段落边框（容器，聚合为写器 paraBorderXML 认识的 props.border 字符串）
                                if inPPr {
                                        if border := readPBdr(dec); border != "" {
                                                setProp("border", border)
                                        }
                                }
                        case "shd": // 段落底纹（w:fill → props.shading）
                                if inPPr {
                                        for _, a := range t.Attr {
                                                if a.Name.Local == "fill" {
                                                        fill := strings.TrimSpace(a.Value)
                                                        if fill != "" && !strings.EqualFold(fill, "auto") {
                                                                if !strings.HasPrefix(fill, "#") {
                                                                        fill = "#" + fill
                                                                }
                                                                setProp("shading", fill)
                                                        }
                                                }
                                        }
                                }
                        case "keepNext":
                                if inPPr {
                                        setProp("keepWithNext", readOnOffAttr(t))
                                }
                        case "pageBreakBefore":
                                if inPPr {
                                        setProp("pageBreakBefore", readOnOffAttr(t))
                                        if readOnOffAttr(t) {
                                                leadingPageBreak = true
                                        }
                                }
                        case "outlineLvl":
                                if inPPr {
                                        for _, a := range t.Attr {
                                                if a.Name.Local == "val" {
                                                        if v, err := strconv.Atoi(a.Value); err == nil {
                                                                setProp("outlineLevel", v+1)
                                                        }
                                                }
                                        }
                                }
                        case "oMath", "oMathPara": // OMML 公式
                                hasMath = true
                                mathXML.WriteString(serializeStart(t))
                                collectElement(dec, &mathXML, t.Name.Local)
                        }
                case xml.EndElement:
                        if t.Name.Local == "pPr" {
                                inPPr = false
                        }
                        if t.Name.Local == "numPr" && inNumPr {
                                inNumPr = false
                                if numOut != nil {
                                        *numOut = paraNum
                                }
                        }
                        if t.Name.Local == "r" && inRun {
                                if curText.Content != "" || curText.CommentID != "" {
                                        para.Inline = append(para.Inline, curText)
                                }
                                inRun = false
                        }
                if t.Name.Local == "p" {
                        var out []core.Block
                        if leadingPageBreak {
                                out = append(out, &core.PageBreak{})
                        }
                        if hasMath {
                                if latex := ommlToLatex(mathXML.String()); latex != "" {
                                        out = append(out, &core.Math{Formula: latex})
                                        if trailingPageBreak {
                                                out = append(out, &core.PageBreak{})
                                        }
                                        return out
                                }
                        }
                if lvl := headingLevel(para.Style); lvl > 0 {
                        out = append(out, &core.Heading{
                                Level:  lvl,
                                Inline: para.Inline,
                                Style:  para.Style,
                                Align:  para.Align,
                                Props:  para.Props,
                        })
                } else {
                                out = append(out, para)
                        }
                        if trailingPageBreak {
                                out = append(out, &core.PageBreak{})
                        }
                        return out
                }
                }
        }
}

// extractPageNumber 扫描 word/footer*.xml 与 word/header*.xml，提取页码域
// （PAGE / NUMPAGES），还原为 UDM 的 PageNumberConfig。
// 页码通常在页脚，少数字档放在页眉，故 footer 优先、header 兜底。
// 找不到任何页码域时返回 nil。
func extractPageNumber(files map[string]*zip.File) *core.PageNumberConfig {
        candidates := make([]string, 0, len(files))
        for name := range files {
                if strings.HasSuffix(name, ".xml") {
                        if strings.HasPrefix(name, "word/footer") {
                                candidates = append(candidates, name) // 页脚优先
                        }
                }
        }
        for name := range files {
                if strings.HasSuffix(name, ".xml") {
                        if strings.HasPrefix(name, "word/header") {
                                candidates = append(candidates, name) // 页眉兜底
                        }
                }
        }
        for _, name := range candidates {
                f, ok := files[name]
                if !ok {
                        continue
                }
                rc, err := f.Open()
                if err != nil {
                        continue
                }
                cfg := parseFooterPageNumber(rc)
                rc.Close()
                if cfg != nil {
                        return cfg
                }
        }
        return nil
}

// extractHeaderFooter 扫描 word/header*.xml 与 word/footer*.xml，
// 解析首个含文字的段落为 HeaderFooter（保留主导样式：加粗/斜体/字号/颜色/字体/对齐）。
// 只含页码域（无字面文本）的段落跳过。返回 (header, footer)，无则 nil。
func extractHeaderFooter(files map[string]*zip.File) (*core.HeaderFooter, *core.HeaderFooter) {
        var header, footer *core.HeaderFooter
        for name := range files {
                if !strings.HasSuffix(name, ".xml") {
                        continue
                }
                isHeader := strings.HasPrefix(name, "word/header")
                isFooter := !isHeader && strings.HasPrefix(name, "word/footer")
                if !isHeader && !isFooter {
                        continue
                }
                f, ok := files[name]
                if !ok {
                        continue
                }
                rc, err := f.Open()
                if err != nil {
                        continue
                }
                hf := parseHeaderFooterText(rc)
                rc.Close()
                if hf == nil || hf.Text == "" {
                        continue
                }
                if isHeader && header == nil {
                        header = hf
                } else if isFooter && footer == nil {
                        footer = hf
                }
                if header != nil && footer != nil {
                        break
                }
        }
        return header, footer
}

// parseHeaderFooterText 解析页眉/页脚 XML 的首个含文字段落。
// 页码域（PAGE/NUMPAGES）内容不计入文本；若整个段落只剩页码域，返回 nil。
// 样式取首个带样式的 run（主导样式近似）。
func parseHeaderFooterText(rc io.Reader) *core.HeaderFooter {
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        dec.AutoClose = xml.HTMLAutoClose
        dec.Entity = xml.HTMLEntity

        hf := &core.HeaderFooter{}
        var sb strings.Builder
        fieldDepth := 0
        inPPr := false
        inRPr := false
        styled := false
        for {
                t, err := dec.Token()
                if err != nil {
                        break
                }
                switch el := t.(type) {
                case xml.StartElement:
                        switch el.Name.Local {
                        case "p":
                                sb.Reset()
                                hf = &core.HeaderFooter{}
                                styled = false
                        case "pPr":
                                inPPr = true
                        case "jc":
                                if inPPr {
                                        for _, a := range el.Attr {
                                                if a.Name.Local == "val" {
                                                        hf.Align = a.Value
                                                }
                                        }
                                }
                        case "rPr":
                                inRPr = true
                        case "b":
                                if inRPr && !styled {
                                        val := "1"
                                        for _, a := range el.Attr {
                                                if a.Name.Local == "val" {
                                                        val = a.Value
                                                }
                                        }
                                        hf.Bold = val != "0" && val != "false"
                                }
                        case "i":
                                if inRPr && !styled {
                                        val := "1"
                                        for _, a := range el.Attr {
                                                if a.Name.Local == "val" {
                                                        val = a.Value
                                                }
                                        }
                                        hf.Italic = val != "0" && val != "false"
                                }
                        case "color":
                                if inRPr && !styled {
                                        for _, a := range el.Attr {
                                                if a.Name.Local == "val" && a.Value != "" && a.Value != "auto" {
                                                        hf.Color = strings.TrimPrefix(a.Value, "#")
                                                }
                                        }
                                }
                        case "sz":
                                if inRPr && !styled {
                                        for _, a := range el.Attr {
                                                if a.Name.Local == "val" {
                                                        if half, e := strconv.ParseFloat(a.Value, 64); e == nil && half > 0 {
                                                                hf.FontSize = half / 2 // 半磅 → 磅
                                                        }
                                                }
                                        }
                                }
                        case "rFonts":
                                if inRPr && !styled {
                                        for _, a := range el.Attr {
                                                if a.Name.Local == "ascii" || (a.Name.Local == "eastAsia" && hf.FontFamily == "") {
                                                        if a.Name.Local == "ascii" || hf.FontFamily == "" {
                                                                hf.FontFamily = a.Value
                                                        }
                                                }
                                        }
                                }
                        case "fldSimple":
                                for _, a := range el.Attr {
                                        if a.Name.Local == "instr" {
                                                if strings.Contains(strings.ToUpper(a.Value), "PAGE") {
                                                        fieldDepth++
                                                }
                                        }
                                }
                        case "fldChar":
                                ftype := ""
                                for _, a := range el.Attr {
                                        if a.Name.Local == "fldCharType" {
                                                ftype = a.Value
                                        }
                                }
                                if ftype == "begin" {
                                        fieldDepth++
                                } else if ftype == "end" && fieldDepth > 0 {
                                        fieldDepth--
                                }
                        case "t":
                                if fieldDepth == 0 {
                                        sb.WriteString(readCharData(dec))
                                        styled = styled || hf.Bold || hf.Italic || hf.FontSize > 0 || hf.Color != "" || hf.FontFamily != ""
                                }
                        }
                case xml.EndElement:
                        switch el.Name.Local {
                        case "p":
                                text := strings.TrimSpace(sb.String())
                                if text != "" {
                                        hf.Text = text
                                        if hf.Align == "" {
                                                hf.Align = "center"
                                        }
                                        return hf
                                }
                                // 空段落继续找下一个
                                styled = false
                        case "pPr":
                                inPPr = false
                        case "rPr":
                                inRPr = false
                        case "fldSimple":
                                if fieldDepth > 0 {
                                        fieldDepth--
                                }
                        }
                }
        }
        return nil
}

// parseFooterPageNumber 解析单个页脚 XML，构造页码格式模板。
// 形如「第 」+ PAGE 域 +「 页」拼成 "第 {n} 页"；含 NUMPAGES 则补 {total}。
func parseFooterPageNumber(rc io.Reader) *core.PageNumberConfig {
        dec := xml.NewDecoder(rc)
        dec.Strict = false
        dec.AutoClose = xml.HTMLAutoClose
        dec.Entity = xml.HTMLEntity

        type tok struct {
                text  string
                page  bool
                total bool
        }
        var toks []tok
        var align string
        inPPr := false
        fieldDepth := 0 // 进入域（fldSimple / fldChar begin）后跳过其内部的显示文本

        for {
                t, err := dec.Token()
                if err != nil {
                        break
                }
                switch el := t.(type) {
                case xml.StartElement:
                        switch el.Name.Local {
                        case "pPr":
                                inPPr = true
                        case "jc":
                                if inPPr {
                                        for _, a := range el.Attr {
                                                if a.Name.Local == "val" {
                                                        align = a.Value
                                                }
                                        }
                                }
                        case "fldSimple":
                                for _, a := range el.Attr {
                                        if a.Name.Local == "instr" {
                                                up := strings.ToUpper(strings.TrimSpace(a.Value))
                                                if strings.Contains(up, "NUMPAGES") {
                                                        toks = append(toks, tok{total: true})
                                                } else if strings.Contains(up, "PAGE") {
                                                        toks = append(toks, tok{page: true})
                                                }
                                        }
                                }
                                fieldDepth++
                        case "fldChar":
                                ftype := ""
                                for _, a := range el.Attr {
                                        if a.Name.Local == "fldCharType" {
                                                ftype = a.Value
                                        }
                                }
                                if ftype == "begin" {
                                        fieldDepth++
                                } else if ftype == "end" {
                                        if fieldDepth > 0 {
                                                fieldDepth--
                                        }
                                }
                        case "instrText":
                                if fieldDepth > 0 {
                                        up := strings.ToUpper(strings.TrimSpace(readCharData(dec)))
                                        if strings.Contains(up, "NUMPAGES") {
                                                toks = append(toks, tok{total: true})
                                        } else if strings.Contains(up, "PAGE") {
                                                toks = append(toks, tok{page: true})
                                        }
                                }
                        case "t":
                                if fieldDepth == 0 {
                                        toks = append(toks, tok{text: readCharData(dec)})
                                }
                        }
                case xml.EndElement:
                        if el.Name.Local == "pPr" {
                                inPPr = false
                        } else if el.Name.Local == "fldSimple" {
                                if fieldDepth > 0 {
                                        fieldDepth--
                                }
                        }
                }
        }

        var sb strings.Builder
        hasPage := false
        for _, tk := range toks {
                if tk.page {
                        sb.WriteString("{n}")
                        hasPage = true
                }
                if tk.total {
                        sb.WriteString("{total}")
                }
                if tk.text != "" {
                        sb.WriteString(tk.text)
                }
        }
        if !hasPage {
                return nil
        }
        if align == "" {
                align = "center"
        }
        return &core.PageNumberConfig{
                Enabled: true,
                Format:  sb.String(),
                Align:   align,
        }
}

// parseTable 解析 <w:tbl>，返回 *core.Table。容错：未知或残缺元素跳过。
func parseTable(dec *xml.Decoder, footnotes map[string]string, fn map[string]int, ntf map[int]string, media *docMedia) core.Block {
        tbl := &core.Table{Rows: [][]core.TableCell{}}
        var curRow []core.TableCell
        var curCell core.TableCell
        var curCellInline []core.Inline
        inTcPr := false
        inTcBorders := false

        flushCell := func() {
                if curCellInline != nil {
                        curCell.Inline = curCellInline
                }
                curRow = append(curRow, curCell)
                curCell = core.TableCell{}
                curCellInline = nil
        }

        for {
                tok, err := dec.Token()
                if err != nil {
                        break
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        switch t.Name.Local {
                        case "tr":
                                curRow = []core.TableCell{}
                        case "tc":
                                curCell = core.TableCell{}
                                curCellInline = []core.Inline{}
                        case "tcPr":
                                inTcPr = true
                        case "gridSpan":
                                if inTcPr {
                                        for _, a := range t.Attr {
                                                if a.Name.Local == "val" {
                                                        if n, e := strconv.Atoi(a.Value); e == nil {
                                                                curCell.ColSpan = n
                                                        }
                                                }
                                        }
                                }
                        case "vAlign":
                                // 单元格垂直对齐（Word 表格属性 → 前端 table_cell.vAlign）
                                if inTcPr {
                                        for _, a := range t.Attr {
                                                if a.Name.Local == "val" {
                                                        switch a.Value {
                                                        case "center":
                                                                curCell.VAlign = "middle"
                                                        case "bottom":
                                                                curCell.VAlign = "bottom"
                                                        default:
                                                                curCell.VAlign = ""
                                                        }
                                                }
                                        }
                                }
                        case "vMerge":
                                if inTcPr {
                                        val := ""
                                        for _, a := range t.Attr {
                                                if a.Name.Local == "val" {
                                                        val = a.Value
                                                }
                                        }
                                        // restart：纵向合并起点；continue：被合并区域（仍保留占位单元格以维持列对齐）
                                        if val == "" || val == "restart" {
                                                curCell.RowSpan = 1
                                        }
                                }
                        case "tcBorders":
                                // 单元格边框（前端表格工具"边框"预设导出为 w:tcBorders）
                                if inTcPr {
                                        inTcBorders = true
                                        // 默认四边有线；逐侧根据 w:val=nil/none 关闭
                                        curCell.Borders = "1111"
                                }
                        case "top", "right", "bottom", "left":
                                if inTcBorders {
                                        val, sz, color := "", 0, ""
                                        for _, a := range t.Attr {
                                                switch a.Name.Local {
                                                case "val":
                                                        val = a.Value
                                                case "sz":
                                                        if n, e := strconv.Atoi(a.Value); e == nil {
                                                                sz = n
                                                        }
                                                case "color":
                                                        color = a.Value
                                                }
                                        }
                                        sideIdx := 0
                                        switch t.Name.Local {
                                        case "top":
                                                sideIdx = 0
                                        case "right":
                                                sideIdx = 1
                                        case "bottom":
                                                sideIdx = 2
                                        case "left":
                                                sideIdx = 3
                                        }
                                        b := []byte(curCell.Borders)
                                        if len(b) == 4 {
                                                if val == "nil" || val == "none" {
                                                        b[sideIdx] = '0'
                                                } else {
                                                        b[sideIdx] = '1'
                                                        // 线宽（eighths-of-a-point → pt）/线色：仅在有效时记录一次
                                                        if curCell.BorderW == 0 && sz > 0 {
                                                                curCell.BorderW = float64(sz) / 8
                                                        }
                                                        if curCell.BorderColor == "" && color != "" && color != "auto" {
                                                                curCell.BorderColor = strings.TrimPrefix(color, "#")
                                                        }
                                                }
                                                curCell.Borders = string(b)
                                        }
                                }
                        case "p":
                                for _, b := range parseParagraph(dec, footnotes, fn, ntf, media, nil) {
                                        if b == nil {
                                                continue
                                        }
                                        if p, ok := b.(*core.Paragraph); ok {
                                                curCellInline = append(curCellInline, p.Inline...)
                                        } else if h, ok := b.(*core.Heading); ok {
                                                curCellInline = append(curCellInline, h.Inline...)
                                        }
                                        // 表格单元格内的分页符忽略（单元格内不分页）
                                }
                        }
                case xml.EndElement:
                        switch t.Name.Local {
                        case "tcPr":
                                inTcPr = false
                        case "tcBorders":
                                inTcBorders = false
                        case "tc":
                                flushCell()
                        case "tr":
                                tbl.Rows = append(tbl.Rows, curRow)
                        case "tbl":
                                return tbl
                        }
                }
        }
        return tbl
}

// === OMML → LaTeX 转换（覆盖常见结构）===

func serializeStart(t xml.StartElement) string {
        var sb strings.Builder
        sb.WriteString("<" + t.Name.Local)
        for _, a := range t.Attr {
                sb.WriteString(" " + a.Name.Local + `="` + a.Value + `"`)
        }
        sb.WriteString(">")
        return sb.String()
}

// collectElement 从 dec 中消费掉名为 name 的元素（含其全部子节点），
// 将其完整 XML（含起始标签已由外部写入 mathXML）追加到 out。
func collectElement(dec *xml.Decoder, out *strings.Builder, name string) {
        depth := 1
        for {
                tok, err := dec.Token()
                if err != nil {
                        return
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        depth++
                        out.WriteString(serializeStart(t))
                case xml.CharData:
                        out.Write(t)
                case xml.EndElement:
                        out.WriteString("</" + t.Name.Local + ">")
                        depth--
                        if depth == 0 && t.Name.Local == name {
                                return
                        }
                }
        }
}

// ommlToLatex 将 OMML 片段转为 LaTeX。失败返回空字符串。
func ommlToLatex(omml string) string {
        dec := xml.NewDecoder(strings.NewReader(omml))
        dec.Strict = false
        var sb strings.Builder
        ok := false
        for {
                tok, err := dec.Token()
                if err != nil {
                        break
                }
                if start, ok2 := tok.(xml.StartElement); ok2 {
                        if start.Name.Local == "oMath" || start.Name.Local == "oMathPara" {
                                ok = true
                                writeOMMLChildren(dec, &sb)
                        }
                }
        }
        if !ok {
                return ""
        }
        return strings.TrimSpace(sb.String())
}

// writeOMMLChildren 解析 OMML 子元素直到匹配当前元素的结束标签。
func writeOMMLChildren(dec *xml.Decoder, sb *strings.Builder) {
        depth := 1
        for depth > 0 {
                tok, err := dec.Token()
                if err != nil {
                        return
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        depth++
                        writeOMMLElement(dec, sb, t)
                case xml.EndElement:
                        depth--
                }
        }
}

// writeOMMLElement 转换单个 OMML 元素。子元素文本通过 dec 消费。
func writeOMMLElement(dec *xml.Decoder, sb *strings.Builder, t xml.StartElement) {
        switch t.Name.Local {
        case "oMath", "oMathPara":
                writeOMMLChildren(dec, sb)
        case "f": // 分数
                sb.WriteString("\\frac{")
                skipTo(dec, sb, "num")
                skipTo(dec, sb, "den")
                sb.WriteString("}")
        case "num":
                writeOMMLChildren(dec, sb)
                sb.WriteString("}{")
        case "den":
                writeOMMLChildren(dec, sb)
                sb.WriteString("}")
        case "rad": // 根式
                sb.WriteString("\\sqrt{")
                skipTo(dec, sb, "deg")
                skipTo(dec, sb, "e")
                sb.WriteString("}")
        case "sqrt": // 简单根号
                sb.WriteString("\\sqrt{")
                writeOMMLChildren(dec, sb)
                sb.WriteString("}")
        case "deg":
                writeOMMLChildren(dec, sb)
                sb.WriteString("}{")
        case "e":
                writeOMMLChildren(dec, sb)
                sb.WriteString("}")
        case "sup": // 上标
                sb.WriteString("^{")
                skipTo(dec, sb, "e")
                sb.WriteString("}")
        case "sub": // 下标
                sb.WriteString("_{")
                skipTo(dec, sb, "e")
                sb.WriteString("}")
        case "sSubSup":
                sb.WriteString("_{")
                skipTo(dec, sb, "sub")
                sb.WriteString("}^{")
                skipTo(dec, sb, "sup")
                sb.WriteString("}")
        case "sSup":
                sb.WriteString("^{")
                skipTo(dec, sb, "sup")
                sb.WriteString("}")
        case "subArg":
                writeOMMLChildren(dec, sb)
                sb.WriteString("}{")
        case "supArg":
                writeOMMLChildren(dec, sb)
                sb.WriteString("}")
        case "d": // 定界符（括号）
                sb.WriteString("\\left(")
                skipTo(dec, sb, "e")
                sb.WriteString("\\right)")
        case "nary": // 求和/积分等
                sb.WriteString(naryCmd(t))
                sb.WriteString("_{")
                skipTo(dec, sb, "sub")
                sb.WriteString("}^{")
                skipTo(dec, sb, "sup")
                sb.WriteString("}")
                skipTo(dec, sb, "e")
        case "acc": // 帽子符号
                sb.WriteString("\\hat{")
                skipTo(dec, sb, "e")
                sb.WriteString("}")
        case "r": // 公式文本 run
                writeOMMLChildren(dec, sb)
        case "t", "i", "lit": // 文本/标识符/字面量
                sb.WriteString(ommlText(readCharData(dec)))
        default:
                writeOMMLChildren(dec, sb)
        }
}

// skipTo 跳过直到遇到名为 name 的子元素，然后转换它。
func skipTo(dec *xml.Decoder, sb *strings.Builder, name string) {
        depth := 1
        for depth > 0 {
                tok, err := dec.Token()
                if err != nil {
                        return
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        depth++
                        if t.Name.Local == name {
                                writeOMMLElement(dec, sb, t)
                        }
                case xml.EndElement:
                        depth--
                }
        }
}

func naryCmd(_ xml.StartElement) string { return "\\sum" }

// ommlText 将 OMML 文本中的特殊字符映射为 LaTeX。
func ommlText(s string) string {
        repl := map[string]string{
                "∑": "\\sum", "∫": "\\int", "∏": "\\prod", "√": "\\sqrt",
                "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta",
                "θ": "\\theta", "λ": "\\lambda", "μ": "\\mu", "π": "\\pi",
                "σ": "\\sigma", "φ": "\\phi", "ω": "\\omega", "∞": "\\infty",
                "≤": "\\le", "≥": "\\ge", "≠": "\\ne", "≈": "\\approx",
                "×": "\\times", "÷": "\\div", "±": "\\pm", "→": "\\to",
                "∈": "\\in", "∀": "\\forall", "∃": "\\exists", "∇": "\\nabla",
        }
        for k, v := range repl {
                s = strings.ReplaceAll(s, k, v)
        }
        return s
}

// readCharData 读取元素内的文本
func readCharData(dec *xml.Decoder) string {
        var sb strings.Builder
        for {
                tok, err := dec.Token()
                if err != nil {
                        return sb.String()
                }
                switch t := tok.(type) {
                case xml.CharData:
                        sb.Write(t)
                case xml.EndElement:
                        return sb.String()
                }
        }
}

func readOnOffAttr(t xml.StartElement) bool {
        for _, a := range t.Attr {
                if a.Name.Local == "val" {
                        v := strings.ToLower(a.Value)
                        return v == "" || v == "1" || v == "true" || v == "on"
                }
        }
        return true // 无 val 属性默认开启
}

// parseCoreProps 解析 docProps/core.xml 提取元数据
func parseCoreProps(r io.Reader, meta *core.Meta) {
        dec := xml.NewDecoder(r)
        dec.Strict = false
        depth := 0
        for {
                tok, err := dec.Token()
                if err != nil {
                        return
                }
                switch t := tok.(type) {
                case xml.StartElement:
                        depth++
                        // 只处理 coreProperties 的直接子元素（depth==2）
                        if depth == 2 {
                                text := readCharData(dec)
                                depth-- // readCharData 消耗了 EndElement
                                switch t.Name.Local {
                                case "title":
                                        meta.Title = strings.TrimSpace(text)
                                case "creator":
                                        meta.Author = strings.TrimSpace(text)
                                case "subject":
                                        meta.Subject = strings.TrimSpace(text)
                                case "description":
                                        meta.Description = strings.TrimSpace(text)
                                case "language":
                                        meta.Language = strings.TrimSpace(text)
                                case "created":
                                        meta.CreatedAt = strings.TrimSpace(text)
                                case "modified":
                                        meta.ModifiedAt = strings.TrimSpace(text)
                                }
                        }
                case xml.EndElement:
                        depth--
                }
        }
}
