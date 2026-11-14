import json, subprocess, sys

def dump(path):
    out = subprocess.check_output(["go", "run", "./cmd/verifycmp", path], cwd="c:/Users/Administrator/samoffice-1")
    return json.loads(out)

def norm_run(r):
    # 忽略默认样式噪声：color #000000、fontSize 11、fontFamily Calibri、align None
    color = r.get("color")
    if color in (None, "#000000", "#000000ff"):
        color = None
    fam = r.get("fontFamily")
    if fam in (None, "Calibri"):
        fam = None
    size = r.get("fontSize")
    if size in (None, 11):
        size = None
    align = r.get("align")
    if align in (None,):
        align = None
    return {
        "content": r.get("content"),
        "bold": r.get("bold") or False,
        "italic": r.get("italic") or False,
        "color": color,
        "bg": r.get("bg"),
        "align": align,
        "fontSize": size,
        "fontFamily": fam,
    }

def cell_props(c):
    inline = c.get("inline") or []
    runs = [norm_run(r) for r in inline]
    return {
        "runs": runs,
        "formula": c.get("formula"),
        "isHeader": c.get("isHeader"),
        "rowSpan": c.get("rowSpan"),
        "colSpan": c.get("colSpan"),
    }

def collect(doc):
    # (block_idx, row, col) -> props
    cells = {}
    blocks = doc.get("blocks", [])
    for bi, blk in enumerate(blocks):
        rows = blk.get("rows", [])
        for ri, row in enumerate(rows):
            if row is None:
                continue
            for ci, c in enumerate(row):
                if c is None:
                    continue
                cells[(bi, ri, ci)] = cell_props(c)
    return cells

def main():
    if len(sys.argv) < 3:
        print("usage: compare.py file.xlsx file.xls")
        sys.exit(2)
    a = collect(dump(sys.argv[1]))
    b = collect(dump(sys.argv[2]))
    keys = sorted(set(a) | set(b))
    diffs = 0
    for k in keys:
        pa, pb = a.get(k), b.get(k)
        if pa != pb:
            diffs += 1
            print(f"DIFF block={k[0]} r={k[1]} c={k[2]}:")
            print(f"  xlsx: {pa}")
            print(f"  xls : {pb}")
    print(f"\nTotal cells xlsx={len(a)} xls={len(b)} diffs={diffs}")

if __name__ == "__main__":
    main()
