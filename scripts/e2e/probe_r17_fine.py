#!/usr/bin/env python3
"""细粒度滚动测试：慢速滚过表格区域，监测 scrollTop 异常跳变 + PM 事务。"""
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:18400'
DOCX = '/home/z/my-project/upload/1.公共配套内部化与规模产业空间建设的有益探索.docx'
SHOTS = '/home/z/my-project/samoffice/scripts/e2e/shots-r17'

GET_STATE = '''() => {
    const tbl = document.querySelector('.ProseMirror table')
    if (!tbl) return null
    let sc = tbl
    while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
    let top = 0, el = tbl
    while (el && el !== sc) { top += el.offsetTop; el = el.offsetParent }
    return { scrollTop: sc.scrollTop, tblTop: top, tblH: tbl.offsetHeight }
}'''

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1400, 'height': 950})
    page.on('console', lambda m: print('[CONSOLE]', m.text[:180]) if any(k in m.text for k in ('[TR]', 'jump', '[PAG]')) else None)
    page.goto(BASE + '/', wait_until='domcontentloaded')
    page.wait_for_timeout(2000)
    page.click('[data-testid="menu-files"]')
    page.wait_for_timeout(300)
    with page.expect_file_chooser() as fc:
        page.click('[data-testid="menu-打开文件"], [data-testid="menu-open-file"]')
    fc.value.set_files(DOCX)
    page.wait_for_timeout(4500)

    st = page.evaluate(GET_STATE)
    print('table at', st['tblTop'], 'height', st['tblH'], 'scrollMax?', st)

    # 安装跳变监控
    page.evaluate('''() => {
        window.__jumpLog = []
        const tbl = document.querySelector('.ProseMirror table')
        let sc = tbl
        while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
        window.__sc = sc
        let last = sc.scrollTop
        sc.addEventListener('scroll', () => {
            const d = sc.scrollTop - last
            if (Math.abs(d) > 80) window.__jumpLog.push({ at: Date.now(), from: last, to: sc.scrollTop, delta: d })
            last = sc.scrollTop
        }, { passive: true })
        // PM dispatch 探针
        const v = window.__pmView
        if (v) {
            const orig = v.dispatch.bind(v)
            v.dispatch = (tr) => {
                if (tr.docChanged || tr.selectionSet) console.log('[TR] docChanged=' + tr.docChanged + ' selSet=' + tr.selectionSet + ' scrollIntoView=' + !!(tr.scrolledIntoView))
                return orig(tr)
            }
        }
    }''')

    # 先点击表格内部（光标进表格，模拟用户正在编辑表格场景）
    sc_info = page.evaluate('''() => {
        const tbl = document.querySelector('.ProseMirror table')
        let sc = tbl
        while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
        const r = sc.getBoundingClientRect()
        const tr = tbl.getBoundingClientRect()
        return { vx: r.x + r.width/2, vy: Math.max(r.y + 20, Math.min(tr.y + 40, r.bottom - 20)) }
    }''')
    # 滚到表格附近
    st = page.evaluate(GET_STATE)
    page.evaluate('''(top) => { window.__sc.scrollTop = top }''', max(0, st['tblTop'] - 100))
    page.wait_for_timeout(800)
    sc_info = page.evaluate('''() => {
        const tbl = document.querySelector('.ProseMirror table')
        let sc = tbl
        while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
        const r = sc.getBoundingClientRect()
        const tr = tbl.getBoundingClientRect()
        return { vx: r.x + r.width/2, vy: Math.max(r.y + 20, Math.min(tr.y + 40, r.bottom - 20)) }
    }''')
    page.mouse.click(sc_info['vx'], sc_info['vy'])
    page.wait_for_timeout(800)
    print('cursor in table. scrollTop =', page.evaluate(GET_STATE)['scrollTop'])

    # 慢速小步滚动穿过表格区域（表格顶 tblTop，高 ~583，滚 1200px 覆盖全程）
    jumps = 0
    for i in range(14):
        page.mouse.wheel(0, 100)
        page.wait_for_timeout(260)
        st = page.evaluate(GET_STATE)
        expected = st['scrollTop']
        log = page.evaluate('() => window.__jumpLog')
        if log:
            for j in log:
                print(f'  ⚠ 跳变: {j["from"]} → {j["to"]} (Δ{j["delta"]})')
            jumps += len(log)
            page.evaluate('() => { window.__jumpLog = [] }')
    print('down pass done, jumps =', jumps)
    # 反向再滚回去
    for i in range(14):
        page.mouse.wheel(0, -100)
        page.wait_for_timeout(260)
        log = page.evaluate('() => window.__jumpLog')
        if log:
            for j in log:
                print(f'  ⚠ 跳变(上滚): {j["from"]} → {j["to"]} (Δ{j["delta"]})')
            page.evaluate('() => { window.__jumpLog = [] }')
    print('up pass done')
    page.screenshot(path=f'{SHOTS}/fine_scroll_end.png')
    browser.close()
