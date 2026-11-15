const { chromium } = require('playwright');
const fs = require('fs');
const DOC = '/home/z/my-project/upload/5-T2631 5000  朱东山 合同能源管理模式下能源管理公司和用户的效益分配.docx';
(async () => {
  for (const headed of [false, true]) {
    for (const hideMath of [false, true]) {
      const b = await chromium.launch({ args: ['--no-sandbox'], headless: !headed });
      const p = await (await b.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
      await p.goto('http://localhost:18400', { waitUntil: 'networkidle' });
      await p.evaluate(() => localStorage.setItem('samoffice_theme', 'light'));
      await p.reload({ waitUntil: 'networkidle' });
      await p.waitForTimeout(900);
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(DOC)]), 'c.docx');
      const r = await fetch('http://localhost:18400/api/doc/open', { method: 'POST', body: form });
      const j = await r.json();
      await p.evaluate(d => window.__setDocForTest(d), j.document);
      await p.waitForTimeout(3000);
      if (hideMath) { await p.evaluate(() => document.querySelectorAll('.sam-math').forEach(m => m.style.display = 'none')); await p.waitForTimeout(400) }
      await p.evaluate(() => { document.querySelector('.ProseMirror table td').scrollIntoView({ block: 'center' }) });
      await p.waitForTimeout(900);
      const box = await p.evaluate(() => { const td = document.querySelector('.ProseMirror table td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } });
      await p.evaluate(() => { window.__mlog = []; document.addEventListener('mousedown', () => window.__mlog.push(1), { once: true, capture: true }) });
      await p.mouse.click(box.x, box.y);
      await p.waitForTimeout(280);
      const ok = await p.evaluate(() => window.__mlog.length > 0);
      console.log((headed ? '有头' : '无头') + ' + 公式' + (hideMath ? '隐藏' : '显示') + ' → 表格点击: ' + (ok ? '✓可点' : '✗死区'));
      await b.close();
    }
  }
})().catch(e => { console.error(e.message); process.exit(1) });
