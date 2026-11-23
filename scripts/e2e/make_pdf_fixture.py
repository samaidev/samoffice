# 生成 round55/57 e2e 用的 PDF fixture（两页文本，验证 PDF 打印预览分页）
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import os

out = '/home/z/my-project/samoffice/scripts/e2e/fixtures/r55-test.pdf'
os.makedirs(os.path.dirname(out), exist_ok=True)
c = canvas.Canvas(out, pagesize=A4)
for i in range(1, 3):
    c.setFont('Helvetica', 18)
    c.drawString(72, 780, f'PDF Print Test Page {i}')
    c.setFont('Helvetica', 12)
    for j in range(20):
        c.drawString(72, 740 - 18 * j, f'Line {j + 1} of page {i}: the quick brown fox jumps over the lazy dog.')
    c.showPage()
c.save()
print('written', out, os.path.getsize(out), 'bytes')
