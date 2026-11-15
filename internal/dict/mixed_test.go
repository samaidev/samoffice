package dict

import "testing"

// 单语言与 mixed 双模式的拼写检查回归测试。
// 修复背景：重构 mixed 支持时把单语言 en 模式的词典路由误指向仅 mixed 预取的
// enIdx（nil），导致英文拼写检查全部静默跳过（服务端返回空错误列表）。
func TestSpellCheckMixed(t *testing.T) {
	m := NewManager(nil)
	m.MarkReady()
	if err := m.RegisterLang("en", map[string]int{"the": 1000, "quick": 500, "brown": 300}); err != nil {
		t.Fatalf("register en: %v", err)
	}
	// en 单语言：错词报错、正确词放行
	errs := m.SpellCheck("teh quikc brown", "en")
	if len(errs) != 2 {
		t.Fatalf("en mode: want 2 errors (teh, quikc), got %d: %v", len(errs), errs)
	}
	// mixed 模式：英文部分照常检查（无 zh 词典时 CJK token 直接跳过不误报）
	mixedErrs := m.SpellCheck("teh quikc brown", "mixed")
	if len(mixedErrs) != 2 {
		t.Fatalf("mixed mode: want 2 errors, got %d: %v", len(mixedErrs), mixedErrs)
	}
	for _, e := range mixedErrs {
		if e.Lang != "en" {
			t.Fatalf("mixed mode: latin token routed to %q, want en", e.Lang)
		}
	}
	// CJK 文本在无中文词典的 mixed 模式下不报错（无法校验即跳过）
	zhErrs := m.SpellCheck("我们的世界", "mixed")
	if len(zhErrs) != 0 {
		t.Fatalf("mixed mode without zh dict: CJK should be skipped, got %v", zhErrs)
	}
}
