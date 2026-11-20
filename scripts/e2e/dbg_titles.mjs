// 调试：打印页面上所有按钮的 title / 文本
import { chromium } from 'playwright'

const b = await chromium.launch({ args: ['--no-sandbox'] })
const p = await b.newPage()
await p.goto('http://127.0.0.1:18400', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
const btns = await p.evaluate(() => Array.from(document.querySelectorAll('button[title]')).map(x => x.title))
console.log(JSON.stringify(btns, null, 0).slice(0, 1500))
console.log('ProseMirror:', await p.evaluate(() => !!document.querySelector('.ProseMirror')))
await b.close()
