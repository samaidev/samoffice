#!/usr/bin/env python3
# r41: 用户文档 docx → UDM JSON 转换（走 __setDocForTest 正规路径加载）
# 保留：段落文本/加粗/字号/对齐、表格 9 行、图片（尺寸）、oMath 公式（OMML→简化 LaTeX 尝试 + 兜底占位）、sectPr 页面设置
import zipfile, json, sys, re
from lxml import etree

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
M = '{http://schemas.openxmlformats.org/officeDocument/2006/math}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

SRC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx'
OUT = '/home/z/my-project/samoffice/scripts/fixtures/emc_contract.udm.json'

z = zipfile.ZipFile(SRC)
root = etree.fromstring(z.read('word/document.xml'))
rels = etree.fromstring(z.read('word/_rels/document.xml.rels'))
rel_map = {el.get('Id'): el.get('Target') for el in rels}
body = root.find(W+'body')

def twip2pt(v): return round(int(v) / 20, 1) if v else None

def omml_to_latex(el):
    # 简化 OMML → LaTeX：只处理常见结构（分数/上下标/根号/普通字符），其余取文本
    tag = etree.QName(el).localname
    if tag == 't':
        return el.text or ''
    if tag == 'f':
        num = el.find(M+'num'); den = el.find(M+'den')
        return '\\frac{%s}{%s}' % (omml_to_latex(num) if num is not None else '', omml_to_latex(den) if den is not None else '')
    if tag == 'sSub':
        e = el.find(M+'e'); sub = el.find(M+'sub')
        return '%s_{%s}' % (omml_to_latex(e) if e is not None else '', omml_to_latex(sub) if sub is not None else '')
    if tag == 'sSup':
        e = el.find(M+'e'); sup = el.find(M+'sup')
        return '%s^{%s}' % (omml_to_latex(e) if e is not None else '', omml_to_latex(sup) if sup is not None else '')
    if tag == 'sSubSup':
        e = el.find(M+'e'); sub = el.find(M+'sub'); sup = el.find(M+'sup')
        return '%s_{%s}^{%s}' % (omml_to_latex(e) if e is not None else '', omml_to_latex(sub) if sub is not None else '', omml_to_latex(sup) if sup is not None else '')
    if tag == 'rad':
        e = el.find(M+'e'); deg = el.find(M+'deg')
        return '\\sqrt[%s]{%s}' % (omml_to_latex(deg) if deg is not None else '', omml_to_latex(e) if e is not None else '')
    if tag == 'nary':
        e = el.find(M+'e'); sub = el.find(M+'sub'); sup = el.find(M+'sup'); pr = el.find(M+'naryPr')
        chr_el = pr.find(M+'chr') if pr is not None else None
        op = chr_el.get(M+'val') if chr_el is not None else '∫'
        return '%s_{%s}^{%s}%s' % (op, omml_to_latex(sub) if sub is not None else '', omml_to_latex(sup) if sup is not None else '', omml_to_latex(e) if e is not None else '')
    # 其余容器：递归拼接
    parts = []
    for ch in el:
        parts.append(omml_to_latex(ch))
    return ''.join(parts)

def para_inline(p):
    """段落 → UDM inline 数组（text/bold/size/formula/image）"""
    out = []
    for ch in p.iter():
        tag = etree.QName(ch).localname
        # oMath（含 oMathPara 内的）
        if tag == 'oMath':
            latex = omml_to_latex(ch)
            if latex.strip():
                out.append({ 'formula': latex, 'inline': True })
            # 移除已消费的（简单起见接受重复风险：oMath 不嵌套）
        elif tag == 't':
            # 检查祖先 rPr 的 b/sz
            r = ch.getparent()
            b = r is not None and r.find(W+'rPr/'+W+'b') is not None
            szel = r.find(W+'rPr/'+W+'sz') if r is not None else None
            sz = int(szel.get(W+'val'))//2 if szel is not None else None
            txt = ch.text or ''
            if txt:
                item = { 'text': txt }
                if b: item['bold'] = True
                if sz: item['fontSize'] = sz
                out.append(item)
        elif tag == 'blip':
            rid = ch.get(R+'embed')
            tgt = rel_map.get(rid, '')
            # 尺寸：所在 inline 的 extent（EMU→px，96dpi: 914400 EMU/inch）
            ext = ch.getparent().getparent().getparent().find(A+'ext')
            wpx = int(ext.get('cx'))//9525 if ext is not None else 300
            hpx = int(ext.get('cy'))//9525 if ext is not None else 200
            out.append({ 'src': 'blob:' + tgt.split('/')[-1], 'width': wpx, 'height': hpx, 'alt': '图' })
    # 去重：iter() 会重复访问嵌套节点的 t（oMath 内的 m:t 与 w:t 标签同名 't'！）
    # m:t 的 QName 是 math 命名空间 —— 上面 tag 比较只匹配 localname 't'，会误吃公式文本。
    # 重写：只遍历 w: 命名空间的直接 run。
    return out

def para_inline_safe(p):
    out = []
    def walk(node, in_math=False):
        for ch in node:
            qn = etree.QName(ch)
            if qn.namespace == M_URI:
                if qn.localname == 'oMath':
                    latex = omml_to_latex(ch)
                    if latex.strip():
                        out.append({ 'formula': latex, 'inline': True })
                else:
                    walk(ch, True)
                continue
            if qn.namespace != W_URI:
                continue
            if qn.localname == 'r':
                # run：文本 + 图片
                for rc in ch:
                    rcn = etree.QName(rc)
                    if rcn.namespace == W_URI and rcn.localname == 't':
                        txt = rc.text or ''
                        if txt:
                            b = ch.find(W+'rPr/'+W+'b') is not None
                            szel = ch.find(W+'rPr/'+W+'sz')
                            sz = int(szel.get(W+'val'))//2 if szel is not None else None
                            item = { 'content': txt }
                            if b: item['bold'] = True
                            if sz: item['fontSize'] = sz
                            out.append(item)
                    elif rcn.localname == 'drawing':
                        blip = rc.find('.//'+A+'blip')
                        ext = rc.find('.//'+WP+'extent')
                        if blip is not None:
                            rid = blip.get(R+'embed')
                            tgt = rel_map.get(rid, '')
                            wpx = int(ext.get('cx'))//9525 if ext is not None else 300
                            hpx = int(ext.get('cy'))//9525 if ext is not None else 200
                            out.append({ 'src': 'blob:' + tgt.split('/')[-1], 'width': wpx, 'height': hpx, 'alt': '图' })
                # r 内嵌套 math 不常见，跳过
            else:
                walk(ch, in_math)
    walk(p)
    return out

def para_to_block(p):
    pPr = p.find(W+'pPr')
    style, align = '', ''
    if pPr is not None:
        st = pPr.find(W+'pStyle')
        if st is not None: style = st.get(W+'val')
        jc = pPr.find(W+'jc')
        if jc is not None: align = jc.get(W+'val')
    inline = para_inline_safe(p)
    # 对齐 Go parser：公式总是独立 Math 块（先文本段、后公式块）。
    # inline 数组里的 formula 项（本转换器产出）提取为块级。
    formulas = [i['formula'] for i in inline if 'formula' in i]
    texts = [i for i in inline if 'formula' not in i]
    blocks_out = []
    m = re.match(r'^Heading(\d)$|^heading (\d)$', style, re.I)
    if m:
        blocks_out.append({ 'level': int(m.group(1)), 'inline': texts if texts else [{ 'content': '' }] })
    else:
        blk = { 'inline': texts if texts else [{ 'content': '' }] }
        if align: blk['align'] = align
        blocks_out.append(blk)
    for f in formulas:
        blocks_out.append({ 'formula': f })
    return blocks_out

def tbl_to_block(tbl):
    rows = []
    grid = [int(gc.get(W+'w', '0'))//20 for gc in tbl.findall(W+'tblGrid/'+W+'gridCol')]
    for tr in tbl.findall(W+'tr'):
        cells = []
        for tc in tr.findall(W+'tc'):
            cell_blocks = []
            for p in tc.findall(W+'p'):
                cell_blocks.extend(para_to_block(p))
            cells.append({ 'blocks': cell_blocks if cell_blocks else [{ 'inline': [{ 'text': '' }] }] })
        rows.append(cells)
    return { 'rows': rows, 'width': grid if grid else [100]*len(rows[0]) }

W_URI = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
M_URI = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

blocks = []
for ch in body:
    qn = etree.QName(ch)
    if qn.namespace != W_URI: continue
    if qn.localname == 'p':
        blocks.extend(para_to_block(ch))
    elif qn.localname == 'tbl':
        blocks.append(tbl_to_block(ch))

# sectPr → pageSetup（UDM 字段名对齐 parser.go：纸张 pt？还是 px —— 查 types/udm.ts PageSetup）
sect = body.find(W+'sectPr')
pg = sect.find(W+'pgSz'); mar = sect.find(W+'pgMar')
# UDM.pageSetup 字段名对齐 DocumentEditor（twips；margin/15=px）
page_setup = {
    'widthTwips': int(pg.get(W+'w')), 'heightTwips': int(pg.get(W+'h')),
    'orientation': 'portrait',
    'marginTop': int(mar.get(W+'top')), 'marginBottom': int(mar.get(W+'bottom')),
    'marginLeft': int(mar.get(W+'left')), 'marginRight': int(mar.get(W+'right')),
}

udm = { 'meta': { 'title': 'EMC 合同效益分配' }, 'comments': [], 'blocks': blocks, 'pageSetup': page_setup }
json.dump(udm, open(OUT, 'w'), ensure_ascii=False, indent=1)
print('blocks:', len(blocks), '→', OUT)
# 统计
import collections
c = collections.Counter()
for b in blocks:
    if 'rows' in b: c['table'] += 1
    elif 'level' in b: c['heading'] += 1
    elif 'formula' in b: c['math_block'] += 1
    elif any('src' in i for i in b.get('inline', [])): c['para_with_image'] += 1
    else: c['para'] += 1
print(dict(c))
formulas = sum(1 for b in blocks if 'formula' in b)
print('公式块数:', formulas)
imgs = [i for b in blocks for i in b.get('inline', []) if 'src' in i]
print('图片:', [(i['width'], i['height']) for i in imgs])
