#!/usr/bin/env python3
"""E2E 截图验证：滚动文档容器逐屏截图，精确定位两个表格并裁剪截图。"""
import sys, time
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:18400'
DOCX = '/home/z/my-project/upload/1.公共配套内部化与规模产业空间建设的有益探索.docx'
SHOTS = '/home/z/my-project/samoffice/scripts/e2e/shots-r17'
import os
os.makedirs(SHOTS, exist_ok=True)

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = browser.new_page(viewport={'width': 1400, 'height': 950})
        page.goto(BASE + '/', wait_until='domcontentloaded')
        page.wait_for_timeout(2500)
        page.click('[data-testid="menu-files"]')
        page.wait_for_timeout(400)
        with page.expect_file_chooser() as fc_info:
            page.click('[data-testid="menu-打开文件"], [data-testid="menu-open-file"]')
        fc_info.value.set_files(DOCX)
        page.wait_for_timeout(4000)
        assert page.locator('.ProseMirror').count() > 0, 'doc not open'
        print('docx opened')

        # 找到文档滚动容器：取表格祖先里第一个 overflow-auto/scroll 的元素
        sc = page.evaluate('''() => {
            const t = document.querySelector('.ProseMirror table')
            let el = t
            while (el) {
                const cs = getComputedStyle(el)
                if (/(auto|scroll)/.test(cs.overflowY)) return el
                el = el.parentElement
            }
            return null
        }''')
        if not sc:
            print('no scroll container found; tables may be fully visible')
        # 表格在容器内的绝对位置（不受滚动影响）
        boxes = page.evaluate('''() => {
            const sc = (() => { const t = document.querySelector('.ProseMirror table'); let el = t
                while (el) { const cs = getComputedStyle(el); if (/(auto|scroll)/.test(cs.overflowY)) return el; el = el.parentElement } return null })()
            const rectOf = (el) => { const r = el.getBoundingClientRect(); const sr = sc ? sc.getBoundingClientRect() : {x:0,y:0}
                return { x: r.x - sr.x + (sc ? sc.scrollLeft : 0), y: r.y - sr.y + (sc ? sc.scrollTop : 0), w: r.width, h: r.height } }
            return Array.from(document.querySelectorAll('.ProseMirror table')).map(rectOf)
        }''')
        print('table abs boxes:', boxes)
        sc_h = page.evaluate('() => { const el = (() => { const t = document.querySelector(".ProseMirror table"); let e = t; while (e) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY)) return e; e = e.parentElement } return null })(); return el ? el.scrollHeight : 0 }')
        print('scrollHeight:', sc_h)

        # 滚动容器滚到每个表格处截图（clip 用页面绝对坐标 = 容器视口位置 + 相对偏移）
        vp = page.evaluate('''() => { const el = (() => { const t = document.querySelector(".ProseMirror table"); let e = t; while (e) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY)) return e; e = e.parentElement } return null })(); return el ? el.getBoundingClientRect() : null }''')
        for ti, b in enumerate(boxes):
            # 滚动容器让表格顶部出现在视口上部
            page.evaluate(f'() => {{ const el = (() => {{ const t = document.querySelector(".ProseMirror table"); let e = t; while (e) {{ const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY)) return e; e = e.parentElement }} return null }})(); if (el) el.scrollTop = {int(b["y"]) - 80} }}')
            page.wait_for_timeout(900)
            page.screenshot(path=f'{SHOTS}/table_{ti}_view.png')
        # 滚回顶部截屏
        page.evaluate('() => { const el = (() => { const t = document.querySelector(".ProseMirror table"); let e = t; while (e) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY)) return e; e = e.parentElement } return null })(); if (el) el.scrollTop = 0 }')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{SHOTS}/04_doc_p1.png')

        browser.close()

if __name__ == '__main__':
    main()
