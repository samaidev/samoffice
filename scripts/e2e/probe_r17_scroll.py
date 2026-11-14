#!/usr/bin/env python3
"""探查文档编辑器的滚动容器层级。"""
from playwright.sync_api import sync_playwright
import os

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
    page.wait_for_timeout(4000)

    info = page.evaluate('''() => {
        const out = []
        let el = document.querySelector('.ProseMirror table')
        while (el && el !== document.body) {
            const cs = getComputedStyle(el)
            out.push({
                tag: el.tagName, cls: (el.className?.toString?.() || '').slice(0, 60),
                overflow: cs.overflow, overflowY: cs.overflowY,
                scrollH: el.scrollHeight, clientH: el.clientHeight,
                scrollable: el.scrollHeight > el.clientHeight + 5,
                zoom: cs.zoom,
            })
            el = el.parentElement
        }
        return out
    }''')
    for i, e in enumerate(info):
        print(i, e['tag'], repr(e['cls'][:50]), 'ov=', e['overflow'], 'scrollH=', e['scrollH'], 'clientH=', e['clientH'], 'scrollable=', e['scrollable'], 'zoom=', e['zoom'])

    # 试用鼠标滚轮在编辑区滚动（先把鼠标移到文档中心）
    tbl = page.locator('.ProseMirror table').first
    box = tbl.bounding_box()
    print('table bbox before scroll:', box)
    # 找滚动容器在视口中的位置，把鼠标移到它的中心
    vp = page.evaluate('''() => {
        const el = document.querySelector('.ProseMirror table')
        let e = el
        while (e) { const cs = getComputedStyle(e); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; e = e.parentElement }
        if (!e) return null
        const r = e.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 400), scrollTop: e.scrollTop, scrollH: e.scrollHeight }
    }''')
    print('scroll container viewport pos + state:', vp)
    page.mouse.move(vp['x'], vp['y'])
    page.wait_for_timeout(200)
    for i in range(12):
        page.mouse.wheel(0, 500)
        page.wait_for_timeout(150)
        if i == 3:
            st = page.evaluate('''() => {
                const el = document.querySelector('.ProseMirror table')
                let e = el
                while (e) { const cs = getComputedStyle(e); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; e = e.parentElement }
                return e ? e.scrollTop : -1
            }''')
            print(f'after 4 wheels scrollTop={st}')
    page.wait_for_timeout(800)
    st = page.evaluate('''() => {
        const el = document.querySelector('.ProseMirror table')
        let e = el
        while (e) { const cs = getComputedStyle(e); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; e = e.parentElement }
        return e ? e.scrollTop : -1
    }''')
    print('final scrollTop:', st)
    box = tbl.bounding_box()
    print('table bbox after wheel scroll:', box)
    page.screenshot(path=f'{SHOTS}/wheel_scroll.png')
    browser.close()
