#!/usr/bin/env python3
"""生成形态3 e2e 测试素材：一份含约 16k 中文字符的 docx（解析+导出链路验证用）。

产物: scripts/e2e-web/fixtures/sample.docx（随仓库提交，保证 e2e 可重复跑）
"""
import os
import docx

OUT = os.path.join(os.path.dirname(__file__), 'fixtures', 'sample.docx')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

PARAS = [
    'SamOffice 浏览器形态端到端验证文档。本文档用于验证 wasm 引擎的解析与导出链路，'
    '包含标题、多级段落、列表与表格等典型结构。',
    '第一部分：项目背景。办公套件的核心诉求是在任何设备上获得一致的编辑体验。'
    '桌面端依赖本地进程提供磁盘读写与词典能力，浏览器端则要求全部逻辑在页面内完成，'
    '这就要求文档引擎具备无文件系统运行的能力，也就是 WASM 化的改造。',
    '第二部分：技术方案。文档引擎以统一文档模型为中心，解析器把 docx、xlsx、pptx、'
    'Markdown、HTML、CSV 等格式映射到统一模型，渲染器再从统一模型生成目标格式。'
    '字节级读写内核让整套链路摆脱了对磁盘路径的依赖，浏览器与服务端共用同一套代码。',
    '第三部分：验证要点。解析后正文字符数必须与源文档一致；导出的 docx 必须是合法的'
    'zip 容器，能被 Word 打开；表格的原生读取必须保留合并单元格与边框样式；'
    'PDF 导出依赖内嵌中文字体，子模块应在首次导出时才被拉取加载。',
]

def main():
    d = docx.Document()
    d.add_heading('SamOffice 形态3 端到端验证', level=0)
    total = 0
    # 重复段落凑足 ~16k 字符，模拟真实长文档
    while total < 16000:
        for i, p in enumerate(PARAS):
            para = d.add_paragraph(f'{p}（重复块 {total // 100 + 1}）')
            total += len(para.text)
            if i == 1:
                d.add_heading('子标题：实现细节', level=2)
            if i == 3:
                t = d.add_table(rows=2, cols=3)
                hdr = ['验证项', '预期', '实测']
                for c, txt in enumerate(hdr):
                    t.rows[0].cells[c].text = txt
                t.rows[1].cells[0].text = '正文完整性'
                t.rows[1].cells[1].text = '字符数一致'
                t.rows[1].cells[2].text = '待测'
                d.add_paragraph('')
    d.save(OUT)
    size = os.path.getsize(OUT)
    print(f'OK {OUT} size={size} chars≈{total}')

if __name__ == '__main__':
    main()
