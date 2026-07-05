export function AboutPage() {
  return (
    <div
      className="h-full overflow-auto"
      style={{ background: 'linear-gradient(180deg, #FEFCE8 0%, var(--color-bg) 60%)' }}
    >
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full mb-4"
            style={{
              background: 'rgba(217, 119, 6, 0.1)',
              border: '1px solid rgba(217, 119, 6, 0.2)',
              color: '#C96442',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>
            <span className="text-xs font-semibold">SamAI Group · 公益开源</span>
          </div>
          <h1
            className="text-4xl md:text-5xl font-bold mb-4"
            style={{ letterSpacing: '-0.03em', color: 'var(--color-text)' }}
          >
            GoOffice
          </h1>
          <p className="text-lg mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            跨平台办公套件 · 用 Go + Web 构建
          </p>
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Powered by{' '}
            <a
              href="https://samai.cc"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold hover:underline"
              style={{ color: '#C96442' }}
            >
              SamAI
            </a>{' '}
            · 全球领先 AI 集团
          </p>
        </div>

        {/* 关于 SamAI */}
        <section
          className="rounded-2xl p-6 mb-6"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div className="flex items-start gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
              style={{ background: 'rgba(217, 119, 6, 0.1)' }}
            >
              🏢
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
                关于 SamAI 集团
              </h2>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                总部位于新加坡，全球领先的全栈智能未来构建者
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            <strong style={{ color: 'var(--color-text)' }}>SamAI</strong> 是一家全球领先的 AI 集团，致力于构建从通信到自动化、从企业到个人的全栈智能未来。
            我们相信 AI 应当普惠大众，因此所有开源项目均完全免费、无广告、无订阅、无遥测，永久公益。
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            GoOffice 是 SamAI 集团公益开源项目之一，旨在为全球用户提供一款轻量、跨平台、
            可自部署的办公套件，覆盖文档、表格、演示、Markdown、HTML 编辑全场景。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="https://samai.cc"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
            >
              🌐 访问 samai.cc
            </a>
            <a
              href="https://github.com/samaidev"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline btn-sm"
            >
              📦 GitHub 开源
            </a>
          </div>
        </section>

        {/* 核心特性 */}
        <section
          className="rounded-2xl p-6 mb-6"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <span>✨</span> 核心特性
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { icon: '📄', title: '文档编辑', desc: '基于 ProseMirror 的富文本编辑器，支持标题/列表/代码块/粗斜体' },
              { icon: '📊', title: '表格编辑', desc: '多 Sheet 工作表，公式栏，行列高亮' },
              { icon: '🎞', title: '演示文稿', desc: '多布局幻灯片，16:9 画布，预设模板' },
              { icon: '📝', title: 'Markdown', desc: '分屏编辑+实时预览，代码高亮，自动目录' },
              { icon: '🌐', title: 'HTML 编辑', desc: '源码编辑+实时预览，安全沙箱渲染' },
              { icon: '📑', title: '智能目录', desc: '自动提取标题层级，点击跳转，编辑预览同步' },
              { icon: '🔍', title: '拼写检查', desc: 'SymSpell 算法 + Hunspell 词库 + jieba 中文分词' },
              { icon: '📕', title: 'PDF 导出', desc: '纯 Go 实现，嵌入中文字体，支持表格/图片' },
              { icon: '📄', title: 'docx 导出', desc: 'OOXML 标准，被 Word/WPS 兼容，支持图片嵌入' },
              { icon: '🎨', title: '深色模式', desc: '跟随系统主题，三态切换（浅色/深色/自动）' },
              { icon: '📱', title: '响应式', desc: '桌面端 + 移动端自适应，汉堡菜单+底部 sheet' },
              { icon: '🔒', title: '可自部署', desc: 'Go 单二进制，无外部依赖，数据本地存储' },
            ].map((f, i) => (
              <div
                key={i}
                className="p-3 rounded-lg transition-colors hover:bg-slate-50"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <div className="flex items-start gap-2">
                  <span className="text-lg flex-shrink-0">{f.icon}</span>
                  <div>
                    <div className="text-sm font-semibold mb-0.5" style={{ color: 'var(--color-text)' }}>
                      {f.title}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      {f.desc}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 技术栈 */}
        <section
          className="rounded-2xl p-6 mb-6"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <span>🛠</span> 技术栈
          </h2>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>后端</div>
              <div className="flex flex-wrap gap-1.5">
                {['Go 1.24', 'Gin', 'excelize', 'gopdf', 'SQLite', 'SymSpell', 'Hunspell', 'jieba'].map(t => (
                  <span key={t} className="badge">{t}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>前端</div>
              <div className="flex flex-wrap gap-1.5">
                {['React 18', 'TypeScript', 'Vite', 'Tailwind CSS', 'ProseMirror', 'marked.js', 'highlight.js'].map(t => (
                  <span key={t} className="badge">{t}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>桌面</div>
              <div className="flex flex-wrap gap-1.5">
                {['Wails v2', 'WebView2/WKWebView'].map(t => (
                  <span key={t} className="badge">{t}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 公益承诺 */}
        <section
          className="rounded-2xl p-6 text-center"
          style={{
            background: 'linear-gradient(135deg, rgba(217, 119, 6, 0.05) 0%, rgba(124, 58, 237, 0.05) 100%)',
            border: '1px solid var(--color-border)',
          }}
        >
          <div className="text-2xl mb-3">🌍</div>
          <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
            永久公益 · 完全免费
          </h3>
          <p className="text-xs mb-4 max-w-md mx-auto" style={{ color: 'var(--color-text-secondary)' }}>
            无广告 · 无订阅 · 无遥测 · 永久开源
          </p>
          <div className="flex flex-wrap justify-center gap-2 text-xs">
            <span className="badge badge-success">MIT License</span>
            <span className="badge badge-warning">Self-hosted</span>
            <span className="badge">Cross-platform</span>
          </div>
        </section>

        <div className="text-center mt-8 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <p>GoOffice v0.4.0 · Made with ❤️ by SamAI Group</p>
          <p className="mt-1">
            <a href="https://samai.cc" target="_blank" rel="noopener noreferrer" className="hover:underline">
              samai.cc
            </a>
            {' · '}
            <a href="https://github.com/samaidev/samoffice" target="_blank" rel="noopener noreferrer" className="hover:underline">
              GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
