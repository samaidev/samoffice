# 生成 E2E 测试 Word 文档：跨页长表格 + 多页正文（Round 12 复验 + Round 13 交互测试）
import docx
from docx.shared import Pt

d = docx.Document()

d.add_paragraph('跨页表格测试文档')
d.add_paragraph('以下是项目进度总表（40 行），用于验证表格跨页显示、左上角全选、边框拖拽与自动调整。')

t = d.add_table(rows=41, cols=4)
t.style = 'Table Grid'
hdr = ['阶段', '任务名称', '负责人', '完成情况']
for j, h in enumerate(hdr):
    t.rows[0].cells[j].text = h
items = [
    ('需求', '业务流程梳理与访谈', '张伟', '已完成'),
    ('需求', '需求规格说明书编写', '李娜', '已完成'),
    ('设计', '系统架构设计', '王强', '进行中'),
    ('设计', '数据库模型设计', '赵敏', '已完成'),
    ('开发', '用户模块开发', '张伟', '进行中'),
    ('开发', '订单模块开发', '李娜', '未开始'),
    ('开发', '报表模块开发', '王强', '未开始'),
    ('测试', '单元测试用例编写', '赵敏', '未开始'),
    ('测试', '集成测试环境搭建', '张伟', '未开始'),
    ('上线', '生产环境部署', '李娜', '未开始'),
]
for i in range(1, 41):
    it = items[(i - 1) % len(items)]
    t.rows[i].cells[0].text = it[0]
    t.rows[i].cells[1].text = f'{it[1]}（第 {i} 行）'
    t.rows[i].cells[2].text = it[2]
    t.rows[i].cells[3].text = it[3]
# 首行加粗做表头感
for c in t.rows[0].cells:
    for p in c.paragraphs:
        for r in p.runs:
            r.bold = True

d.add_paragraph('表格之后的正文段落：用于验证表格后的内容在第二页正确续排、不重叠不越界。' * 3)
for i in range(8):
    d.add_paragraph(f'补充说明第 {i + 1} 段：表格跨页后正文应当从表格结束位置继续排布，页码、页脚与纸张边界保持一致。')

d.save('/tmp/e2e_table.docx')
print('saved /tmp/e2e_table.docx')
