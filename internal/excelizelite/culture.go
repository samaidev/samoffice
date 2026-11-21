package excelize

// culture.go — [v1.7.73] excelizelite 裁剪版补件：CultureName 与默认区域
// （原 numfmt.go 369KB 已裁剪；日期显示走原始值，后续按需补最小格式化）。

// CultureName 直接映射语言文化默认格式模式（裁剪版）。
type CultureName struct {
	ShortDatePattern  string `xml:"shortDatePattern,attr,omitempty"`
	LongDatePattern   string `xml:"longDatePattern,attr,omitempty"`
	LongTimePattern   string `xml:"longTimePattern,attr,omitempty"`
	DurationPattern   string `xml:"durationPattern,attr,omitempty"`
	Separator         string `xml:"separator,attr,omitempty"`
	TextQualifier     string `xml:"textQualifier,attr,omitempty"`
}

// getCultureInfo 返回默认文化（en-US 模式；裁剪版不做区域探测）。
func getCultureInfo(_ string) *CultureName {
	return &CultureName{
		ShortDatePattern: "m/d/yyyy",
		LongDatePattern:  "dddd, mmmm dd, yyyy",
		LongTimePattern:  "h:mm:ss AM/PM",
		DurationPattern:  "[h]:mm:ss",
		Separator:        ",",
		TextQualifier:    "\"",
	}
}
