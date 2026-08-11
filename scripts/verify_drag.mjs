import { chromium } from 'playwright'

const HTML = `
<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="old"></div>
<div id="new"></div>
<script>
  const SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const oldImg = document.createElement('img'); oldImg.src = SRC
  document.getElementById('old').appendChild(oldImg)
  const newImg = document.createElement('img'); newImg.src = SRC
  newImg.draggable = false
  newImg.addEventListener('dragstart', (e) => e.preventDefault())
  document.getElementById('new').appendChild(newImg)
  window.testDrag = (which) => {
    const img = which === 'old' ? oldImg : newImg
    const dt = new DataTransfer()
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
    img.dispatchEvent(ev)
    return { draggable: img.draggable, defaultPrevented: ev.defaultPrevented }
  }
</script>
</body></html>
`

const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(HTML)
const oldR = await page.evaluate("window.testDrag('old')")
const newR = await page.evaluate("window.testDrag('new')")
console.log('OLD (buggy):', JSON.stringify(oldR))
console.log('NEW (fixed):', JSON.stringify(newR))
if (newR.draggable !== false) throw new Error('fixed img must be draggable=false')
if (newR.defaultPrevented !== true) throw new Error('fixed img dragstart must be prevented')
if (oldR.draggable !== true) throw new Error('old img default draggable=true (bug source)')
console.log('VERIFY_OK: image node no longer a draggable File source -> Wails ResolveFilePaths will not be triggered')
await browser.close()
