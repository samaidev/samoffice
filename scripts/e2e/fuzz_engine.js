
;(function () {
  // === 注入公式引擎（与 SpreadsheetEditor.tsx 完全一致的纯函数） ===
  function colToNum(name) {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function cellValue(data, ref) {
  const m = ref.match(/^\$?([A-Za-z]+)\$?(\d+)$/);
  if (!m) return 0;
  const c = colToNum(m[1]) - 1;
  const r = parseInt(m[2], 10) - 1;
  const cell = data[`${r}-${c}`];
  if (!cell) return 0;
  const v = (cell.value ?? "").trim();
  if (v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? v : n;
}
function rangeValues(a, b, data) {
  const ma = a.match(/^\$?([A-Za-z]+)\$?(\d+)$/);
  const mb = b.match(/^\$?([A-Za-z]+)\$?(\d+)$/);
  if (!ma || !mb) return [];
  const c1 = colToNum(ma[1]) - 1, r1 = parseInt(ma[2], 10) - 1;
  const c2 = colToNum(mb[1]) - 1, r2 = parseInt(mb[2], 10) - 1;
  const out = [];
  for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
      const cell = data[`${r}-${c}`];
      const v = cell?.value ?? "";
      const n = Number(v);
      out.push(isNaN(n) ? 0 : n);
    }
  }
  return out;
}
function applyFunc(name, args) {
  const flat = [];
  const collect = (a) => {
    if (Array.isArray(a)) a.forEach(collect);
    else {
      const n = typeof a === "number" ? a : Number(a);
      flat.push(isNaN(n) ? 0 : n);
    }
  };
  switch (name.toUpperCase()) {
    case "SUM":
      args.forEach(collect);
      return flat.reduce((s, x) => s + x, 0);
    case "AVERAGE":
    case "AVG":
      args.forEach(collect);
      return flat.length ? flat.reduce((s, x) => s + x, 0) / flat.length : 0;
    case "MIN":
      args.forEach(collect);
      return flat.length ? Math.min(...flat) : 0;
    case "MAX":
      args.forEach(collect);
      return flat.length ? Math.max(...flat) : 0;
    case "COUNT":
      args.forEach(collect);
      return flat.length;
    case "ROUND":
      return Math.round(Number(args[0]) * Math.pow(10, Number(args[1] ?? 0))) / Math.pow(10, Number(args[1] ?? 0));
    case "ABS":
      return Math.abs(Number(args[0]));
    default:
      return "#NAME?";
  }
}
function tokenize(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || ch === "." && /[0-9]/.test(s[i + 1] || "")) {
      let j = i, str = "";
      while (j < s.length && /[0-9.]/.test(s[j])) {
        str += s[j];
        j++;
      }
      toks.push({ t: "NUM", v: str });
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i, str = "";
      while (j < s.length && /[A-Za-z]/.test(s[j])) {
        str += s[j];
        j++;
      }
      if (s[j] === "(") {
        toks.push({ t: "FUNC", v: str });
        i = j;
        continue;
      }
      let k = j, nums = "";
      while (k < s.length && /[0-9]/.test(s[k])) {
        nums += s[k];
        k++;
      }
      toks.push({ t: "REF", v: str + nums });
      i = nums ? k : j;
      continue;
    }
    if (ch === "$") {
      i++;
      continue;
    }
    if ("()+,:+-*/^".includes(ch)) toks.push({ t: ch === "(" ? "LPAREN" : ch === ")" ? "RPAREN" : ch === "," ? "COMMA" : ch === ":" ? "COLON" : "OP", v: ch });
    i++;
  }
  return toks;
}
function evalFormula(expr, data) {
  expr = expr.trim();
  if (expr.startsWith("=")) expr = expr.slice(1);
  if (expr === "") return "";
  const tokens = tokenize(expr);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  function parseRangeRef() {
    const a = next();
    if (a.t !== "REF") throw new Error("expected ref");
    if (peek()?.t === "COLON") {
      next();
      const b = next();
      return { kind: "range", a: a.v, b: b.v };
    }
    return { kind: "ref", a: a.v };
  }
  function parseArg() {
    if (peek()?.t === "REF") {
      const r = parseRangeRef();
      return r.kind === "range" ? rangeValues(r.a, r.b, data) : cellValue(data, r.a);
    }
    return parseAddSub();
  }
  function parseAtom() {
    const tk = peek();
    if (!tk) throw new Error("unexpected end");
    if (tk.t === "NUM") {
      next();
      return parseFloat(tk.v);
    }
    if (tk.t === "REF") {
      const r = parseRangeRef();
      return r.kind === "range" ? rangeValues(r.a, r.b, data) : cellValue(data, r.a);
    }
    if (tk.t === "FUNC") {
      next();
      if (next()?.t !== "LPAREN") throw new Error("expected (");
      const args = [];
      if (peek() && peek().t !== "RPAREN") {
        args.push(parseArg());
        while (peek()?.t === "COMMA") {
          next();
          args.push(parseArg());
        }
      }
      if (next()?.t !== "RPAREN") throw new Error("expected )");
      return applyFunc(tk.v, args);
    }
    if (tk.t === "LPAREN") {
      next();
      const v = parseAddSub();
      if (next()?.t !== "RPAREN") throw new Error("expected )");
      return v;
    }
    if (tk.t === "OP" && tk.v === "-") {
      next();
      return -parseAtom();
    }
    if (tk.t === "OP" && tk.v === "+") {
      next();
      return parseAtom();
    }
    throw new Error("unexpected token");
  }
  function parsePow() {
    let left = parseAtom();
    while (peek()?.t === "OP" && peek().v === "^") {
      next();
      left = Math.pow(Number(left), Number(parseAtom()));
    }
    return left;
  }
  function parseMulDiv() {
    let left = parsePow();
    while (peek()?.t === "OP" && (peek().v === "*" || peek().v === "/")) {
      const op = next().v;
      const right = parsePow();
      left = op === "*" ? Number(left) * Number(right) : Number(left) / Number(right);
    }
    return left;
  }
  function parseAddSub() {
    let left = parseMulDiv();
    while (peek()?.t === "OP" && (peek().v === "+" || peek().v === "-")) {
      const op = next().v;
      const right = parseMulDiv();
      left = op === "+" ? Number(left) + Number(right) : Number(left) - Number(right);
    }
    return left;
  }
  try {
    const res = parseAddSub();
    return typeof res === "number" && !isFinite(res) ? "#ERROR" : res;
  } catch {
    return "#ERROR";
  }
}


  const t0 = performance.now();
  const bad = [];
  const slow = [];
  const inputs = [];
  // 1. 枚举畸形组合
  const atoms = ['SUM(', '(', ')', ',', ':', 'A1', 'B2', 'ZZZZ1', 'A', '1', '+', '-', '*', '/', '^',
                 'IF(', 'ROUND(', 'ABS(', 'A1:A99', 'A1:ZZZZ9', '"x"', 'A1:A99999999', '$A$1', 'A1:B2'];
  // 随机拼接 2~5 个原子
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 800; i++) {
    let s = '=';
    const n = 2 + Math.floor(rnd() * 4);
    for (let j = 0; j < n; j++) s += atoms[Math.floor(rnd() * atoms.length)];
    inputs.push(s);
  }
  // 2. 针对性用例
  inputs.push('=SUM(A1:ZZZZZZZ1)');   // 80 亿列循环 → 冻结风险
  inputs.push('=SUM(A1:AAAAAAA1)');
  inputs.push('=COUNT(A1:ZZZZ999)');
  inputs.push('=SUM(A1:A999999999)'); // 10 亿行循环
  inputs.push('=IF(');
  inputs.push('=ROUND(A1,');
  inputs.push('=A1:');

  const data = { '0-0': { value: '1' }, '0-1': { value: '2' }, '1-0': { value: '3' } };
  for (const fx of inputs) {
    const s = performance.now();
    try {
      const r = evalFormula(fx, data);
      const dt = performance.now() - s;
      if (dt > 300) slow.push(fx + ' -> ' + String(r).slice(0, 20) + ' (' + Math.round(dt) + 'ms)');
      if (typeof r === 'number' && (isNaN(r) || !isFinite(r))) bad.push(fx + ' -> ' + r);
    } catch (e) {
      bad.push(fx + ' -> THROW: ' + e.message);
    }
  }
  window.__fuzzResult = { total: inputs.length, bad, slow, ms: Math.round(performance.now() - t0) };
  return JSON.stringify(window.__fuzzResult);
})()
