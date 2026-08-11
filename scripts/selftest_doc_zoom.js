const { chromium } = require('playwright');
const path = require('path');

const URL = 'http://localhost:5173';
const DOC = 'C:/samoffice/_verify_tmp/protect_verify.docx';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('[PAGEERROR] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);

  // 等待 wails 运行时初始化
  await page.waitForFunction(() => !!(window.go && window.go.main && window.go.main.App && window.go.main.App.OpenFile), {}, { timeout: 10000 });

  // 调用后端打开 docx
  const openRes = await page.evaluate(async (docPath) => {
    try {
      return await window.go.main.App.OpenFile(docPath);
    } catch (e) {
      return { error: String(e) };
    }
  }, DOC);
  console.log('OPEN RESULT:', JSON.stringify(openRes, null, 1).slice(0, 400));
  await page.waitForTimeout(3000);

  async function snap(tag) {
    return await page.evaluate(t => {
      const pm = document.querySelector('.ProseMirror');
      const zoomDivs = Array.from(document.querySelectorAll('div')).filter(d => /zoom/.test(d.getAttribute('style') || ''));
      return {
        tag: t,
        hasProseMirror: !!pm,
        pmTextLen: pm ? (pm.innerText || '').length : -1,
        pmHTMLLen: pm ? pm.innerHTML.length : -1,
        zoomDivCount: zoomDivs.length,
        zoomValues: zoomDivs.slice(0, 3).map(d => (d.getAttribute('style').match(/zoom:\s*[^;]+/g) || []).join(',')),
        title: document.title,
        bodyTextSample: (document.body.innerText || '').slice(0, 120),
      };
    }, tag);
  }

  console.log('AFTER OPEN:', JSON.stringify(await snap('open'), null, 1));
  await page.screenshot({ path: 'c:/samoffice/scripts/doc_open.png' });

  // 测试 zoom in（右下角 + 按钮或 ribbon）
  // 先找 zoom in 按钮
  const zoomBtn = await page.$('[title*="放大"], [title*="zoom in" i], button:has-text("+"):nth-of-type(1)');
  if (zoomBtn) {
    await zoomBtn.click();
    console.log('CLICKED zoom in');
    await page.waitForTimeout(2000);
    console.log('AFTER ZOOM :', JSON.stringify(await snap('zoomin'), null, 1));
    await page.screenshot({ path: 'c:/samoffice/scripts/doc_zoomin.png' });
  } else {
    console.log('NO ZOOM BUTTON FOUND');
  }

  console.log('ERRORS:', errors.slice(0, 20).join('\n'));
  await browser.close();
})();
