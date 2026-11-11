# 生成模仿真实 Excel/WPS 输出的 xlsx：主题色填充、索引色、纯 RGB、渐变标题
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Color

wb = Workbook()
ws = wb.active
ws.title = "数据"

# 1) 标题行：Excel 常见的"主题色填充 + 白色主题字"
hdr_fill = PatternFill(fill_type="solid", fgColor=Color(theme=3, tint=0.4), bgColor=Color(theme=0, tint=0.0))
hdr_font = Font(color=Color(theme=0), bold=True, size=12)
for c, name in enumerate(["部门", "一月", "二月", "三月"], start=1):
    cell = ws.cell(row=1, column=c, value=name)
    cell.fill = hdr_fill
    cell.font = hdr_font
    cell.alignment = Alignment(horizontal="center")

# 2) 数据行：斑马纹（主题色 tint）、索引色、纯 RGB 混合
fills = {
    "theme_zebra": PatternFill(fill_type="solid", fgColor=Color(theme=0, tint=-0.05), bgColor=Color(indexed=64)),
    "indexed": PatternFill(fill_type="solid", fgColor=Color(indexed=22), bgColor=Color(indexed=64)),
    "rgb_red": PatternFill(fill_type="solid", fgColor="FFC00000", bgColor=Color(indexed=64)),
    "none_fill": PatternFill(fill_type="none"),
}
data = [
    ["销售部", 120, 135, 150],
    ["市场部", 98, 88, 102],
    ["研发部", 200, 210, 221],
    ["财务部", 66, 70, 72],
]
for r, row in enumerate(data, start=2):
    for c, v in enumerate(row, start=1):
        cell = ws.cell(row=r, column=c, value=v)
        if r % 2 == 0:
            cell.fill = fills["theme_zebra"]
        else:
            cell.fill = fills["indexed"]
        if r == 2 and c == 1:
            cell.fill = fills["rgb_red"]
            cell.font = Font(color="FFFFFFFF", bold=True)
        if r == 4 and c == 1:
            cell.fill = fills["none_fill"]

wb.save("/home/z/my-project/samoffice/_verify/theme_test.xlsx")
print("saved theme_test.xlsx")
