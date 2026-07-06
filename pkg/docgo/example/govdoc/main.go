package main

import (
	"fmt"
	"log"

	"github.com/zai/gooffice/pkg/docgo"
)

// 政府公文字体字号常量 (GB/T 9704-2012)
// 字号: 2号=22pt, 3号=16pt, 4号=14pt, 小标宋=36pt(红头用)
const (
	fontRedHead = "方正小标宋简体"   // 发文机关红头
	fontTitle   = "方正小标宋简体"   // 公文大标题 (2号小标宋)
	fontBody    = "仿宋_GB2312"     // 正文通用 (3号仿宋)
	fontH1      = "黑体"            // 一级标题 (3号黑体)
	fontH2      = "楷体_GB2312"     // 二级标题 (3号楷体)
	fontNum     = "Times New Roman" // 数字英文
	fontPageNum = "宋体"            // 页码 (四号半角宋体)

	sizeRedHead = 36 // 红头 (放大)
	sizeTitle   = 22 // 2号
	sizeBody    = 16 // 3号
	sizeH1      = 16 // 3号
	sizeH2      = 16 // 3号
	sizeFooter  = 14 // 四号
	sizePageNum = 14 // 四号
)

func main() {
	doc := docgo.New()
	doc.SetTitle("关于推进办公软件标准化建设的通知")
	doc.SetAuthor("SamAI 集团办公厅")
	doc.SetSubject("政府公文标准排版测试")

	// === 页面设置 (GB/T 9704-2012) ===
	doc.SetPageSize(docgo.DefaultPageSize()) // A4
	doc.SetGovMargins()                       // 上3.7 下3.5 左2.8 右2.6 cm
	doc.SetDocGrid(28, 22)                    // 每行28字 每页22行
	doc.SetRedHeaderLine(true)
	doc.SetPageNumber(true)

	// === 版头 ===
	// 份号 (6位3号阿拉伯数字，版心左上角顶格)
	p := doc.AddParagraph("")
	p.SetAlign("left")
	p.SetLineSpacingExact(28)
	run := p.AddRun("000001")
	run.Font(fontBody).Size(sizeBody)

	// 密级 (3号黑体)
	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetLineSpacingExact(28)
	run = p.AddRun("秘密★1年")
	run.Font(fontH1).Size(sizeBody)

	// 发文机关红头 (红色小标宋，居中，字间距拉开)
	p = doc.AddParagraph("")
	p.SetAlign("center")
	p.SetSpaceBefore(20)
	p.SetSpaceAfter(10)
	p.SetCharSpacing(10) // 字间距拉开
	run = p.AddRun("SamAI 集团文件")
	run.Font(fontRedHead).Size(sizeRedHead).Color("FF0000")

	// 发文字号 (3号仿宋，居中)
	p = doc.AddParagraph("")
	p.SetAlign("center")
	p.SetLineSpacingExact(28)
	p.SetSpaceAfter(10)
	run = p.AddRun("SamAI〔2026〕7号")
	run.Font(fontBody).Size(sizeBody)

	// 红色分隔线 (通过段落红色下划线实现)
	p = doc.AddParagraph("")
	p.SetRedBottomLine(true)
	p.SetSpaceAfter(20)

	// === 正文 ===
	// 公文大标题 (2号小标宋，居中，分隔线下空2行)
	p = doc.AddParagraph("")
	p.SetAlign("center")
	p.SetSpaceBefore(56) // 空2行 (28pt × 2)
	p.SetSpaceAfter(28)
	p.SetLineSpacingExact(28)
	run = p.AddRun("关于推进办公软件标准化建设的通知")
	run.Font(fontTitle).Size(sizeTitle)

	// 主送机关 (3号仿宋，标题下空1行)
	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetSpaceBefore(28)
	p.SetLineSpacingExact(28)
	run = p.AddRun("各分公司、各部门：")
	run.Font(fontBody).Size(sizeBody)

	// 正文段落 (3号仿宋，首行缩进2字符，固定值28磅，两端对齐)
	p = doc.AddParagraph("")
	p.SetAlign("justify")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	run = p.AddRun("为贯彻落实办公软件标准化建设要求，提升公文处理效率和质量，现就推进办公软件标准化建设有关事项通知如下。")
	run.Font(fontBody).Size(sizeBody)

	// 一级标题 (3号黑体，独占一行)
	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	p.SetSpaceBefore(14)
	run = p.AddRun("一、总体要求")
	run.Font(fontH1).Size(sizeH1)

	// 正文
	p = doc.AddParagraph("")
	p.SetAlign("justify")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	run = p.AddRun("以习近平新时代中国特色社会主义思想为指导，全面贯彻党的二十大和二十届历次全会精神，坚持统一标准、分步实施、注重实效的原则，力争用三年时间建成统一的办公软件标准体系。")
	run.Font(fontBody).Size(sizeBody)

	// 二级标题 (3号楷体)
	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	p.SetSpaceBefore(7)
	run = p.AddRun("（一）统一标准规范")
	run.Font(fontH2).Size(sizeH2)

	// 正文
	p = doc.AddParagraph("")
	p.SetAlign("justify")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	run = p.AddRun("制定统一的文件格式、排版规范、字体字号标准，确保各类公文格式一致、风格统一。严格执行 GB/T 9704-2012《党政机关公文格式》国家标准。")
	run.Font(fontBody).Size(sizeBody)

	// 三级标题 (3号仿宋加粗)
	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	p.SetSpaceBefore(7)
	run = p.AddRun("1.字体字号规范")
	run.Font(fontBody).Size(sizeBody).Bold(true)

	// 正文
	p = doc.AddParagraph("")
	p.SetAlign("justify")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	run = p.AddRun("正文统一使用 3 号仿宋_GB2312 字体，数字和英文使用 Times New Roman。一级标题用黑体，二级标题用楷体_GB2312，标题序号依次为一、（一）、1.、（1）。")
	run.Font(fontBody).Size(sizeBody)

	// 四级标题 (3号仿宋常规)
	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	p.SetSpaceBefore(7)
	run = p.AddRun("（1）行距与段落")
	run.Font(fontBody).Size(sizeBody)

	// 正文
	p = doc.AddParagraph("")
	p.SetAlign("justify")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	run = p.AddRun("正文统一采用固定值 28 磅行距，禁止单倍或多倍行距。每段首行缩进 2 字符，段前段后 0 行。每页 22 行，每行 28 字。")
	run.Font(fontBody).Size(sizeBody)

	// 一级标题
	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	p.SetSpaceBefore(14)
	run = p.AddRun("二、重点任务")
	run.Font(fontH1).Size(sizeH1)

	// 正文
	p = doc.AddParagraph("")
	p.SetAlign("justify")
	p.SetFirstLineIndent(2)
	p.SetLineSpacingExact(28)
	run = p.AddRun("一是完善标准体系。二是推进平台建设。三是加强培训指导。四是强化监督检查。")
	run.Font(fontBody).Size(sizeBody)

	// 附件说明
	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetLineSpacingExact(28)
	p.SetSpaceBefore(28)
	run = p.AddRun("附件：1.办公软件标准化建设实施方案")
	run.Font(fontBody).Size(sizeBody)

	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetLineSpacingExact(28)
	run = p.AddRun("      2.公文格式规范对照表")
	run.Font(fontBody).Size(sizeBody)

	// 落款 (发文机关 + 成文日期)
	p = doc.AddParagraph("")
	p.SetAlign("right")
	p.SetLineSpacingExact(28)
	p.SetSpaceBefore(28)
	run = p.AddRun("SamAI 集团办公厅                    ")
	run.Font(fontBody).Size(sizeBody)

	p = doc.AddParagraph("")
	p.SetAlign("right")
	p.SetLineSpacingExact(28)
	run = p.AddRun("2026年7月6日                        ")
	run.Font(fontBody).Size(sizeBody)

	// === 版记 ===
	p = doc.AddParagraph("")
	p.SetRedBottomLine(true)
	p.SetSpaceBefore(40)

	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetLineSpacingExact(28)
	run = p.AddRun("抄送：集团领导，各部门。")
	run.Font(fontBody).Size(sizeFooter)

	p = doc.AddParagraph("")
	p.SetAlign("left")
	p.SetLineSpacingExact(28)
	run = p.AddRun("SamAI 集团办公厅                        2026年7月6日印发")
	run.Font(fontBody).Size(sizeFooter)

	p = doc.AddParagraph("")
	p.SetRedBottomLine(true)

	// 保存
	outPath := "/home/z/my-project/download/政府公文-GB9704标准.docx"
	if err := doc.Save(outPath); err != nil {
		log.Fatal(err)
	}
	fmt.Printf("✅ 已保存 %s\n", outPath)
	fmt.Printf("   元素数: %d\n", len(doc.Elements()))
}
