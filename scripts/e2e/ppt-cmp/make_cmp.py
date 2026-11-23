# 生成对比拼图：每图 2 页，每页 = 参考上 / 我方下（等宽归一）
from PIL import Image
import os

REF = '/home/z/my-project/samoffice/scripts/e2e/ppt-cmp/ref'
OURS = '/home/z/my-project/samoffice/scripts/e2e/ppt-cmp/ours'
OUT = '/home/z/my-project/samoffice/scripts/e2e/ppt-cmp/cmp'
os.makedirs(OUT, exist_ok=True)

W = 760  # 每页归一宽

def load_pair(page):
    ref = Image.open(f'{REF}/pg-{page:02d}.png').convert('RGB')
    our = Image.open(f'{OURS}/s{page:02d}.png').convert('RGB')
    rs = W / ref.width
    ref = ref.resize((W, round(ref.height * rs)))
    os_ = W / our.width
    our = our.resize((W, round(our.height * os_)))
    return ref, our

# 每张拼图 2 页：[ref A / ours A] 左 | [ref B / ours B] 右
pairs = [(1, 2), (3, 4), (5, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16)]
for a, b in pairs:
    ra, oa = load_pair(a)
    rb, ob = load_pair(b)
    cell_h = max(ra.height + oa.height, rb.height + ob.height) + 8
    canvas = Image.new('RGB', (W * 2 + 12, cell_h), (255, 255, 255))
    canvas.paste(ra, (0, 0)); canvas.paste(oa, (0, ra.height + 8))
    canvas.paste(rb, (W + 12, 0)); canvas.paste(ob, (W + 12, rb.height + 8))
    canvas.save(f'{OUT}/cmp-{a:02d}-{b:02d}.png')
    print('cmp', a, b, canvas.size)
print('done')
