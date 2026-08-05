import { useI18n } from '../i18n'

export function AboutPage() {
  const { t } = useI18n()
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
            <span className="text-xs font-semibold">{t('about.badge')}</span>
          </div>
          <h1
            className="text-4xl md:text-5xl font-bold mb-4"
            style={{ letterSpacing: '-0.03em', color: 'var(--color-text)' }}
          >
            SamOffice
          </h1>
          <p className="text-lg mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            {t('about.tagline')}
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
            · {t('about.aiLeader')}
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
                {t('about.aboutSamai')}
              </h2>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {t('about.samaiDesc1')}
              </p>
            </div>
          </div>
          <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            <strong style={{ color: 'var(--color-text)' }}>SamAI</strong> {t('about.samaiDesc2')} {t('about.samaiDesc3')}
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {t('about.samofficeDesc1')} {t('about.samofficeDesc2')}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="https://samai.cc"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
            >
              🌐 {t('about.visit')}
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
            <span>✨</span> {t('about.features')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { icon: '📄', title: t('about.feat.doc.title'), desc: t('about.feat.doc.desc') },
              { icon: '📊', title: t('about.feat.sheet.title'), desc: t('about.feat.sheet.desc') },
              { icon: '🎞', title: t('about.feat.slide.title'), desc: t('about.feat.slide.desc') },
              { icon: '📝', title: t('about.feat.md.title'), desc: t('about.feat.md.desc') },
              { icon: '🌐', title: t('about.feat.html.title'), desc: t('about.feat.html.desc') },
              { icon: '📑', title: t('about.feat.toc.title'), desc: t('about.feat.toc.desc') },
              { icon: '🔍', title: t('about.feat.spell.title'), desc: t('about.feat.spell.desc') },
              { icon: '📕', title: t('about.feat.pdf.title'), desc: t('about.feat.pdf.desc') },
              { icon: '📄', title: t('about.feat.docx.title'), desc: t('about.feat.docx.desc') },
              { icon: '🎨', title: t('about.feat.dark.title'), desc: t('about.feat.dark.desc') },
              { icon: '📱', title: t('about.feat.responsive.title'), desc: t('about.feat.responsive.desc') },
              { icon: '🔒', title: t('about.feat.deploy.title'), desc: t('about.feat.deploy.desc') },
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
            <span>🛠</span> {t('about.techStack')}
          </h2>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{t('about.backend')}</div>
              <div className="flex flex-wrap gap-1.5">
                {['Go 1.24', 'Gin', 'excelize', 'gopdf', 'SQLite', 'SymSpell', 'Hunspell', 'jieba'].map(tech => (
                  <span key={tech} className="badge">{tech}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{t('about.frontend')}</div>
              <div className="flex flex-wrap gap-1.5">
                {['React 18', 'TypeScript', 'Vite', 'Tailwind CSS', 'ProseMirror', 'marked.js', 'highlight.js'].map(tech => (
                  <span key={tech} className="badge">{tech}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{t('about.desktop')}</div>
              <div className="flex flex-wrap gap-1.5">
                {['Wails v2', 'WebView2/WKWebView'].map(tech => (
                  <span key={tech} className="badge">{tech}</span>
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
            {t('about.commitment')}
          </h3>
          <p className="text-xs mb-4 max-w-md mx-auto" style={{ color: 'var(--color-text-secondary)' }}>
            {t('about.commitmentDesc')}
          </p>
          <div className="flex flex-wrap justify-center gap-2 text-xs">
            <span className="badge badge-success">MIT License</span>
            <span className="badge badge-warning">Self-hosted</span>
            <span className="badge">Cross-platform</span>
          </div>
        </section>

        <div className="text-center mt-8 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <p>SamOffice v0.4.0 · Made with ❤️ by SamAI Group</p>
          <p className="mt-1">
            <a href="https://samai.cc" target="_blank" rel="noopener noreferrer" className="hover:underline">
              samai.cc
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
