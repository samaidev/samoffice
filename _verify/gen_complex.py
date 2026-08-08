"""生成更复杂的对比测试源文件：多 sheet、负数、小数、空单元格、长文本、公式、样式、合并单元格。"""
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

HERE = os.path.dirname(os.path.abspath(__file__))


def _style_header(ws, ncols):
    """首行作为表头：粗体 + 居中 + 蓝底白字。"""
    for c in range(1, ncols + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="305496")
        cell.alignment = Alignment(horizontal="center", vertical="center")


def gen_xlsx():
    wb = Workbook()
    # Sheet1: 销售表（文本+整数+表头样式+公式）
    ws = wb.active
    ws.title = "销售表"
    ws.append(["姓名", "部门", "销售额"])
    ws.append(["Wang五", "销售", 12000])
    ws.append(["李四", "市场", 9800])
    ws.append(["张三", "销售", 15000])
    # 空单元格
    ws.append(["赵六", None, 5000])
    ws.append([None, "财务", 7500])
    # 合计行（公式）
    ws.append(["合计", "", "=SUM(C2:C6)"])
    _style_header(ws, 3)
    # 合并 A1 上方无意义，这里合并合计行 A/B 演示合并单元格
    ws.merge_cells("A7:B7")

    # Sheet2: 汇总（小数、负数、长文本 + 公式 + 颜色样式）
    ws2 = wb.create_sheet("汇总")
    ws2.append(["项目", "金额"])
    ws2.append(["总计", "=SUM(销售表!C2:C6)"])
    ws2.append(["平均", 12266.67])
    ws2.append(["利润", -4200.5])
    ws2.append(["增长率", 0.1234])
    ws2.append(["备注", "这是一段较长的中文备注文本用于测试字符串解析是否正常"])
    # 给“利润”红色字体（负数高亮）
    ws2.cell(row=4, column=2).font = Font(color="FF0000", italic=True)
    ws2.cell(row=1, column=1).font = Font(bold=True, size=14)
    _style_header(ws2, 2)
    ws2.merge_cells("A1:B1")

    # Sheet3: 数据表（更多行、重复值 + 表头样式 + 公式列）
    ws3 = wb.create_sheet("数据表")
    ws3.append(["序号", "数值", "双倍"])
    for i in range(1, 21):
        ws3.append([i, i * 3.14, i * 6.28])
    _style_header(ws3, 3)
    # 公式：在数值列下方加 SUM
    ws3.append(["合计", "=SUM(B2:B21)", "=SUM(C2:C21)"])

    out = os.path.join(HERE, "complex.xlsx")
    wb.save(out)
    print("wrote", out)


if __name__ == "__main__":
    gen_xlsx()
