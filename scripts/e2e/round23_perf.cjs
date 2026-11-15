// round23_perf.cjs —— 远程真实环境性能剖析：打开文档耗时/滚动 FPS/打字延迟/长任务
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
}
async function main(){
  const tab = await CDPTab.open()
  // 注入性能采集器
  await tab.eval(`(() => {
    window.__perf = { longTasks: [], frames: 0, scrollEvents: 0 }
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) window.__perf.longTasks.push({ dur: Math.round(e.duration), start: Math.round(e.startTime), name: e.name.slice(0,40) })
    }).observe({ entryTypes: ['longtask'] })
    return 'perf observer ready'
  })()`)
  // 重新打开文档并计时
  const t0 = Date.now()
  const opened = await tab.eval(`(async () => {
    const b64 = window.__docB64parts ? window.__docB64parts.join('') : null
    if (!b64) return { err: 'no doc parts' }
    const bin = atob(b64); const bytes = new Uint8Array(bin.length)
    for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i)
    const form = new FormData(); form.append('file', new Blob([bytes]), 'c.docx')
    const r = await fetch('/api/doc/open', { method:'POST', body: form })
    const j = await r.json()
    const t1 = performance.now()
    window.__setDocForTest(j.document)
    return { parsed: Math.round(t1), blocks: j.document.blocks.length }
  })()`)
  console.log('[parse+api]', JSON.stringify(opened))
  // 等分页稳定
  await new Promise(r=>setTimeout(r,8000))
  const settle = await tab.eval(`(() => ({ longTasks: window.__perf.longTasks.length, worst: Math.max(0,...window.__perf.longTasks.map(t=>t.dur)), totalLong: window.__perf.longTasks.reduce((a,t)=>a+t.dur,0) }))()`)
  console.log('[打开文档 8s 内]', JSON.stringify(settle))
  // 滚动 20 次测帧率
  await tab.eval(`window.__perf.frames = 0; let last = performance.now(); const cnt = () => { window.__perf.frames++; requestAnimationFrame(cnt) }; requestAnimationFrame(cnt); window.__perf._t0 = performance.now()`)
  for (let i=0;i<24;i++) { await tab.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:700,y:400,deltaY:-600}); await new Promise(r=>setTimeout(r,90)) }
  await new Promise(r=>setTimeout(r,1500))
  const scrollPerf = await tab.eval(`(() => { const el = performance.now() - window.__perf._t0; return { ms: Math.round(el), fps: Math.round(window.__perf.frames / (el/1000)), longDuringScroll: window.__perf.longTasks.length } })()`)
  console.log('[滚动性能]', JSON.stringify(scrollPerf))
  // 打字延迟
  const typePerf = await tab.eval(`(async () => {
    const pm = window.__pmView
    pm.focus()
    const times = []
    for (let i=0;i<10;i++) {
      const t0 = performance.now()
      pm.dispatch(pm.state.tr.insertText('x'))
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
      times.push(Math.round(performance.now()-t0))
    }
    return { perKeyMs: times, avg: Math.round(times.reduce((a,b)=>a+b,0)/times.length) }
  })()`)
  console.log('[打字延迟]', JSON.stringify(typePerf))
  // 撤销
  await tab.eval(`for(let i=0;i<10;i++) window.__pmView.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`)
  // 最长任务明细
  const worst = await tab.eval(`window.__perf.longTasks.sort((a,b)=>b.dur-a.dur).slice(0,8)`)
  console.log('[最重长任务]', JSON.stringify(worst))
  console.log('[PERF DONE]')
  tab.ws.close()
}
main().catch(e=>{console.error('ERR:',e.message);process.exit(1)})
