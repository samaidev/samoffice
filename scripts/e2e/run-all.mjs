/**
 * GoOffice Playwright E2E 全面测试脚本 v2
 * 依照 测试方案.md (主方案) + 边缘测试方案.md
 *
 * 优化点:
 *  - 使用 data-testid 选择器 (theme-toggle / hamburger-toggle / tab-* / mode-badge)
 *  - 使用 title*= 选择工具栏按钮 (避免 has-text 多匹配)
 *  - 默认 5s 超时，避免 30s 卡死
 *  - 每用例 30s 总超时上限
 */

import { firefox, devices } from 'playwright';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import http from 'http';

// 全局错误捕获 — 防止单用例崩溃带死整个脚本
process.on('unhandledRejection', (e) => {
  console.log('[UNHANDLED-REJECTION]', e?.message || String(e));
});
process.on('uncaughtException', (e) => {
  console.log('[UNCAUGHT-EXCEPTION]', e?.message || String(e));
});

const BASE_URL = 'http://127.0.0.1:18400';
const SERVER_BIN = '/tmp/gooffice-server';
const DATA_DIR = '/tmp/gooffice-pw-test';
const SHOTS_DIR = '/home/z/my-project/scripts/pw-shots';
const DOWNLOAD_DIR = '/home/z/my-project/download';

fs.mkdirSync(SHOTS_DIR, { recursive: true });
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const results = [];
let total = 0, pass = 0, fail = 0;
const consoleErrors = [];

async function safe(id, name, fn, timeoutMs = 30000) {
  total++;
  const t0 = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`用例超时 ${timeoutMs}ms`)), timeoutMs)),
    ]);
    pass++;
    results.push({ id, name, status: 'PASS', ms: Date.now() - t0 });
    console.log(`  ✅ ${id} ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    fail++;
    const msg = e.message.split('\n')[0].slice(0, 200);
    results.push({ id, name, status: 'FAIL', ms: Date.now() - t0, error: msg });
    console.log(`  ❌ ${id} ${name} — ${msg}`);
  }
}

function waitForServer(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => {
      http.get(url, (res) => {
        if (res.statusCode === 200) { res.resume(); resolve(); }
        else { res.resume(); retry(); }
      }).on('error', retry);
    };
    const retry = () => {
      if (Date.now() - t0 > timeoutMs) { reject(new Error('server timeout')); return; }
      setTimeout(check, 300);
    };
    check();
  });
}

async function shot(page, name) {
  try { await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: false }); } catch (e) {}
}

function httpReq(method, pathStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathStr, BASE_URL);
    const req = http.request({
      method, hostname: url.hostname, port: url.port,
      path: url.pathname + url.search,
      headers: opts.headers || {},
      timeout: opts.timeout || 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// 设置全局默认超时
const DEFAULT_TIMEOUT = 5000;

console.log('\n=== GoOffice E2E 全面测试 v2 ===\n');
console.log(`启动 gooffice-server (${BASE_URL}) ...`);

try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
fs.mkdirSync(DATA_DIR, { recursive: true });

const serverProc = spawn(SERVER_BIN, ['--addr', '127.0.0.1:18400', '--data', DATA_DIR], {
  cwd: '/home/z/my-project/samoffice',
  stdio: ['ignore', 'pipe', 'pipe'],
});
serverProc.stdout.on('data', () => {});
serverProc.stderr.on('data', () => {});

try {
  await waitForServer(`${BASE_URL}/api/health`, 15000);
  console.log('服务器就绪 ✓\n');
} catch (e) {
  console.error('服务器启动失败:', e.message);
  process.exit(1);
}

const browser = await firefox.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  headless: true,
});

// ============ 模块 1: Shell ============
console.log('--- 模块 1: Shell ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[S] ${msg.text()}`.slice(0, 250));
  });
  page.on('pageerror', (err) => consoleErrors.push(`[S-PE] ${err.message}`.slice(0, 250)));
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (!u.includes('favicon')) consoleErrors.push(`[S-RF] ${u} ${req.failure()?.errorText}`.slice(0, 250));
  });

  await safe('S1', '首页加载', async () => {
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);
    const title = await page.title();
    if (!/GoOffice|Office/i.test(title)) throw new Error(`title: "${title}"`);
    await page.waitForSelector('.ProseMirror', { timeout: 8000 });
    await shot(page, 's1-home');
  });

  await safe('S2', '顶栏菜单按钮数 ≥ 4', async () => {
    const header = page.locator('header').first();
    await header.waitFor({ state: 'visible', timeout: 5000 });
    const n = await header.locator('button').count();
    if (n < 4) throw new Error(`header buttons: ${n}`);
  });

  await safe('S3', 'Tab 切换栏 ≥ 4', async () => {
    const tabs = page.locator('[data-testid^="tab-"]');
    const n = await tabs.count();
    if (n < 4) throw new Error(`tab count: ${n}`);
  });

  await safe('S4', '模式标识显示', async () => {
    const badge = page.locator('[data-testid="mode-badge"]');
    await badge.waitFor({ state: 'visible', timeout: 3000 });
    const txt = await badge.innerText();
    if (!/远程|本地|Remote|Local/i.test(txt)) throw new Error(`mode: "${txt}"`);
  });

  await safe('S5', '主题切换', async () => {
    // theme 三态循环: auto → light → dark → auto
    // 在 prefers-color-scheme=light 环境下, auto 时 data-theme=light, light 时 data-theme=light
    // 需要点击 2 次才能从 auto 经过 light 到 dark
    const btn = page.locator('[data-testid="theme-toggle"]');
    const tooltipBefore = await btn.getAttribute('data-tooltip') || '';
    await btn.click({ timeout: 3000 });
    await page.waitForTimeout(200);
    await btn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    const tooltipAfter = await btn.getAttribute('data-tooltip') || '';
    const after = await page.locator('html').getAttribute('data-theme') || 'light';
    if (tooltipBefore === tooltipAfter && after !== 'dark') {
      throw new Error(`theme 未切换: tooltip=${tooltipBefore}`);
    }
    await shot(page, 's5-theme');
  });

  await safe('S6', '语言下拉', async () => {
    const select = page.locator('select').first();
    const opts = await select.locator('option').count();
    if (opts < 2) throw new Error(`option count: ${opts}`);
  });

  await safe('S7', '底部状态栏含版本号', async () => {
    const footer = page.locator('footer').first();
    const txt = await footer.innerText();
    if (!/v?0\.\d+\.\d+/.test(txt)) throw new Error(`footer: "${txt.slice(0, 80)}"`);
  });

  await safe('S8', 'Toast 提示', async () => {
    // 先打开 Files 下拉（saveBtn 在下拉菜单内）
    const filesBtn = page.locator('[data-testid="menu-files"]');
    if (await filesBtn.count()) {
      await filesBtn.click({ timeout: 3000 });
      await page.waitForTimeout(300);
    }
    // 触发存为 docx → 期待 toast
    const saveBtn = page.locator('button:has-text("docx"), button:has-text("DOCX"), button:has-text("Word")').first();
    if (await saveBtn.count()) {
      await saveBtn.click({ timeout: 3000 });
      await page.waitForTimeout(1500);
    }
    const toast = await page.locator('.toast, [class*="toast" i], [role="alert"]').count();
    if (toast === 0) throw new Error('无 toast 元素');
  });

  await ctx.close();
}

// ============ 模块 2: 文档编辑器 ============
console.log('\n--- 模块 2: 文档编辑器 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  await safe('D1', '切换到文档 Tab', async () => {
    await page.waitForSelector('.ProseMirror', { timeout: 8000 });
  });

  await safe('D2', '输入文本', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('Hello GoOffice E2E', { delay: 5 });
    await page.waitForTimeout(200);
    const txt = await pm.innerText();
    if (!txt.includes('Hello')) throw new Error(`text: "${txt}"`);
  });

  await safe('D3', '工具栏按钮数 ≥ 10', async () => {
    const n = await page.locator('.toolbar-btn').count();
    if (n < 10) throw new Error(`toolbar-btn: ${n}`);
  });

  await safe('D4', '加粗 (B)', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    const bBtn = page.locator('.toolbar-btn[title*="Bold"], .toolbar-btn[title*="Ctrl+B"]').first();
    await bBtn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    const html = await pm.evaluate(el => el.innerHTML);
    if (!/<b>|<strong/i.test(html)) throw new Error('未产生 strong/b');
  });

  await safe('D5', '斜体 (I)', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    const iBtn = page.locator('.toolbar-btn[title*="Italic"], .toolbar-btn[title*="Ctrl+I"]').first();
    await iBtn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    const html = await pm.evaluate(el => el.innerHTML);
    if (!/<i>|<em/i.test(html)) throw new Error('未产生 em/i');
  });

  await safe('D6', '下划线 (U)', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    const uBtn = page.locator('.toolbar-btn[title*="Underline"], .toolbar-btn[title*="Ctrl+U"]').first();
    await uBtn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    const html = await pm.evaluate(el => el.innerHTML);
    if (!/<u>/i.test(html)) throw new Error('未产生 u');
  });

  await safe('D7', '标题1 (H1)', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    // Ribbon 中的 H1 按钮
    const h1Btn = page.locator('button[title="Heading 1"], button[title="标题1"]').first();
    if (await h1Btn.count()) {
      await h1Btn.click({ timeout: 3000 });
    } else {
      // 备用: 直接命令
      await page.keyboard.press('Control+Alt+1');
    }
    await page.waitForTimeout(300);
    await page.keyboard.type('Title 1');
    const html = await pm.evaluate(el => el.innerHTML);
    if (!/<h1/i.test(html)) throw new Error('未产生 h1');
  });

  await safe('D8', '无序列表', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    const btn = page.locator('.toolbar-btn[title*="Bullet"]').first();
    await btn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    await page.keyboard.type('item');
    const html = await pm.evaluate(el => el.innerHTML);
    if (!/<ul/i.test(html)) throw new Error('未产生 ul');
  });

  await safe('D9', '有序列表', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    const btn = page.locator('.toolbar-btn[title*="Numbered"], .toolbar-btn[title*="Ordered"]').first();
    await btn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    await page.keyboard.type('first');
    const html = await pm.evaluate(el => el.innerHTML);
    if (!/<ol/i.test(html)) throw new Error('未产生 ol');
  });

  await safe('D10', '引用块', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    const btn = page.locator('button[title*="Quote"], button[title*="引用"]').first();
    if (await btn.count()) {
      await btn.click({ timeout: 3000 });
      await page.waitForTimeout(300);
      await page.keyboard.type('quote text');
      const html = await pm.evaluate(el => el.innerHTML);
      if (!/<blockquote/i.test(html)) throw new Error('未产生 blockquote');
    } else {
      throw new Error('未找到引用按钮');
    }
  });

  await safe('D11', '代码块', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    const btn = page.locator('button[title*="Code Block"], button[title*="代码块"]').first();
    if (await btn.count()) {
      await btn.click({ timeout: 3000 });
      await page.waitForTimeout(300);
      await page.keyboard.type('var x = 1');
      const html = await pm.evaluate(el => el.innerHTML);
      if (!/<pre/i.test(html)) throw new Error('未产生 pre');
    } else {
      throw new Error('未找到代码块按钮');
    }
  });

  await safe('D12', '对齐方式', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    // 先确保在普通段落中（D11 留下了 code block，对齐不生效）
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('align me');
    await page.waitForTimeout(200);
    // 找居中按钮 (英文 title="Center")
    const btn = page.locator('.toolbar-btn[title="Center"]').first();
    if (!await btn.count()) throw new Error('无 Center 按钮');
    await btn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    const html = await pm.evaluate(el => el.innerHTML);
    if (!/text-align|align=/i.test(html)) throw new Error('未发现对齐样式: ' + html.slice(0, 200));
  });

  await safe('D13', '查找替换 (Ctrl+F)', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    // 直接点击 data-testid 指定的搜索按钮 (优化后)
    const searchBtn = page.locator('[data-testid="doc-search-toggle"]').first();
    if (await searchBtn.count()) {
      await searchBtn.click({ timeout: 3000 });
    } else {
      // 备用: 旧的 toolbar-btn 选择器
      const oldBtn = page.locator('.toolbar-btn[title*="Ctrl+F"], .toolbar-btn[title*="Find"]').first();
      if (await oldBtn.count()) {
        await oldBtn.click({ timeout: 3000 });
      } else {
        await page.keyboard.press('Control+F');
      }
    }
    await page.waitForTimeout(500);
    const panel = page.locator('input[placeholder*="Find" i], input[placeholder*="find" i], input[placeholder*="查找" i]').first();
    if (!await panel.count()) throw new Error('搜索面板未展开');
  });

  await safe('D14', '撤销 (Ctrl+Z)', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    const before = await pm.evaluate(el => el.innerText);
    await page.keyboard.type(' XYZ_TMP');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(300);
    const after = await pm.evaluate(el => el.innerText);
    if (after.includes('XYZ_TMP')) throw new Error('撤销未生效');
  });

  await safe('D15', '拼写检查 (英文)', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('helo worrd', { delay: 5 });
    await page.waitForTimeout(2000); // 防抖 + 网络
    const errs = await page.locator('.spell-error, .typo, mark.spell').count();
    if (errs === 0) throw new Error('未发现 .spell-error 标记');
  });

  await safe('D16', '拼写检查 (中文无误报)', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('我们在北京编辑文档', { delay: 5 });
    await page.waitForTimeout(2000);
    const errs = await page.locator('.spell-error, .typo, mark.spell').count();
    if (errs > 0) throw new Error(`中文误报 ${errs} 处`);
  });

  await safe('D18', 'Ribbon Tab 切换', async () => {
    // 使用 data-testid (优化后) — 跳过 "Insert Image" 按钮文本冲突
    const ids = ['home', 'insert', 'layout', 'review', 'view'];
    let found = 0;
    for (const id of ids) {
      const btn = page.locator(`[data-testid="ribbon-tab-${id}"]`).first();
      if (await btn.count()) {
        found++;
        try {
          await btn.click({ timeout: 2000 });
          await page.waitForTimeout(150);
        } catch (e) {}
      }
    }
    if (found < 3) throw new Error(`Ribbon tab 仅找到 ${found}`);
  });

  await safe('D19', '缩放', async () => {
    // 切到 View ribbon (使用 data-testid)
    const viewBtn = page.locator('[data-testid="ribbon-tab-view"]').first();
    if (await viewBtn.count()) {
      try { await viewBtn.click({ timeout: 2000 }); } catch (e) {}
      await page.waitForTimeout(500);
    }
    // View ribbon 中的 Zoom Out 按钮 title="Zoom Out"
    let zoomBtn = page.locator('button[title*="Zoom"]').first();
    if (!await zoomBtn.count()) {
      zoomBtn = page.locator('button:has-text("Zoom Out"), button:has-text("Zoom In"), button:has-text("缩小"), button:has-text("放大")').first();
    }
    if (!await zoomBtn.count()) throw new Error('无缩放按钮');
    await zoomBtn.click({ timeout: 2000 });
    await page.waitForTimeout(200);
  });

  await ctx.close();
}

// ============ 模块 3: 表格编辑器 ============
console.log('\n--- 模块 3: 表格编辑器 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  await safe('P1', '切换到表格 Tab', async () => {
    const tab = page.locator('[data-testid="tab-spreadsheet"]');
    await tab.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    await page.waitForSelector('table', { timeout: 8000 });
    await shot(page, 'p1-sheet');
  });

  await safe('P2', '默认行列 (≥10行 ≥5列)', async () => {
    const rows = await page.locator('table tbody tr').count();
    if (rows < 10) throw new Error(`rows: ${rows}`);
  });

  await safe('P3', '单元格输入', async () => {
    // 点击第一个数据单元格 (跳过行号列)
    const cell = page.locator('table tbody tr:first-child td:nth-child(2) input').first();
    await cell.click();
    await cell.fill('TestValue');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const val = await cell.inputValue().catch(() => '');
    if (!val.includes('TestValue')) throw new Error(`值未保留: "${val}"`);
  });

  await safe('P5', '切换 Sheet', async () => {
    const sheet2 = page.locator('button:has-text("Sheet2")').first();
    if (!await sheet2.count()) throw new Error('无 Sheet2');
    await sheet2.click({ timeout: 3000 });
    await page.waitForTimeout(300);
  });

  await safe('P6', '新建工作表', async () => {
    const before = await page.locator('button:has-text("Sheet")').count();
    // + 按钮 (新建工作表)
    const addBtn = page.locator('button[title*="New Sheet"], button[title*="新建"]').first();
    if (!await addBtn.count()) throw new Error('无 + 按钮');
    await addBtn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    const after = await page.locator('button:has-text("Sheet")').count();
    if (after <= before) throw new Error(`Sheet 数 ${before} → ${after}`);
  });

  await safe('P7', '求和函数', async () => {
    // 切回 Sheet1
    const sheet1 = page.locator('button:has-text("Sheet1")').first();
    if (await sheet1.count()) {
      await sheet1.click({ timeout: 3000 });
      await page.waitForTimeout(300);
    }
    // 在 B 列输入数据 1,2,3
    for (let r = 0; r < 3; r++) {
      const cell = page.locator(`table tbody tr:nth-child(${r + 1}) td:nth-child(2) input`).first();
      await cell.click();
      await cell.fill(String(r + 1));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
    }
    // 切到 Insert ribbon (使用 data-testid)
    const insertBtn = page.locator('[data-testid="ribbon-tab-insert"]').first();
    if (await insertBtn.count()) {
      try { await insertBtn.click({ timeout: 2000 }); } catch (e) {}
      await page.waitForTimeout(300);
    }
    // 找函数菜单 (title="Function")
    const funcBtn = page.locator('button[title="Function"]').first();
    if (!await funcBtn.count()) throw new Error('无函数菜单');
    await funcBtn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    // 函数面板中的 Sum 按钮 (text="Σ Sum")
    const sumBtn = page.locator('button:has-text("Sum"), button:has-text("求和")').first();
    if (!await sumBtn.count()) throw new Error('函数面板未展开');
    await sumBtn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
  });

  await safe('P10', '添加行', async () => {
    // 切回 Home ribbon (使用 data-testid)
    const homeBtn = page.locator('[data-testid="ribbon-tab-home"]').first();
    if (await homeBtn.count()) {
      try { await homeBtn.click({ timeout: 2000 }); } catch (e) {}
      await page.waitForTimeout(300);
    }
    const before = await page.locator('table tbody tr').count();
    const addBtn = page.locator('button[title*="Add Row"], button[title*="添加行"]').first();
    if (!await addBtn.count()) throw new Error('无添加行按钮');
    await addBtn.click({ timeout: 3000 });
    await page.waitForTimeout(300);
    const after = await page.locator('table tbody tr').count();
    if (after <= before) throw new Error(`行数 ${before} → ${after}`);
  });

  await ctx.close();
}

// ============ 模块 4: 演示编辑器 ============
console.log('\n--- 模块 4: 演示编辑器 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  await safe('L1', '切换到演示 Tab', async () => {
    // 等待 React 渲染 (任意 tab 出现)
    await page.waitForSelector('[data-testid="tab-slide"]', { state: 'visible', timeout: 8000 });
    const tab = page.locator('[data-testid="tab-slide"]');
    const t0 = Date.now();
    await tab.click({ timeout: 5000 });
    // slide 编辑器首屏性能优化后，应在 600ms 内渲染完成
    const titleInput = page.locator('input[placeholder*="title" i]').first();
    await titleInput.waitFor({ state: 'visible', timeout: 5000 });
    const renderMs = Date.now() - t0;
    console.log(`    (注: slide 首屏渲染 ${renderMs}ms)`);
    await shot(page, 'l1-slide');
  });

  await safe('L2', '默认幻灯片 (≥1)', async () => {
    // slide 编辑器页码 "N / M" 通过 data-testid 定位
    const pageIndicator = page.locator('[data-testid="slide-page-indicator"]').first();
    let found = false;
    if (await pageIndicator.count()) {
      const txt = await pageIndicator.innerText();
      if (/\d+\s*\/\s*\d+/.test(txt)) found = true;
    }
    if (!found) {
      // 备用: 找含 "title" placeholder 的 input
      const titleInput = page.locator('input[placeholder*="title" i]').first();
      if (await titleInput.count()) found = true;
    }
    if (!found) throw new Error('无幻灯片元素');
  });

  await safe('L3', '新增幻灯片', async () => {
    // Ribbon 中 New 按钮 (title="New" or "新建")
    // 先切到 home ribbon
    const homeBtn = page.locator('[data-testid="ribbon-tab-home"]').first();
    if (await homeBtn.count()) {
      try { await homeBtn.click({ timeout: 2000 }); } catch (e) {}
      await page.waitForTimeout(200);
    }
    const newBtn = page.locator('button[title="New"], button[title="新建"]').first();
    if (await newBtn.count()) {
      await newBtn.click({ timeout: 3000 });
      await page.waitForTimeout(500);
    } else {
      // 备用: 找侧栏的 + 按钮
      const plusBtn = page.locator('button:has-text("+")').first();
      if (await plusBtn.count()) {
        await plusBtn.click({ timeout: 3000 });
        await page.waitForTimeout(500);
      } else {
        throw new Error('无 New/+ 按钮');
      }
    }
  });

  await safe('L4', '标题编辑', async () => {
    // 找带 "title" placeholder 的 input
    let titleInput = page.locator('input[placeholder*="title" i]').first();
    if (!await titleInput.count()) {
      titleInput = page.locator('input[type="text"]').first();
    }
    await titleInput.waitFor({ state: 'visible', timeout: 5000 });
    await titleInput.click();
    await titleInput.fill('Slide Title E2E');
    await page.waitForTimeout(300);
    const val = await titleInput.inputValue();
    if (!val.includes('Slide Title')) throw new Error(`标题未保留: "${val}"`);
  });

  await ctx.close();
}

// ============ 模块 5: Markdown / HTML ============
console.log('\n--- 模块 5: Markdown / HTML ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  await safe('M1', '切换到 MD Tab', async () => {
    const tab = page.locator('[data-testid="tab-markdown"]');
    await tab.click({ timeout: 5000 });
    await page.waitForTimeout(800);
    const editor = page.locator('textarea, [contenteditable]').first();
    await editor.waitFor({ state: 'visible', timeout: 8000 });
    await shot(page, 'm1-md');
  });

  await safe('M2', '分栏预览', async () => {
    const preview = page.locator('[class*="preview" i]').first();
    if (!await preview.count()) throw new Error('无预览区');
  });

  await safe('M3', '代码高亮', async () => {
    const editor = page.locator('textarea').first();
    await editor.click();
    await editor.fill('```js\nconsole.log("hi");\n```');
    await page.waitForTimeout(500);
    const preview = page.locator('[class*="preview" i]').first();
    const html = await preview.evaluate(el => el.innerHTML);
    if (!/hljs|<code|<pre/i.test(html)) throw new Error('预览区无代码块');
  });

  await safe('M4', '表格渲染', async () => {
    const editor = page.locator('textarea').first();
    await editor.click();
    await editor.fill('| A | B |\n|---|---|\n| 1 | 2 |');
    await page.waitForTimeout(500);
    const preview = page.locator('[class*="preview" i]').first();
    const n = await preview.locator('table').count();
    if (!n) throw new Error('预览区无 table');
  });

  await safe('M5', '实时预览', async () => {
    const editor = page.locator('textarea').first();
    await editor.click();
    await editor.fill('# LiveUpdate');
    await page.waitForTimeout(500);
    const preview = page.locator('[class*="preview" i]').first();
    const html = await preview.evaluate(el => el.innerHTML);
    if (!/LiveUpdate/i.test(html)) throw new Error('预览未更新');
  });

  await safe('M6', 'HTML Tab', async () => {
    const tab = page.locator('[data-testid="tab-html"]');
    await tab.click({ timeout: 5000 });
    await page.waitForTimeout(800);
    const editor = page.locator('textarea').first();
    await editor.waitFor({ state: 'visible', timeout: 5000 });
    const val = await editor.inputValue();
    if (!val || val.length < 10) throw new Error('HTML 编辑器无示例');
  });

  await safe('M7', 'HTML 预览渲染', async () => {
    const editor = page.locator('textarea').first();
    await editor.click();
    await editor.fill('<h1>HelloHTML</h1>');
    await page.waitForTimeout(500);
    const preview = page.locator('[class*="preview" i], iframe').first();
    const html = await preview.evaluate(el => el.innerHTML).catch(() => '');
    if (!/HelloHTML/i.test(html)) throw new Error('预览未渲染');
  });

  await ctx.close();
}

// ============ 模块 5b: PDF 阅读器 ============
console.log('\n--- 模块 5b: PDF 阅读器 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // === 测试数据准备: 通过 /api/doc/export-pdf 生成多页测试 PDF ===
  // 修复点: 原测试硬编码依赖 /tmp/govdoc-inspect/政府公文-GB9704标准.pdf，
  // 但该文件由外部脚本生成，新克隆仓库运行时不存在，导致 PDF4-PDF8 全部级联失败。
  // 改为测试自给自足：调用现有 PDF 导出 API 生成 2 页测试 PDF。
  const TEST_PDF_DIR = '/tmp/govdoc-inspect';
  const TEST_PDF_PATH = path.join(TEST_PDF_DIR, '政府公文-GB9704标准.pdf');
  try {
    fs.mkdirSync(TEST_PDF_DIR, { recursive: true });
    const udm = JSON.stringify({
      meta: { title: '政府公文-GB9704标准', author: 'E2E Test' },
      blocks: [
        { type: 'heading', level: 1, inline: [{ content: '关于推进办公软件标准化建设的通知' }] },
        { type: 'paragraph', inline: [{ content: '各分公司、各部门：' }] },
        { type: 'paragraph', inline: [{ content: '为贯彻落实办公软件标准化建设要求，提升公文处理效率和质量，现就推进办公软件标准化建设有关事项通知如下。' }] },
        { type: 'heading', level: 2, inline: [{ content: '一、总体要求' }] },
        { type: 'paragraph', inline: [{ content: '以习近平新时代中国特色社会主义思想为指导，全面贯彻党的二十大和二十届历次全会精神，坚持统一标准、分步实施、注重实效的原则，力争用三年时间建成统一的办公软件标准体系。' }] },
        { type: 'paragraph', inline: [{ content: '制定统一的文件格式、排版规范、字体字号标准，确保各类公文格式一致、风格统一。严格执行 GB/T 9704-2012《党政机关公文格式》国家标准。' }] },
        { type: 'paragraph', inline: [{ content: '正文统一使用 3 号仿宋_GB2312 字体，数字和英文使用 Times New Roman。一级标题用黑体，二级标题用楷体_GB2312，标题序号依次为一、（一）、1.、（1）。' }] },
        { type: 'paragraph', inline: [{ content: '正文统一采用固定值 28 磅行距，禁止单倍或多倍行距。每段首行缩进 2 字符，段前段后 0 行。每页 22 行，每行 28 字。' }] },
        { type: 'heading', level: 2, inline: [{ content: '二、重点任务' }] },
        { type: 'paragraph', inline: [{ content: '一是完善标准体系。二是推进平台建设。三是加强培训指导。四是强化监督检查。' }] },
        { type: 'paragraph', inline: [{ content: '附件：1.办公软件标准化建设实施方案' }] },
        { type: 'paragraph', inline: [{ content: '      2.公文格式规范对照表' }] },
        { type: 'paragraph', inline: [{ content: 'SamAI 集团办公厅                    ' }] },
        { type: 'paragraph', inline: [{ content: '2026年7月6日                        ' }] },
        { type: 'paragraph', inline: [{ content: '抄送：集团领导，各部门。' }] },
        { type: 'paragraph', inline: [{ content: 'SamAI 集团办公厅                        2026年7月6日印发' }] },
      ],
    });
    const r = await httpReq('POST', '/api/doc/export-pdf', {
      headers: { 'Content-Type': 'application/json' },
      body: udm,
    });
    if (r.status !== 200 || !/pdf/i.test(r.headers['content-type'] || '')) {
      throw new Error(`生成测试 PDF 失败: HTTP ${r.status}`);
    }
    fs.writeFileSync(TEST_PDF_PATH, r.body);
    console.log(`  ℹ️  已生成测试 PDF: ${TEST_PDF_PATH} (${r.body.length} bytes)`);
  } catch (e) {
    console.log(`  ⚠️  生成测试 PDF 失败: ${e.message}`);
  }

  await safe('PDF1', '切换到 PDF Tab', async () => {
    // 等待 React 渲染
    await page.waitForSelector('[data-testid="tab-pdf"]', { state: 'visible', timeout: 8000 });
    await page.locator('[data-testid="tab-pdf"]').click({ timeout: 5000 });
    await page.waitForTimeout(500);
    // 检查 PDF 工具栏可见
    await page.waitForSelector('[data-testid="pdf-toolbar"]', { state: 'visible', timeout: 5000 });
    // 检查空状态提示
    await page.waitForSelector('[data-testid="pdf-empty"]', { state: 'visible', timeout: 5000 });
    await shot(page, 'pdf1-empty');
  });

  await safe('PDF2', 'PDF 打开按钮可见', async () => {
    const openBtn = page.locator('[data-testid="pdf-open-btn"]');
    if (!await openBtn.count()) throw new Error('无打开按钮');
    const txt = await openBtn.innerText();
    if (!/open|打开/i.test(txt) && !/📂/.test(txt)) throw new Error(`按钮文本异常: "${txt}"`);
  });

  await safe('PDF3', 'PDF 空状态文案', async () => {
    const empty = page.locator('[data-testid="pdf-empty"]');
    const txt = await empty.innerText();
    if (!/pdf|阅读|viewer/i.test(txt)) throw new Error(`空状态文案异常: "${txt.slice(0, 100)}"`);
  });

  await safe('PDF4', 'PDF 加载本地 PDF 文件', async () => {
    // 用模块开头通过 /api/doc/export-pdf 生成的测试 PDF
    const pdfPath = TEST_PDF_PATH;
    if (!fs.existsSync(pdfPath)) {
      throw new Error('测试 PDF 文件不存在（生成失败）');
    }
    // 使用 event-based 文件选择
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      page.locator('[data-testid="pdf-open-btn"]').click(),
    ]);
    await fileChooser.setFiles(pdfPath);
    await page.waitForTimeout(2500); // 等待 PDF.js 加载
    // 检查 canvas 是否渲染
    const canvas = page.locator('[data-testid="pdf-canvas"]');
    if (!await canvas.count()) throw new Error('PDF canvas 未渲染');
    // 检查状态栏页码
    const status = page.locator('[data-testid="pdf-statusbar"]');
    if (await status.count()) {
      const txt = await status.innerText();
      if (!/\d+\s*\/\s*\d+/.test(txt) && !/page|页/i.test(txt)) throw new Error(`状态栏异常: "${txt}"`);
    }
    await shot(page, 'pdf4-loaded');
  });

  await safe('PDF5', 'PDF 翻页', async () => {
    // 等待 PDF 加载完成
    await page.waitForTimeout(1000);
    const pageInput = page.locator('[data-testid="pdf-page-input"]');
    if (!await pageInput.count()) throw new Error('无页码输入');
    const beforePage = await pageInput.inputValue();
    const nextBtn = page.locator('[data-testid="pdf-next-btn"]');
    if (await nextBtn.count() && await nextBtn.isEnabled()) {
      await nextBtn.click({ timeout: 2000 });
      await page.waitForTimeout(800);
      const afterPage = await pageInput.inputValue();
      if (afterPage === beforePage) throw new Error('页码未变化');
    }
  });

  await safe('PDF6', 'PDF 缩放', async () => {
    const zoomIn = page.locator('[data-testid="pdf-zoom-in"]');
    if (!await zoomIn.count()) throw new Error('无放大按钮');
    if (await zoomIn.isEnabled()) {
      await zoomIn.click({ timeout: 2000 });
      await page.waitForTimeout(500);
    }
    const zoomOut = page.locator('[data-testid="pdf-zoom-out"]');
    if (await zoomOut.count() && await zoomOut.isEnabled()) {
      await zoomOut.click({ timeout: 2000 });
      await page.waitForTimeout(500);
    }
  });

  await safe('PDF7', 'PDF 打印按钮可见', async () => {
    // 需要 PDF 已加载 (PDF4 已加载)。如未加载则重新加载一次
    const pdfPath = TEST_PDF_PATH;
    const printBtn = page.locator('[data-testid="pdf-print-btn"]');
    if (!await printBtn.count() && fs.existsSync(pdfPath) && await page.locator('[data-testid="pdf-open-btn"]').count()) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        page.locator('[data-testid="pdf-open-btn"]').click(),
      ]);
      await fileChooser.setFiles(pdfPath);
      await page.waitForTimeout(2500);
    }
    const printBtn2 = page.locator('[data-testid="pdf-print-btn"]');
    if (!await printBtn2.count()) throw new Error('无打印按钮');
    const visible = await printBtn2.isVisible().catch(() => false);
    if (!visible) throw new Error('打印按钮不可见');
  });

  await safe('PDF8', 'PDF 打开打印对话框', async () => {
    await page.locator('[data-testid="pdf-print-btn"]').click({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.waitForSelector('[data-testid="print-dialog"]', { state: 'visible', timeout: 5000 });
    // 检查常规 Tab 内容
    if (!await page.locator('[data-testid="print-printer"]').count()) throw new Error('无打印机选择');
    if (!await page.locator('[data-testid="print-range-all"]').count()) throw new Error('无页范围');
    await shot(page, 'pdf8-print-dialog');
    // 关闭
    await page.locator('[data-testid="print-cancel"]').click({ timeout: 2000 });
    await page.waitForTimeout(300);
  });

  await ctx.close();
}

// ============ 模块 5c: 打印对话框 ============
console.log('\n--- 模块 5c: 打印对话框 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.waitForSelector('.ProseMirror', { timeout: 8000 });

  await safe('PR1', 'Word 打开打印对话框', async () => {
    // 切到 View ribbon
    await page.locator('[data-testid="ribbon-tab-view"]').click({ timeout: 3000 });
    await page.waitForTimeout(300);
    // 点击打印按钮
    await page.locator('[data-testid="word-print-btn"]').click({ timeout: 3000 });
    await page.waitForTimeout(500);
    // 检查对话框可见
    await page.waitForSelector('[data-testid="print-dialog"]', { state: 'visible', timeout: 5000 });
    await shot(page, 'pr1-word-print-dialog');
  });

  await safe('PR2', '打印对话框常规 Tab', async () => {
    // 检查打印机选择
    const printer = page.locator('[data-testid="print-printer"]');
    if (!await printer.count()) throw new Error('无打印机选择');
    // 检查页范围
    if (!await page.locator('[data-testid="print-range-all"]').count()) throw new Error('无全部页选项');
    // 检查份数
    if (!await page.locator('[data-testid="print-copies"]').count()) throw new Error('无份数输入');
    // 检查方向
    if (!await page.locator('[data-testid="print-portrait"]').count()) throw new Error('无纵向选项');
    // 检查颜色
    if (!await page.locator('[data-testid="print-color"]').count()) throw new Error('无颜色选择');
  });

  await safe('PR3', '打印对话框版式 Tab', async () => {
    await page.locator('[data-testid="print-tab-layout"]').click({ timeout: 2000 });
    await page.waitForTimeout(300);
    // 检查纸张大小
    if (!await page.locator('[data-testid="print-paper-size"]').count()) throw new Error('无纸张大小');
    // 检查页边距
    if (!await page.locator('[data-testid="print-margin-top"]').count()) throw new Error('无页边距');
    // 检查缩放
    if (!await page.locator('[data-testid="print-scale"]').count()) throw new Error('无缩放');
    // 检查双面
    if (!await page.locator('[data-testid="print-duplex"]').count()) throw new Error('无双面打印');
  });

  await safe('PR4', '打印对话框页范围自定义', async () => {
    await page.locator('[data-testid="print-tab-general"]').click({ timeout: 2000 });
    await page.waitForTimeout(200);
    await page.locator('[data-testid="print-range-custom"]').click({ timeout: 2000 });
    await page.waitForTimeout(200);
    const customInput = page.locator('[data-testid="print-custom-pages"]');
    if (!await customInput.count()) throw new Error('自定义页范围未显示');
    await customInput.fill('1-3,5');
    await page.waitForTimeout(200);
  });

  await safe('PR5', '打印对话框方向切换', async () => {
    await page.locator('[data-testid="print-landscape"]').click({ timeout: 2000 });
    await page.waitForTimeout(300);
    // 预览应反映横向 (宽 > 高)
    const preview = page.locator('[data-testid="print-preview"]');
    if (!await preview.count()) throw new Error('无预览');
    const box = await preview.boundingBox();
    if (!box || box.width <= box.height) throw new Error(`横向预览异常: ${box?.width}x${box?.height}`);
  });

  await safe('PR6', '打印对话框关闭', async () => {
    await page.locator('[data-testid="print-cancel"]').click({ timeout: 2000 });
    await page.waitForTimeout(300);
    if (await page.locator('[data-testid="print-dialog"]').count()) throw new Error('对话框未关闭');
  });

  // Excel 打印
  await safe('PR7', 'Excel 打开打印对话框', async () => {
    await page.locator('[data-testid="tab-spreadsheet"]').click({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.locator('[data-testid="ribbon-tab-view"]').click({ timeout: 2000 });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="excel-print-btn"]').click({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.waitForSelector('[data-testid="print-dialog"]', { state: 'visible', timeout: 5000 });
    // 检查 Excel 专用选项 (高级 tab)
    await page.locator('[data-testid="print-cancel"]').click({ timeout: 2000 });
  });

  // PPT 打印
  await safe('PR8', 'PPT 打开打印对话框', async () => {
    await page.locator('[data-testid="tab-slide"]').click({ timeout: 3000 });
    await page.waitForTimeout(1500);
    await page.locator('[data-testid="ribbon-tab-view"]').click({ timeout: 2000 });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="ppt-print-btn"]').click({ timeout: 3000 });
    await page.waitForTimeout(500);
    await page.waitForSelector('[data-testid="print-dialog"]', { state: 'visible', timeout: 5000 });
    await shot(page, 'pr8-ppt-print-dialog');
    await page.locator('[data-testid="print-cancel"]').click({ timeout: 2000 });
  });

  await ctx.close();
}

// ============ 模块 6: API ============
console.log('\n--- 模块 6: 后端 API ---');
{
  await safe('A1', '健康检查', async () => {
    const r = await httpReq('GET', '/api/health');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.body);
    if (j.status !== 'ok') throw new Error(`status: ${j.status}`);
  });

  await safe('A2', '英文拼写检查 (helo worrd)', async () => {
    const r = await httpReq('GET', '/api/dict/check?text=helo%20worrd&lang=en');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.body);
    if (!Array.isArray(j.errors) || j.errors.length !== 2) {
      throw new Error(`errors.length = ${j.errors?.length}`);
    }
  });

  await safe('A3', 'aff 派生纠错 (definately recieve)', async () => {
    const r = await httpReq('GET', '/api/dict/check?text=definately%20recieve&lang=en');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.body);
    const allSuggests = (j.errors || []).flatMap(e => e.suggestions || e.suggest || []);
    const ok = allSuggests.some(s => /definitely/i.test(s)) || allSuggests.some(s => /receive/i.test(s));
    if (!ok) throw new Error(`无 definitely/receive 建议: ${JSON.stringify(j.errors).slice(0, 200)}`);
  });

  await safe('A4', '中文拼写检查 (无误报)', async () => {
    const r = await httpReq('GET', '/api/dict/check?text=%E6%88%91%E4%BB%AC%E5%9C%A8%E5%8C%97%E4%BA%AC%E7%BC%96%E8%BE%91%E6%96%87%E6%A1%A3&lang=zh');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.body);
    if (j.errors && j.errors.length > 0) throw new Error(`误报 ${j.errors.length}`);
  });

  await safe('A5', '纠错建议 (helo)', async () => {
    const r = await httpReq('GET', '/api/dict/suggest?word=helo&lang=en');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.body);
    const c = j.candidates || j.suggestions || j.suggest || [];
    if (!Array.isArray(c) || c.length === 0) throw new Error(`无建议`);
  });

  await safe('A6', '用户词库学习', async () => {
    const word = 'e2etestword_' + Date.now();
    const r1 = await httpReq('POST', '/api/dict/learn', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, lang: 'en' }),
    });
    if (r1.status !== 200) throw new Error(`learn HTTP ${r1.status}`);
    const r2 = await httpReq('GET', `/api/dict/check?text=${encodeURIComponent(word)}&lang=en`);
    const j = JSON.parse(r2.body);
    if (j.errors && j.errors.length > 0 && j.errors.some(e => e.word === word)) {
      throw new Error('学习后仍报错');
    }
  });

  await safe('A7', 'docx 导出', async () => {
    const doc = JSON.stringify({
      meta: { title: 'E2E' },
      blocks: [{ inline: [{ content: 'E2E test docx' }] }],
    });
    const r = await httpReq('POST', '/api/doc/save', {
      headers: { 'Content-Type': 'application/json' },
      body: doc,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.body.toString().slice(0, 150)}`);
    const ct = r.headers['content-type'] || '';
    if (!/wordprocessingml|octet-stream|docx/i.test(ct)) throw new Error(`content-type: ${ct}`);
  });

  await safe('A8', 'PDF 导出', async () => {
    const doc = JSON.stringify({
      meta: { title: 'E2E' },
      blocks: [{ inline: [{ content: 'E2E test pdf' }] }],
    });
    const r = await httpReq('POST', '/api/doc/export-pdf', {
      headers: { 'Content-Type': 'application/json' },
      body: doc,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.body.toString().slice(0, 150)}`);
    const ct = r.headers['content-type'] || '';
    if (!/pdf/i.test(ct)) throw new Error(`content-type: ${ct}`);
  });

  await safe('A9', '文件上传解析', async () => {
    const boundary = '----E2E' + Date.now();
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.txt"\r\nContent-Type: text/plain\r\n\r\nhello e2e\r\n--${boundary}--\r\n`);
    const r = await httpReq('POST', '/api/doc/open', {
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    if (r.status === 500) throw new Error('返回 500');
  });

  await safe('A10', '不存在路由 → 404', async () => {
    const r = await httpReq('GET', '/api/nope');
    if (r.status !== 404) throw new Error(`HTTP ${r.status}`);
  });

  await safe('A11', '健康检查性能 < 500ms', async () => {
    const t0 = Date.now();
    await httpReq('GET', '/api/health');
    const ms = Date.now() - t0;
    if (ms >= 500) throw new Error(`耗时 ${ms}ms`);
  });

  // === 智能体打印 API ===
  await safe('AP1', '智能体 Word 打印 API', async () => {
    const body = JSON.stringify({
      spec: {
        title: 'API打印测试',
        elements: [
          { type: 'heading', text: '测试报告', level: 1 },
          { type: 'paragraph', text: '智能体打印API测试。' },
          { type: 'list', items: ['页范围', '份数', '纸张'] },
        ],
      },
      print: { copies: 2, paperSize: 'A4', duplex: 'long' },
    });
    const r = await httpReq('POST', '/api/lib/doc/print', {
      headers: { 'Content-Type': 'application/json' }, body,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.body.toString().slice(0, 200)}`);
    const ct = r.headers['content-type'] || '';
    if (!/pdf/i.test(ct)) throw new Error(`content-type: ${ct}`);
    if (r.body.length < 1000) throw new Error(`PDF 太小: ${r.body.length}`);
  });

  await safe('AP2', '智能体 PPT 打印 API (讲义模式)', async () => {
    const body = JSON.stringify({
      spec: {
        title: 'PPT打印',
        slides: [
          { layout: 'title', title: '第一页' },
          { layout: 'content', title: '第二页', bullets: ['要点1', '要点2'] },
        ],
      },
      print: { pptContent: 'handout', slidesPerPage: 2, paperSize: 'A4' },
    });
    const r = await httpReq('POST', '/api/lib/ppt/print', {
      headers: { 'Content-Type': 'application/json' }, body,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (!/pdf/i.test(r.headers['content-type'] || '')) throw new Error('非PDF');
  });

  await safe('AP3', '智能体 PPT 打印 API (备注页模式)', async () => {
    const body = JSON.stringify({
      spec: {
        title: 'PPT备注打印',
        slides: [
          { layout: 'content', title: '幻灯片1', notes: '这是备注内容' },
        ],
      },
      print: { pptContent: 'notes', paperSize: 'A4' },
    });
    const r = await httpReq('POST', '/api/lib/ppt/print', {
      headers: { 'Content-Type': 'application/json' }, body,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  });

  await safe('AP4', '智能体 Excel 打印 API', async () => {
    const body = JSON.stringify({
      spec: {
        sheets: [{
          name: '数据表',
          headers: ['姓名', '分数'],
          rows: [['张三', '95'], ['李四', '87']],
        }],
      },
      print: { paperSize: 'A4', printGridlines: true, orientation: 'landscape' },
    });
    const r = await httpReq('POST', '/api/lib/xls/print', {
      headers: { 'Content-Type': 'application/json' }, body,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    if (!/pdf/i.test(r.headers['content-type'] || '')) throw new Error('非PDF');
  });

  await safe('AP5', '智能体打印 API examples', async () => {
    const r = await httpReq('GET', '/api/lib/examples');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.body);
    if (!j.print_doc) throw new Error('无 print_doc 示例');
    if (!j.print_ppt) throw new Error('无 print_ppt 示例');
    if (!j.print_xls) throw new Error('无 print_xls 示例');
  });
}

// ============ 模块 7: 响应式 (移动端) ============
console.log('\n--- 模块 7: 响应式 (iPhone 13) ---');
{
  const iphone = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...iphone });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  await safe('R1', '移动端首页', async () => {
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1000);
    const title = await page.title();
    if (!/GoOffice|Office/i.test(title)) throw new Error(`title: ${title}`);
    await shot(page, 'r1-mobile');
  });

  await safe('R2', '汉堡菜单', async () => {
    const ham = page.locator('[data-testid="hamburger-toggle"]');
    await ham.click({ timeout: 3000 });
    await page.waitForTimeout(500);
    // 菜单项
    const item = page.locator('[data-testid^="mobile-menu-item-"]').first();
    if (!await item.count()) throw new Error('无菜单项');
  });

  await safe('R3', '移动端表格', async () => {
    const tab = page.locator('[data-testid="tab-spreadsheet"]');
    if (await tab.count()) {
      await tab.click({ timeout: 3000 });
      await page.waitForTimeout(500);
    }
    if (!await page.locator('table').count()) throw new Error('无 table');
  });

  await safe('R4', '移动端演示', async () => {
    // 等待 React 渲染
    await page.waitForSelector('[data-testid="tab-slide"]', { state: 'visible', timeout: 8000 });
    const tab = page.locator('[data-testid="tab-slide"]');
    await tab.click({ timeout: 3000 });
    await page.waitForTimeout(1500);
    // 演示编辑器有 title placeholder
    const input = page.locator('input[placeholder*="title" i], input[type="text"]').first();
    if (!await input.count()) throw new Error('无输入');
  });

  await safe('R5', '移动端输入文档', async () => {
    const tab = page.locator('[data-testid="tab-document"]');
    if (await tab.count()) {
      await tab.click({ timeout: 3000 });
      await page.waitForTimeout(500);
    }
    const pm = page.locator('.ProseMirror').first();
    if (!await pm.count()) throw new Error('无 .ProseMirror');
    await pm.click();
    await page.keyboard.type('Mobile E2E');
    await page.waitForTimeout(200);
    const txt = await pm.evaluate(el => el.innerText);
    if (!txt.includes('Mobile')) throw new Error('输入未保留');
  });

  await ctx.close();
}

// ============ 模块 8: 跨切面 ============
console.log('\n--- 模块 8: 跨切面质量 ---');
{
  await safe('Q1', '无 Console 错误', async () => {
    // 过滤无关紧要的错误（如 favicon 404）
    const real = consoleErrors.filter(e => !/favicon|Failed to load resource/i.test(e));
    if (real.length > 0) {
      throw new Error(`发现 ${real.length} 条 console error: \n  - ` + real.slice(0, 5).join('\n  - '));
    }
  });

  await safe('Q3', '截图归档', async () => {
    const files = fs.readdirSync(SHOTS_DIR).filter(f => f.endsWith('.png'));
    if (files.length < 3) throw new Error(`仅 ${files.length} 张截图`);
  });
}

// ============ 边缘测试 ============
console.log('\n========== 边缘测试 ==========\n');

// E1
console.log('--- E1: 输入边界 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.waitForSelector('.ProseMirror', { timeout: 8000 });

  await safe('E1.1', '超长文本 (5000 字符)', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    // 使用 evaluate 高效插入长文本（避免 keyboard.type 慢）
    await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) return;
      // 模拟 input - ProseMirror 监听 paste 事件
      const longText = 'a'.repeat(5000);
      const dt = new DataTransfer();
      dt.setData('text/plain', longText);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true });
      editor.dispatchEvent(ev);
    });
    await page.waitForTimeout(500);
    const txt = await pm.evaluate(el => el.innerText);
    if (txt.length < 1000) {
      // paste 事件未被处理，fallback：使用 keyboard.type 短一些
      await pm.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.keyboard.type('a'.repeat(2000), { delay: 0 });
      await page.waitForTimeout(300);
      const txt2 = await pm.evaluate(el => el.innerText);
      if (txt2.length < 1500) throw new Error(`length: ${txt2.length}`);
    }
  });

  await safe('E1.2', '清空编辑器', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    const txt = (await pm.evaluate(el => el.innerText)).trim();
    if (txt.length > 0) throw new Error(`未清空: "${txt.slice(0, 50)}"`);
  });

  await safe('E1.3', 'Emoji 输入', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.type('🎉🚀💻 Test');
    await page.waitForTimeout(200);
    const txt = await pm.evaluate(el => el.innerText);
    if (!txt.includes('🎉')) throw new Error('Emoji 未保留');
  });

  await safe('E1.4', 'CJK + 英文 + 阿拉伯文混排', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('你好 Hello مرحبا');
    await page.waitForTimeout(200);
    const txt = await pm.evaluate(el => el.innerText);
    if (!txt.includes('你好') || !txt.includes('Hello') || !txt.includes('مرحبا')) {
      throw new Error('多语言文本丢失');
    }
  });

  await ctx.close();
}

// E2
console.log('--- E2: 工具栏极端操作 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.waitForSelector('.ProseMirror', { timeout: 8000 });

  await safe('E2.1', '连续快速点击加粗 5 次', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.type('rapid');
    const bBtn = page.locator('.toolbar-btn[title*="Bold"]').first();
    for (let i = 0; i < 5; i++) {
      try { await bBtn.click({ timeout: 1500 }); } catch (e) {}
    }
    // 不崩溃即可
  });

  await safe('E2.2', '无选区时点击斜体', async () => {
    const iBtn = page.locator('.toolbar-btn[title*="Italic"]').first();
    await iBtn.click({ timeout: 2000 });
  });

  await safe('E2.3', '全选后依次应用 粗/斜/下', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('mixed styles test');
    await page.waitForTimeout(200);
    // 重新选中所有
    await page.keyboard.press('Control+A');
    await page.locator('.toolbar-btn[title*="Bold"]').first().click({ timeout: 2000 });
    await page.waitForTimeout(150);
    await page.locator('.toolbar-btn[title*="Italic"]').first().click({ timeout: 2000 });
    await page.waitForTimeout(150);
    await page.locator('.toolbar-btn[title*="Underline"]').first().click({ timeout: 2000 });
    await page.waitForTimeout(300);
    const html = await pm.evaluate(el => el.innerHTML);
    // 三种样式应同时存在 (ProseMirror 会嵌套 marks: <strong><em><u>text</u></em></strong>)
    const hasBold = /<strong|<b/i.test(html);
    const hasItalic = /<em|<i/i.test(html);
    const hasUnderline = /<u>/i.test(html);
    if (!hasBold || !hasItalic || !hasUnderline) {
      throw new Error(`未同时应用: bold=${hasBold} italic=${hasItalic} underline=${hasUnderline} html=${html.slice(0, 200)}`);
    }
  });

  await ctx.close();
}

// E3
console.log('--- E3: 查找替换边界 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await page.waitForSelector('.ProseMirror', { timeout: 8000 });

  await safe('E3.2', '搜索特殊字符 .*+?', async () => {
    const pm = page.locator('.ProseMirror').first();
    await pm.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('test .*+? end');
    await page.keyboard.press('Control+F');
    await page.waitForTimeout(500);
    const si = page.locator('input[type="text"], input[type="search"]').first();
    if (await si.count()) {
      await si.fill('.*+?');
      await page.waitForTimeout(300);
    }
  });

  await ctx.close();
}

// E4
console.log('--- E4: 拼写检查边界 ---');
{
  await safe('E4.1', '纯数字文本', async () => {
    const r = await httpReq('GET', '/api/dict/check?text=12345%2067890&lang=en');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.body);
    if (j.errors && j.errors.length > 0) throw new Error(`误报 ${j.errors.length}`);
  });

  await safe('E4.3', '超长单词 (100字符)', async () => {
    const w = 'a'.repeat(100);
    const r = await httpReq('GET', `/api/dict/check?text=${w}&lang=en`);
    if (r.status === 500) throw new Error('返回 500');
  });

  await safe('E4.5', '空文本', async () => {
    const r = await httpReq('GET', '/api/dict/check?text=&lang=en');
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const j = JSON.parse(r.body);
    if (j.errors && j.errors.length > 0) throw new Error(`空文本误报 ${j.errors.length}`);
  });
}

// E5
console.log('--- E5: API 容错 ---');
{
  await safe('E5.1', '缺 text 参数', async () => {
    const r = await httpReq('GET', '/api/dict/check?lang=en');
    if (r.status === 500) throw new Error('返回 500');
  });

  await safe('E5.2', '缺 lang 参数', async () => {
    const r = await httpReq('GET', '/api/dict/check?text=hello');
    if (r.status === 500) throw new Error('返回 500');
  });

  await safe('E5.3', '空 body POST /api/doc/save', async () => {
    const r = await httpReq('POST', '/api/doc/save', {
      headers: { 'Content-Type': 'application/json' }, body: '',
    });
    if (r.status === 500) throw new Error('返回 500');
  });

  await safe('E5.4', '畸形 JSON', async () => {
    const r = await httpReq('POST', '/api/doc/save', {
      headers: { 'Content-Type': 'application/json' }, body: '{not valid',
    });
    if (r.status === 500) throw new Error('返回 500');
  });

  await safe('E5.6', '超长 word (200字符) suggest', async () => {
    const w = 'b'.repeat(200);
    const r = await httpReq('GET', `/api/dict/suggest?word=${w}&lang=en`);
    if (r.status === 500) throw new Error('返回 500');
  });

  await safe('E5.7', '重复学习同一词 10 次', async () => {
    const word = 'replearn_' + Date.now();
    for (let i = 0; i < 10; i++) {
      const r = await httpReq('POST', '/api/dict/learn', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, lang: 'en' }),
      });
      if (r.status === 500) throw new Error(`第 ${i + 1} 次返回 500`);
    }
  });

  await safe('E5.8', '上传空文件', async () => {
    const boundary = '----E2E' + Date.now();
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="empty.txt"\r\nContent-Type: text/plain\r\n\r\n\r\n--${boundary}--\r\n`);
    const r = await httpReq('POST', '/api/doc/open', {
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body,
    });
    if (r.status === 500) throw new Error('返回 500');
  });

  await safe('E5.10', '不存在的本地路径', async () => {
    const r = await httpReq('GET', '/api/doc/local?path=/nonexistent/path/file.docx');
    if (r.status === 500) throw new Error('返回 500');
  });
}

// E6
console.log('--- E6: 表格边界 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const tab = page.locator('[data-testid="tab-spreadsheet"]');
  await tab.click({ timeout: 5000 });
  await page.waitForTimeout(500);
  await page.waitForSelector('table', { timeout: 8000 });

  await safe('E6.1', '单元格超长内容 (200 字符)', async () => {
    const cell = page.locator('table tbody tr:first-child td:nth-child(2) input').first();
    await cell.click();
    await cell.fill('x'.repeat(200));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  });

  await safe('E6.2', '单元格输入 =1+2 公式', async () => {
    const cell = page.locator('table tbody tr:nth-child(2) td:nth-child(2) input').first();
    await cell.click();
    await cell.fill('=1+2');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  });

  await ctx.close();
}

// E7
console.log('--- E7: 演示边界 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  // 等待 React 完全渲染
  await page.waitForSelector('[data-testid="tab-slide"]', { state: 'visible', timeout: 8000 });
  const tab = page.locator('[data-testid="tab-slide"]');
  await tab.click({ timeout: 5000 });
  await page.waitForTimeout(1500);

  await safe('E7.1', '标题输入 200 字符', async () => {
    let titleInput = page.locator('input[placeholder*="title" i]').first();
    if (!await titleInput.count()) {
      titleInput = page.locator('input[type="text"]').first();
    }
    await titleInput.waitFor({ state: 'visible', timeout: 5000 });
    await titleInput.click();
    await titleInput.fill('T'.repeat(200));
    await page.waitForTimeout(300);
    const val = await titleInput.inputValue();
    if (val.length < 100) throw new Error(`length: ${val.length}`);
  });

  await safe('E7.2', '连续新增 5 张幻灯片', async () => {
    // 通过页码 N / M 判断幻灯片数 (使用 data-testid)
    const pageIndicator = page.locator('[data-testid="slide-page-indicator"]').first();
    let before = 0;
    if (await pageIndicator.count()) {
      const txt = await pageIndicator.innerText();
      const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) before = parseInt(m[2]);
    }
    // 先切到 home ribbon
    const homeBtn = page.locator('[data-testid="ribbon-tab-home"]').first();
    if (await homeBtn.count()) {
      try { await homeBtn.click({ timeout: 2000 }); } catch (e) {}
      await page.waitForTimeout(200);
    }
    const addBtn = page.locator('button[title="New"], button[title="新建"]').first();
    for (let i = 0; i < 5; i++) {
      if (await addBtn.count()) {
        try { await addBtn.click({ timeout: 1500 }); } catch (e) {}
        await page.waitForTimeout(150);
      }
    }
    await page.waitForTimeout(300);
    let after = 0;
    if (await pageIndicator.count()) {
      const txt = await pageIndicator.innerText();
      const m = txt.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) after = parseInt(m[2]);
    }
    if (after < before + 3) throw new Error(`${before} → ${after}`);
  });

  await ctx.close();
}

// E8
console.log('--- E8: Markdown / HTML 安全 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  let xssTriggered = false;
  page.on('dialog', async (dialog) => {
    xssTriggered = true;
    console.log('    [XSS alert]', dialog.message());
    await dialog.dismiss();
  });

  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const tab = page.locator('[data-testid="tab-markdown"]');
  await tab.click({ timeout: 5000 });
  await page.waitForTimeout(500);

  await safe('E8.1', 'Markdown 含 <script>', async () => {
    xssTriggered = false;
    const editor = page.locator('textarea').first();
    await editor.click();
    await editor.fill('<script>alert("XSS1")</script>\n\nnormal text');
    await page.waitForTimeout(800);
    if (xssTriggered) throw new Error('XSS 触发！');
  });

  await safe('E8.3', '超长 Markdown (1000 行)', async () => {
    const editor = page.locator('textarea').first();
    await editor.click();
    const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`);
    await editor.fill(lines.join('\n'));
    await page.waitForTimeout(500);
    const val = await editor.inputValue();
    if (val.length < 5000) throw new Error(`length: ${val.length}`);
  });

  await safe('E8.4', '嵌套代码块', async () => {
    const editor = page.locator('textarea').first();
    await editor.click();
    await editor.fill('```go\n// outer\n```python\nprint(1)\n```\n```');
    await page.waitForTimeout(500);
  });

  await safe('E8.5', '表格语法错误', async () => {
    const editor = page.locator('textarea').first();
    await editor.click();
    await editor.fill('| A | B\n| 1 | 2');
    await page.waitForTimeout(500);
  });

  await safe('E8.2', 'HTML 含 <script>alert(1)</script>', async () => {
    xssTriggered = false;
    const tab2 = page.locator('[data-testid="tab-html"]');
    await tab2.click({ timeout: 5000 });
    await page.waitForTimeout(500);
    const editor = page.locator('textarea').first();
    await editor.click();
    await editor.fill('<script>alert("XSS2")</script>');
    await page.waitForTimeout(800);
    if (xssTriggered) throw new Error('XSS 触发！');
  });

  await ctx.close();
}

// E9
console.log('--- E9: 响应式边界 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 400 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  await safe('E9.1', '极小视口 320×400 首页', async () => {
    await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800);
    const title = await page.title();
    if (!/GoOffice|Office/i.test(title)) throw new Error(`title: ${title}`);
    await shot(page, 'e9-tiny');
  });

  await safe('E9.2', '极小视口汉堡菜单可见', async () => {
    const ham = page.locator('[data-testid="hamburger-toggle"]');
    if (!await ham.count()) throw new Error('无汉堡按钮');
  });

  await ctx.close();
}

// E10
console.log('--- E10: 并发与状态 ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  await safe('E10.1', '快速切换 6 个 Tab', async () => {
    const ids = ['document', 'spreadsheet', 'slide', 'markdown', 'html', 'about'];
    for (const id of ids) {
      const t = page.locator(`[data-testid="tab-${id}"]`);
      if (await t.count()) {
        try { await t.click({ timeout: 1500 }); } catch (e) {}
        await page.waitForTimeout(100);
      }
    }
    const docTab = page.locator('[data-testid="tab-document"]');
    if (await docTab.count()) {
      try { await docTab.click({ timeout: 1500 }); } catch (e) {}
    }
    await page.waitForTimeout(300);
  });

  await safe('E10.2', '主题连续切换 10 次', async () => {
    const btn = page.locator('[data-testid="theme-toggle"]');
    for (let i = 0; i < 10; i++) {
      try { await btn.click({ timeout: 1000 }); } catch (e) {}
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(300);
    const theme = await page.locator('html').getAttribute('data-theme');
    if (!theme) throw new Error('data-theme 为空');
  });

  await safe('E10.3', '语言连续切换 10 次', async () => {
    const select = page.locator('select').first();
    const options = await select.locator('option').allTextContents();
    if (options.length < 2) throw new Error('option 不足');
    for (let i = 0; i < 10; i++) {
      const opt = options[i % options.length];
      try { await select.selectOption(opt); } catch (e) {}
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(300);
    const val = await select.inputValue();
    if (!val) throw new Error('select 为空');
  });

  await ctx.close();
}

// ============ 关闭 ============
await browser.close();
console.log('\n=== 测试完成, 关闭服务器 ===');
try { serverProc.kill('SIGTERM'); } catch (e) {}
try { process.kill(-serverProc.pid, 'SIGKILL'); } catch (e) {}

// ============ 汇总 ============
const rate = total > 0 ? (pass / total * 100).toFixed(1) : '0.0';
console.log('\n========== 汇总 ==========');
console.log(`Total: ${total}  PASS: ${pass}  FAIL: ${fail}  通过率: ${rate}%`);

const keyCases = ['S1','S4','D2','D3','D4','D15','D16','P1','P3','P7','L1','M1','M6','A1','A2','A3','A5','A6','A7','A8','R1','Q1'];
const keyFails = results.filter(r => r.status === 'FAIL' && keyCases.includes(r.id));

const summary = {
  total, pass, fail, rate: rate + '%',
  keyFailCount: keyFails.length,
  timestamp: new Date().toISOString(),
  results,
  consoleErrors,
};

fs.writeFileSync(path.join(DOWNLOAD_DIR, 'test-results.json'), JSON.stringify(summary, null, 2));
console.log(`JSON 报告: ${path.join(DOWNLOAD_DIR, 'test-results.json')}`);

const html = generateHTML(summary, keyFails);
fs.writeFileSync(path.join(DOWNLOAD_DIR, 'test-report.html'), html);
console.log(`HTML 报告: ${path.join(DOWNLOAD_DIR, 'test-report.html')}`);

if (fail > 0) {
  console.log('\n--- 失败用例 ---');
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`  ❌ ${r.id} ${r.name} — ${r.error}`);
  });
}

if (keyFails.length > 0) {
  console.log(`\n⚠️  ${keyFails.length} 个关键用例失败`);
  process.exit(2);
} else if (fail > 0) {
  console.log(`\n⚠️  ${fail} 个非关键用例失败`);
  process.exit(0);
} else {
  console.log('\n✅ 全部通过');
  process.exit(0);
}

function generateHTML(s, kf) {
  const rows = s.results.map(r => `
    <tr class="${r.status === 'PASS' ? 'pass' : 'fail'}">
      <td>${r.id}</td>
      <td>${r.name}</td>
      <td><span class="badge ${r.status}">${r.status}</span></td>
      <td>${r.ms}ms</td>
      <td>${r.error || ''}</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>GoOffice E2E Test Report</title>
<style>
  body { font-family: -apple-system, "Segoe UI", "Noto Sans SC", sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
  h1 { color: #333; margin-top: 0; }
  .summary { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .card { background: white; padding: 16px 24px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
  .card .num { font-size: 32px; font-weight: bold; }
  .card .label { color: #666; font-size: 14px; }
  .c-total { color: #2196F3; } .c-pass { color: #4CAF50; } .c-fail { color: #f44336; }
  table { width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-collapse: collapse; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 13px; }
  th { background: #f5f5f5; font-weight: bold; }
  tr.pass td:first-child { color: #4CAF50; }
  tr.fail td:first-child { color: #f44336; }
  .badge { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
  .badge.PASS { background: #e8f5e9; color: #2e7d32; }
  .badge.FAIL { background: #ffebee; color: #c62828; }
  .console-errs { background: #fff3e0; padding: 12px; border-radius: 8px; margin-top: 20px; font-family: monospace; font-size: 12px; max-height: 300px; overflow-y: auto; }
</style>
</head>
<body>
<h1>GoOffice E2E Test Report</h1>
<p>Generated: ${s.timestamp}</p>
<div class="summary">
  <div class="card"><div class="num c-total">${s.total}</div><div class="label">Total</div></div>
  <div class="card"><div class="num c-pass">${s.pass}</div><div class="label">Pass</div></div>
  <div class="card"><div class="num c-fail">${s.fail}</div><div class="label">Fail</div></div>
  <div class="card"><div class="num">${s.rate}</div><div class="label">Rate</div></div>
  <div class="card"><div class="num c-fail">${s.keyFailCount}</div><div class="label">Key Fails</div></div>
</div>
<table>
  <thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${s.consoleErrors.length > 0 ? `<div class="console-errs"><strong>Console Errors (${s.consoleErrors.length}):</strong><br>${s.consoleErrors.map(e => `<div>${e}</div>`).join('')}</div>` : ''}
</body>
</html>`;
}
