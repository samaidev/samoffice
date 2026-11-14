#!/usr/bin/env python3
"""E2E 探针：打开用户上传的调研 docx，截图表格并 dump 每个 td 的四边计算边框样式。"""
import json, sys, time
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
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)[:200]))
        page.goto(BASE + '/', wait_until='domcontentloaded')
        page.wait_for_timeout(2500)
        page.screenshot(path=f'{SHOTS}/01_home.png')

        # 通过 文件菜单 → 打开文件 → 动态 input[type=file]（filechooser 事件捕获）
        page.click('[data-testid="menu-files"]')
        page.wait_for_timeout(400)
        with page.expect_file_chooser() as fc_info:
            page.click('[data-testid="menu-打开文件"], [data-testid="menu-open-file"]')
        fc = fc_info.value
        fc.set_files(DOCX)
        page.wait_for_timeout(3500)
        if page.locator('.ProseMirror').count() == 0:
            print('FAILED to open docx (no ProseMirror)')
            page.screenshot(path=f'{SHOTS}/open_failed.png')
            print('pageerrors:', errors[:5])
            browser.close()
            sys.exit(1)
        print('docx opened OK')

        page.wait_for_timeout(2000)
        page.screenshot(path=f'{SHOTS}/02_doc_top.png')

        # 等待分页渲染稳定
        tables = page.locator('.ProseMirror table')
        tn = tables.count()
        print(f'tables rendered: {tn}')

        # 滚到每个表格并截图 + dump 边框（分页引擎会重挂载表格，需要重查询+重试）
        for ti in range(tn):
            for attempt in range(5):
                try:
                    t = page.locator('.ProseMirror table').nth(ti)
                    t.scroll_into_view_if_needed(timeout=3000)
                    page.wait_for_timeout(700)
                    info = page.evaluate('''(el) => {
                        const rows = el.querySelectorAll('tr')
                        const out = []
                        rows.forEach((tr, ri) => {
                            const tds = tr.querySelectorAll('td, th')
                            const cells = []
                            tds.forEach((td, ci) => {
                                const cs = getComputedStyle(td)
                                cells.push({
                                    ci,
                                    top: cs.borderTopWidth + ' ' + cs.borderTopStyle,
                                    right: cs.borderRightWidth + ' ' + cs.borderRightStyle,
                                    bottom: cs.borderBottomWidth + ' ' + cs.borderBottomStyle,
                                    left: cs.borderLeftWidth + ' ' + cs.borderLeftStyle,
                                    color: cs.borderColor,
                                    text: (td.textContent || '').trim().slice(0, 10),
                                })
                            })
                            out.push({ ri, cells })
                        })
                        return out
                    }''', t.element_handle(timeout=2000))
                    page.locator('.ProseMirror table').nth(ti).screenshot(path=f'{SHOTS}/table_{ti}.png', timeout=4000)
                    break
                except Exception as e:
                    if attempt == 4:
                        print(f'table {ti}: giving up — {str(e)[:80]}')
                    page.wait_for_timeout(500)
            if 'info' not in dir():
                continue
            print(f'--- table {ti} computed borders ---')
            for row in info:
                for c in row['cells']:
                    on = lambda s: '1' if (s.split()[0] != '0px' and s.split()[1] != 'none') else '0'
                    enc = on(c['top']) + on(c['right']) + on(c['bottom']) + on(c['left'])
                    print(f"  r{row['ri']}c{c['ci']}[{enc}] top={c['top']} right={c['right']} bottom={c['bottom']} left={c['left']} color={c['color']} {c['text']!r}")
            del info

        # 整页长截图
        page.screenshot(path=f'{SHOTS}/03_doc_full.png', full_page=True)
        print('pageerrors:', errors[:5])
        browser.close()

if __name__ == '__main__':
    main()
