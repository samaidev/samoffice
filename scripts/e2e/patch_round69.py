#!/usr/bin/env python3
"""round69 边框修复补丁。
根因3：cell 节点被附加了幻影 'paragraph' mark（type.name='paragraph' 但实为节点 spec），
row.validContent() 因 allowsMarks 失败恒 false → setNodeMarkup 的 ReplaceAroundStep
在 close(row, content) 校验抛 'Invalid content for node table_row' →
边框预设/颜色/粗细/对齐/列宽拖拽全部静默失效。
修复：所有写 cell attrs 的 setNodeMarkup 显式传 marks=[]（块节点本不应带 mark），
新节点不带幻影 mark → row.validContent 通过。"""
import re

FILES = {
    '/home/z/my-project/samoffice/frontend/src/editors/document/tableCommands.ts': [
        # setCellAlign / setCellVAlign / setCellBorders 共 5 处
        ('const tr = state.tr.setNodeMarkup(cellPos, undefined, { ...cellNode.attrs, align })',
         'const tr = state.tr.setNodeMarkup(cellPos, undefined, { ...cellNode.attrs, align }, [])'),
        ('tr.setNodeMarkup(pos, undefined, { ...node.attrs, vAlign })',
         'tr.setNodeMarkup(pos, undefined, { ...node.attrs, vAlign }, [])'),
        ('tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, vAlign })',
         'tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, vAlign }, [])'),
        ('tr.setNodeMarkup(g.pos, undefined, mkAttrs(it.attrs, next))',
         'tr.setNodeMarkup(g.pos, undefined, mkAttrs(it.attrs, next), [])'),
        ('tr.setNodeMarkup(pos, undefined, mkAttrs(cur.attrs, cur.sides))',
         'tr.setNodeMarkup(pos, undefined, mkAttrs(cur.attrs, cur.sides), [])'),
    ],
    '/home/z/my-project/samoffice/frontend/src/editors/document/tablePlugins.ts': [
        # 列宽拖拽 / AutoFit 写 colwidth 共 3 处
        ('tr3.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(cw)) })',
         'tr3.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(cw)) }, [])'),
        ('tr.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(w)) })',
         'tr.setNodeMarkup(cellOff, undefined, { ...cell.attrs, colwidth: Math.max(CELL_MIN_W, Math.round(w)) }, [])'),
    ],
}

total = 0
for path, pairs in FILES.items():
    src = open(path, encoding='utf-8').read()
    for old, new in pairs:
        n = src.count(old)
        if n == 0:
            print(f'!! MISS: {path}: {old[:60]}')
            continue
        src = src.replace(old, new)
        total += n
        print(f'OK x{n}: {old[:70]}')
    open(path, 'w', encoding='utf-8').write(src)
print(f'共 {total} 处已打补丁')
