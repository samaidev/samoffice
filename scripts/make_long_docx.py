import docx
d = docx.Document()
# 一个超长单段落，约 36 页文字量（连续不分段），用于触发段落内部跨页
para = ('这是一段用于分页引擎自测的普通中文文本，用来验证段落是否能正确跨页拆分。') * 400
d.add_paragraph(para)
# 再补一个短段落，确保后续页也有内容
d.add_paragraph('第二段短文字，用于确认分页在跨页段落之后仍能正常继续。')
d.save('build/long_para.docx')
print('saved build/long_para.docx')
