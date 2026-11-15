// 远程真实 GPU：block+contain 组合验证（表格点击 + 振荡 + 打字延迟）
const http = require('http')
const PORT = process.argv[2] || '9223'
const BASE = `http://127.0.0.1:${PORT}`
function getJSON(path) {
  return new Promise((res, rej) => {
    http.get(BASE + path, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}}) }).on('error', rej)
  })
}
class CDPTab {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map()}
  static async open(){ const list=await getJSON('/json/list'); const page=list.find(t=>t.type==='page'&&t.url.includes('aitun')); const ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej}); const tab=new CDPTab(ws); ws.onmessage=ev=>{const m=JSON.parse(ev.data); if(m.id&&tab.pending.has(m.id)){tab.pending.get(m.id)(m);tab.pending.delete(m.id)}}; return tab }
  send(method,params={}){return new Promise(res=>{const id=++this.id;this.pending.set(id,res);this.ws.send(JSON.stringify({id,method,params}))})}
  async eval(x){const r=await this.send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return r.result?.result?.value}
  async click(x,y){await this.send('Input.dispatchMouseEvent',{type:'mousePressed',x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});await this.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:Math.round(x),y:Math.round(y),button:'left',clickCount:1})}
}
async function main(){
  const tab = await CDPTab.open()
  console.log('[page]', await tab.eval('location.href'))
  // 注入 block+contain
  await tab.eval(`(() => { const s = document.createElement('style'); s.id='mb'; s.textContent = '.sam-math { display: block !important; contain: layout style paint }'; document.head.appendChild(s); return 'injected' })()`)
  await new Promise(r=>setTimeout(r,1500))
  // 1) 表格点击 + 输入（真实 GPU）
  await tab.eval(`document.querySelector('.ProseMirror table td').scrollIntoView({block:'center'})`)
  await new Promise(r=>setTimeout(r,1500))
  const box = await tab.eval(`(() => { const td = document.querySelector('.ProseMirror table td'); const r = td.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, vis: r.y > 100 && r.y < 750 } })()`)
  if (box.vis) {
    await tab.click(box.x, box.y)
    await new Promise(r=>setTimeout(r,500))
    const l1 = await tab.eval(`window.__pmView.state.doc.textContent.length`)
    await tab.send('Input.dispatchKeyEvent',{type:'keyDown',key:'W',code:'KeyW',windowsVirtualKeyCode:87,text:'W'})
    await tab.send('Input.dispatchKeyEvent',{type:'keyUp',key:'W',code:'KeyW',windowsVirtualKeyCode:87})
    await new Promise(r=>setTimeout(r,400))
    const l2 = await tab.eval(`window.__pmView.state.doc.textContent.length`)
    const focus = await tab.eval(`window.__pmView.hasFocus()`)
    console.log('[表格点击 focus]', focus?'PASS':'FAIL', '| [表格输入]', l2>l1?`PASS (${l1}→${l2})`:'FAIL')
    await tab.eval(`window.__pmView.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`)
  } else console.log('[表格]', box)
  // 2) 振荡 + 打字延迟（block 模式）
  const perf = await tab.eval(`(async () => {
    window.__pgCount = 0
    const pm = window.__pmView
    const orig = pm.dispatch.bind(pm)
    pm.dispatch = (tr) => { if (tr.meta && ('pagination'+'$') in tr.meta) window.__pgCount++; return orig(tr) }
    pm.focus()
    const times = []
    for (let i=0;i<8;i++) {
      const t0 = performance.now()
      pm.dispatch(pm.state.tr.insertText('q'))
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
      times.push(Math.round(performance.now()-t0))
    }
    for (let i=0;i<8;i++) pm.dispatch(pm.state.tr.delete(1,2).setMeta('addToHistory',false)), await 0
    await new Promise(r=>setTimeout(r,2000))
    return { pgDispatch: window.__pgCount, avgKeyMs: Math.round(times.reduce((a,b)=>a+b,0)/times.length), times }
  })()`)
  console.log('[打字延迟/振荡]', JSON.stringify(perf))
  console.log('[DONE]')
  tab.ws.close()
}
main().catch(e=>{console.error('ERR:',e.message);process.exit(1)})
