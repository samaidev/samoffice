#!/usr/bin/env python3
"""综合 E2E 验证：滚动稳定性 + 滚动条可见性（headed 模式）+ 悬浮菜单移除。"""
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:18400'
DOCX = '/home/z/my-project/upload/1.公共配套内部化与规模产业空间建设的有益探索.docx'
SHOTS = '/home/z/my-project/samoffice/scripts/e2e/shots-r17'

with sync_playwright() as p:
    b = p.chromium.launch(headless=False, args=['--no-sandbox', '--disable-dev-shm-usage'])  # headed: 真实滚动条渲染
    page = b.new_page(viewport={'width': 1400, 'height': 950})
    page.goto(BASE + '/', wait_until='domcontentloaded')
    page.wait_for_timeout(2500)
    page.click('[data-testid="menu-files"]')
    page.wait_for_timeout(400)
    with page.expect_file_chooser() as fc:
        page.click('[data-testid="menu-打开文件"], [data-testid="menu-open-file"]')
    fc.value.set_files(DOCX)
    page.wait_for_timeout(4500)

    # ========== 1. 悬浮格式菜单移除验证 ==========
    # 选中一段文字（双击选词）看是否出现悬浮工具栏
    sc = page.evaluate('''() => { const tbl = document.querySelector('.ProseMirror table'); let sc = tbl
        while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
        const r = sc.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + 120 } }''')
    page.evaluate('() => { const el = document.querySelector(".ProseMirror table"); let sc = el; while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === "auto" || cs.overflowY === "scroll") break; sc = sc.parentElement } sc.scrollTop = 500 }')
    page.wait_for_timeout(600)
    pos = page.evaluate('''() => { const el = document.querySelector('.ProseMirror'); const r = el.getBoundingClientRect()
        // 找一个正文段落的中心
        const ps = el.querySelectorAll('p')
        for (const pp of ps) { if (pp.textContent.trim().length > 20) { const pr = pp.getBoundingClientRect(); return { x: pr.x + 40, y: pr.y + 8 } } }
        return { x: r.x + 100, y: r.y + 100 } }''')
    page.mouse.dblclick(pos['x'], pos['y'])
    page.wait_for_timeout(800)
    mini = page.evaluate('''() => {
        // 悬浮工具栏特征：fixed 定位的小按钮条（B/I/U 按钮）
        const btns = Array.from(document.querySelectorAll('.fixed.z-50 button'))
        return btns.map(x => (x.textContent || '').trim()).filter(Boolean).slice(0, 8)
    }''')
    print('1. 选中文本后悬浮工具栏按钮:', mini if mini else '无 ✓（已移除）')
    page.keyboard.press('Escape')

    # ========== 2. 滚动条可见性验证（headed 模式实测渲染像素）==========
    page.evaluate('() => { const el = document.querySelector(".ProseMirror table"); let sc = el; while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === "auto" || cs.overflowY === "scroll") break; sc = sc.parentElement } sc.scrollTop = 0 }')
    page.wait_for_timeout(600)
    sb = page.evaluate('''() => { const el = document.querySelector(".ProseMirror table"); let sc = el
        while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
        return { w: sc.offsetWidth - sc.clientWidth, anchor: getComputedStyle(sc).overflowAnchor } }''')
    print(f'2. 滚动条占位 {sb["w"]}px（应≈12），overflow-anchor={sb["anchor"]}（应 none）')
    # 截取滚动条区域
    rect = page.evaluate('''() => { const el = document.querySelector(".ProseMirror table"); let sc = el
        while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
        const r = sc.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }''')
    page.screenshot(path=f'{SHOTS}/scrollbar_strip.png', clip={'x': rect['x'] + rect['w'] - 18, 'y': rect['y'], 'width': 18, 'height': rect['h']})
    page.screenshot(path=f'{SHOTS}/full_with_scrollbar.png')

    # ========== 3. 滚动稳定性（光标在表格内滚走+打字）==========
    page.evaluate('''() => { const el = document.querySelector(".ProseMirror table"); let sc = el
        while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
        const tbl = document.querySelector('.ProseMirror table')
        let top = 0, e = tbl
        while (e && e !== sc) { top += e.offsetTop; e = e.offsetParent }
        sc.scrollTop = top - 100 }''')
    page.wait_for_timeout(700)
    pos = page.evaluate('''() => { const el = document.querySelector('.ProseMirror table'); let sc = el; while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
        const r = sc.getBoundingClientRect(); const tr = el.getBoundingClientRect()
        return { x: r.x + 150, y: Math.max(r.y + 30, tr.y + 20) } }''')
    page.mouse.click(pos['x'], pos['y'])
    page.wait_for_timeout(700)
    st0 = page.evaluate('''() => { const el = document.querySelector(".ProseMirror table"); let sc = el; while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement } return sc.scrollTop }''')
    # 打字（表格内编辑）
    for ch in '测试数据ABC':
        page.keyboard.type(ch, delay=110)
    page.wait_for_timeout(1500)
    st1 = page.evaluate('''() => { const el = document.querySelector(".ProseMirror table"); let sc = el; while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement } return sc.scrollTop }''')
    d = abs(st1 - st0)
    print(f'3. 表格内打字 7 字符：scrollTop {st0} → {st1}（Δ{st1-st0}）{"可控（跟随光标小幅滚动）" if d < 200 else "大跳变!"}')
    # 滚轮离开再回来
    for _ in range(8):
        page.mouse.wheel(0, 350)
        page.wait_for_timeout(100)
    page.wait_for_timeout(1000)
    st2 = page.evaluate('''() => { const el = document.querySelector(".ProseMirror table"); let sc = el; while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement } return sc.scrollTop }''')
    page.wait_for_timeout(1500)
    st3 = page.evaluate('''() => { const el = document.querySelector(".ProseMirror table"); let sc = el; while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement } return sc.scrollTop }''')
    print(f'   滚轮滚走后静止 1.5s：{st2} → {st3} {"稳定 ✓" if abs(st3-st2) < 50 else "仍在跳变!"}')
    b.close()
