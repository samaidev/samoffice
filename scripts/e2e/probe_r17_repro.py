#!/usr/bin/env python3
"""E2E：截取表格渲染图 + 复现滚动跳走 bug + 输入编辑时滚动跳走 bug。（JS 滚动，防 DOM 重挂载）"""
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:18400'
DOCX = '/home/z/my-project/upload/1.公共配套内部化与规模产业空间建设的有益探索.docx'
SHOTS = '/home/z/my-project/samoffice/scripts/e2e/shots-r17'
import os
os.makedirs(SHOTS, exist_ok=True)

# 容器内第 i 个表格的顶部位置（相对滚动内容），用 offset 链计算
GET_STATE = '''(ti) => {
    const tbl = document.querySelectorAll('.ProseMirror table')[ti]
    if (!tbl) return null
    let sc = tbl
    while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
    if (!sc) return null
    // 表格相对滚动内容的顶部
    let top = 0, el = tbl
    while (el && el !== sc) { top += el.offsetTop; el = el.offsetParent }
    const r = sc.getBoundingClientRect()
    return {
        scrollTop: sc.scrollTop, tblTop: top, tblH: tbl.offsetHeight,
        vx: r.x + r.width / 2, vy: r.y + 300, scTop: r.y, scH: r.height, scrollMax: sc.scrollHeight - sc.clientHeight,
        setScroll: null,
    }
}'''

SET_SCROLL = '''([ti, top]) => {
    const tbl = document.querySelectorAll('.ProseMirror table')[ti]
    let sc = tbl
    while (sc) { const cs = getComputedStyle(sc); if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break; sc = sc.parentElement }
    if (sc) sc.scrollTop = top
    return sc ? sc.scrollTop : -1
}'''

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

    # ============ 1. 表格截图 ============
    for ti in range(2):
        st = page.evaluate(GET_STATE, ti)
        # 滚到表格可见（表格顶部对齐到容器顶部+60）
        page.evaluate(SET_SCROLL, [ti, max(0, st['tblTop'] - 60)])
        page.wait_for_timeout(900)
        st = page.evaluate(GET_STATE, ti)
        page.mouse.move(st['vx'], st['vy'])
        page.mouse.click(st['vx'], st['vy'])
        page.wait_for_timeout(1000)
        st2 = page.evaluate(GET_STATE, ti)
        print(f'table{ti}: click 后 scrollTop={st2["scrollTop"]} (期望 ~{max(0, st["tblTop"] - 60)})')
        page.screenshot(path=f'{SHOTS}/table_{ti}_click.png')

    # ============ 2. 滚动跳走复现 ============
    st = page.evaluate(GET_STATE, 0)
    page.evaluate(SET_SCROLL, [0, max(0, st['tblTop'] - 60)])
    page.wait_for_timeout(600)
    st = page.evaluate(GET_STATE, 0)
    page.mouse.move(st['vx'], st['vy'])
    page.mouse.click(st['vx'], st['vy'])   # 光标进表格
    page.wait_for_timeout(900)
    st0 = page.evaluate(GET_STATE, 0)
    print('光标在表格内, scrollTop =', st0['scrollTop'])
    for _ in range(8):
        page.mouse.wheel(0, 400)
        page.wait_for_timeout(130)
    page.wait_for_timeout(500)
    st1 = page.evaluate(GET_STATE, 0)
    print('滚轮向下 3200px 后, scrollTop =', st1['scrollTop'])
    page.wait_for_timeout(1600)
    st2 = page.evaluate(GET_STATE, 0)
    jump = '跳走了!!' if abs(st2['scrollTop'] - st1['scrollTop']) > 50 else '稳定'
    print('静止 1.6s 后, scrollTop =', st2['scrollTop'], '→', jump)
    page.screenshot(path=f'{SHOTS}/scroll_jump_after.png')

    # 向上滚回表格处
    for _ in range(8):
        page.mouse.wheel(0, -400)
        page.wait_for_timeout(130)
    page.wait_for_timeout(600)
    st3 = page.evaluate(GET_STATE, 0)
    print('滚轮向上 3200px 后, scrollTop =', st3['scrollTop'])
    page.wait_for_timeout(1600)
    st4 = page.evaluate(GET_STATE, 0)
    jump2 = '跳走了!!' if abs(st4['scrollTop'] - st3['scrollTop']) > 50 else '稳定'
    print('静止 1.6s 后, scrollTop =', st4['scrollTop'], '→', jump2)

    # ============ 3. 表格内打字是否引起页面跳走 ============
    st = page.evaluate(GET_STATE, 0)
    page.evaluate(SET_SCROLL, [0, max(0, st['tblTop'] - 200)])  # 表格在视口中部偏下
    page.wait_for_timeout(800)
    st = page.evaluate(GET_STATE, 0)
    page.mouse.move(st['vx'], st['vy'])
    page.mouse.click(st['vx'], st['vy'])
    page.wait_for_timeout(700)
    stb = page.evaluate(GET_STATE, 0)
    print('打字前, scrollTop =', stb['scrollTop'])
    for ch in '测试AB':
        page.keyboard.type(ch, delay=150)
    page.wait_for_timeout(1400)
    sta = page.evaluate(GET_STATE, 0)
    j3 = 'JUMPED!!' if abs(sta['scrollTop'] - stb['scrollTop']) > 50 else 'stable'
    print('打字后, scrollTop =', sta['scrollTop'], '→', j3)
    page.screenshot(path=f'{SHOTS}/typing_jump_after.png')

    browser.close()
