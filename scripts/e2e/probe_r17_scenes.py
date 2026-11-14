#!/usr/bin/env python3
"""快速滚动 + 悬停表格（不点击）复现跳变；再试选中文本后滚动（mini toolbar 场景）。"""
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:18400'
DOCX = '/home/z/my-project/upload/1.公共配套内部化与规模产业空间建设的有益探索.docx'
SHOTS = '/home/z/my-project/samoffice/scripts/e2e/shots-r17'

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1400, 'height': 950})
    page.goto(BASE + '/', wait_until='domcontentloaded')
    page.wait_for_timeout(2000)
    page.click('[data-testid="menu-files"]')
    page.wait_for_timeout(300)
    with page.expect_file_chooser() as fc:
        page.click('[data-testid="menu-打开文件"], [data-testid="menu-open-file"]')
    fc.value.set_files(DOCX)
    page.wait_for_timeout(4500)

    # 跳变监控（阈值 150px，比滚轮单步 300 小一半）
    page.evaluate('''() => {
        window.__jumpLog = []
        window.__getSc = () => { const tbl = document.querySelector('.ProseMirror table')
            let sc = tbl
            while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
            return sc }
        const sc = window.__getSc()
        let last = sc.scrollTop
        sc.addEventListener('scroll', () => {
            const d = sc.scrollTop - last
            if (Math.abs(d) > 150) window.__jumpLog.push({ t: Date.now(), from: last, to: sc.scrollTop, d })
            last = sc.scrollTop
        }, { passive: true })
    }''')

    # 场景A：快速连滚（模拟真实滚轮惯性），鼠标悬停文档中间（会经过表格）
    sc = page.evaluate('() => { const sc = window.__getSc(); const r = sc.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 } }')
    page.mouse.move(sc['x'], sc['y'])
    print('场景A：快速连滚 20×300px（无光标，纯悬停）')
    for _ in range(20):
        page.mouse.wheel(0, 300)
        page.wait_for_timeout(40)
    page.wait_for_timeout(2000)
    log = page.evaluate('() => window.__jumpLog')
    print('  跳变记录:', log if log else '无')
    page.evaluate('() => { window.__jumpLog = []; const sc = window.__getSc(); sc.scrollTop = 0 }')
    page.wait_for_timeout(600)

    # 场景B：先选中文本（出现悬浮工具栏），再滚动
    print('场景B：选中正文文本（悬浮工具栏出现）后滚动')
    page.evaluate('() => { const sc = window.__getSc(); sc.scrollTop = 600 }')
    page.wait_for_timeout(500)
    # 双击选词
    scb = page.evaluate('() => { const sc = window.__getSc(); const r = sc.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + 100 } }')
    page.mouse.dblclick(scb['x'], scb['y'])
    page.wait_for_timeout(700)
    has_tb = page.evaluate('() => !!document.querySelector(".fixed.z-50")')
    print('  悬浮工具栏出现:', has_tb)
    for _ in range(10):
        page.mouse.wheel(0, 300)
        page.wait_for_timeout(60)
    page.wait_for_timeout(1500)
    log = page.evaluate('() => window.__jumpLog')
    print('  跳变记录:', log if log else '无')
    page.screenshot(path=f'{SHOTS}/scene_b_after.png')

    # 场景C：表格内选中（CellSelection）后滚动
    print('场景C：表格内三击选中段落/拖选后滚动')
    page.evaluate('() => { const sc = window.__getSc(); sc.scrollTop = 0 }')
    page.wait_for_timeout(400)
    # 滚到表格处
    page.evaluate('''() => { const sc = window.__getSc()
        const tbl = document.querySelector('.ProseMirror table')
        let top = 0, el = tbl
        while (el && el !== sc) { top += el.offsetTop; el = el.offsetParent }
        sc.scrollTop = top - 100 }''')
    page.wait_for_timeout(700)
    pos = page.evaluate('''() => { const sc = window.__getSc(); const tbl = document.querySelector('.ProseMirror table'); const r = sc.getBoundingClientRect(); const tr = tbl.getBoundingClientRect()
        return { x: r.x + r.width/2, y: Math.max(r.y + 50, tr.y + 30) } }''')
    # 从表格第一行拖选到第三行（产生跨格选区）
    page.mouse.move(pos['x'], pos['y'])
    page.mouse.down()
    page.mouse.move(pos['x'], pos['y'] + 80, steps=5)
    page.mouse.up()
    page.wait_for_timeout(800)
    selected = page.evaluate('() => document.querySelectorAll(".ProseMirror .selectedCell").length')
    print('  选中单元格数:', selected)
    for _ in range(10):
        page.mouse.wheel(0, 300)
        page.wait_for_timeout(60)
    page.wait_for_timeout(1500)
    log = page.evaluate('() => window.__jumpLog')
    print('  跳变记录:', log if log else '无')
    page.screenshot(path=f'{SHOTS}/scene_c_after.png')

    # 场景D：表格跨页边界处，点击表格内并打字（编辑导致重排）
    print('场景D：表格跨页边界，光标在表内打字')
    page.evaluate('''() => { const sc = window.__getSc()
        const tbl = document.querySelector('.ProseMirror table')
        let top = 0, el = tbl
        while (el && el !== sc) { top += el.offsetTop; el = el.offsetParent }
        sc.scrollTop = top + 350 }''')  # 表格中部（跨页断裂处附近）
    page.wait_for_timeout(700)
    pos = page.evaluate('''() => { const sc = window.__getSc(); const tbl = document.querySelector('.ProseMirror table'); const r = sc.getBoundingClientRect(); const tr = tbl.getBoundingClientRect()
        return { x: r.x + 200, y: Math.max(r.y + 50, Math.min(tr.y + 300, r.bottom - 50)) } }''')
    page.mouse.click(pos['x'], pos['y'])
    page.wait_for_timeout(600)
    st0 = page.evaluate('() => window.__getSc().scrollTop')
    for ch in 'ABCDEF':
        page.keyboard.type(ch, delay=100)
    page.wait_for_timeout(1200)
    st1 = page.evaluate('() => window.__getSc().scrollTop')
    print(f'  打字前 {st0} → 打字后 {st1} →', 'JUMPED!!' if abs(st1 - st0) > 60 else 'stable')
    log = page.evaluate('() => window.__jumpLog')
    print('  跳变记录:', log if log else '无')
    page.screenshot(path=f'{SHOTS}/scene_d_after.png')
    browser.close()
