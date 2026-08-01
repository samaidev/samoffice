# -*- coding: utf-8 -*-
"""Stage 4 大学高等数学：用 sympy 生成求导、不定积分、极限题（带标准答案）。

用法: python stage4_calculus.py -n 50000 -o data/stage4
"""
import random

import sympy as sp

from common import make_argparser, JsonlWriter

x = sp.Symbol("x")

# 基函数库大幅扩充：覆盖幂/三角/反三角/指数/对数/双曲/根式/有理式/复合，
# 系数与指数范围放宽，从而把"唯一样本上限"从数千提升到十万级。
def _poly(rng):
    # 随机多项式 a*x^p + b*x^q，限制项数(2-3)与最高次(<=4)，保证导数化简可控
    terms = []
    for _ in range(rng.randint(2, 3)):
        a = rng.randint(1, 9)
        p = rng.randint(1, 4)
        terms.append(a * x ** p)
    return sum(terms) + rng.randint(0, 5)


def _trig(rng):
    k = rng.randint(1, 3)
    ph = rng.randint(0, 2)
    base = rng.choice([sp.sin, sp.cos])
    return base(k * x + ph)


def _inv_trig(rng):
    k = rng.randint(1, 4)
    return rng.choice([sp.asin, sp.acos, sp.atan])(k * x / (rng.randint(2, 6)))


def _exp(rng):
    k = rng.randint(1, 4)
    e = sp.exp(k * x)
    if rng.random() < 0.5:
        e = e + rng.randint(1, 5) * x ** rng.randint(1, 2)
    return e


def _log(rng):
    inner = rng.randint(2, 9) * x + rng.randint(1, 5)
    if rng.random() < 0.5:
        return sp.log(inner)
    return sp.log(inner) ** rng.randint(2, 3)


def _hyperbolic(rng):
    k = rng.randint(1, 3)
    return rng.choice([sp.sinh, sp.cosh, sp.tanh])(k * x)


def _root(rng):
    p = rng.randint(2, 5)
    a = rng.randint(1, 6)
    return (a * x + rng.randint(1, 5)) ** (1 / sp.Rational(p))


def _rational(rng):
    # 形如 (a*x+b)/(c*x+d)
    a, b, c, d = (rng.randint(1, 8) for _ in range(4))
    return (a * x + b) / (c * x + d)


def _composite(rng):
    # 复合函数：sin(exp)/exp(sin)/log(sin) 等
    inner = rng.choice([sp.sin, sp.cos, sp.exp, lambda v: v ** 2])(rng.randint(1, 3) * x)
    outer = rng.choice([sp.sin, sp.cos, sp.exp, sp.log])
    return outer(inner)


BASE_FUNCS = [
    _poly, _trig, _inv_trig, _exp, _log, _hyperbolic, _root, _rational, _composite,
]

# 仅用于求导/积分/泰勒的安全子集：sympy 能稳定快速处理的初等函数。
# 关键排除 _inv_trig（其二阶导/高次化简极慢）、_composite/_rational/_log** 等。
# 只用 幂/三角/指数/双曲 的线性组合，sympy 的 diff/integrate/simplify 均 <1s。
DERIV_SAFE = [_poly, _trig, _exp, _hyperbolic]
INTEG_SAFE = [_poly, _trig, _exp, _hyperbolic]


def rand_expr(rng, nterms=2, pool=DERIV_SAFE):
    """只用线性组合（加/减），避免乘法导致 sympy integrate/diff 爆炸。"""
    expr = pool[rng.randrange(len(pool))](rng)
    for _ in range(nterms - 1):
        f = pool[rng.randrange(len(pool))](rng)
        # 仅做加法或减法（线性运算，sympy 永远快）
        if rng.random() < 0.5:
            expr = expr + f
        else:
            expr = expr - f
    return expr


def rand_safe_expr(rng, nterms=2):
    """只用可快速积分的简单函数构造表达式（用于积分/泰勒题）。"""
    return rand_expr(rng, nterms, pool=INTEG_SAFE)


def fmt(e):
    return sp.sstr(sp.simplify(e)).replace("**", "^")


def gen_derivative(rng):
    expr = rand_expr(rng, rng.randint(1, 3))
    d = sp.diff(expr, x)
    return (f"题目：求函数 f(x) = {fmt(expr)} 的导数。\n"
            f"解：根据求导法则逐项求导。\n"
            f"答：f'(x) = {fmt(d)}。")


def gen_integral(rng):
    # 只用可快速积分的安全子集，避免 sympy 在复杂复合函数上卡死
    expr = rand_safe_expr(rng, rng.randint(1, 2))
    F = sp.integrate(expr, x)
    if F.has(sp.Integral):
        return gen_integral(rng)
    return (f"题目：求不定积分 ∫ ({fmt(expr)}) dx。\n"
            f"解：逐项积分。\n"
            f"答：∫ ({fmt(expr)}) dx = {fmt(F)} + C。")


def gen_limit(rng):
    kind = rng.randint(0, 2)
    if kind == 0:
        a = rng.randint(1, 5)
        expr = sp.sin(a * x) / x
        pt, s = 0, "0"
    elif kind == 1:
        a, b = rng.randint(1, 5), rng.randint(1, 5)
        expr = (a * x ** 2 + x) / (b * x ** 2 + 1)
        pt, s = sp.oo, "∞"
    else:
        a = rng.randint(1, 4)
        expr = (1 + a / x) ** x
        pt, s = sp.oo, "∞"
    lim = sp.limit(expr, x, pt)
    return (f"题目：求极限 lim(x→{s}) {fmt(expr)}。\n"
            f"解：利用重要极限与洛必达法则等方法计算。\n"
            f"答：极限值为 {fmt(lim)}。")


def gen_derivative_at_point(rng):
    expr = rand_expr(rng, 2)
    d = sp.diff(expr, x)
    a = rng.randint(1, 3)
    try:
        val = sp.simplify(d.subs(x, a))
    except Exception:
        return gen_derivative_at_point(rng)
    if val.has(sp.zoo) or val.has(sp.nan):
        return gen_derivative_at_point(rng)
    return (f"题目：设 f(x) = {fmt(expr)}，求 f'({a})。\n"
            f"解：先求导 f'(x) = {fmt(d)}；再代入 x = {a}。\n"
            f"答：f'({a}) = {fmt(val)}。")


def gen_second_derivative(rng):
    expr = rand_expr(rng, rng.randint(1, 3))
    d1 = sp.diff(expr, x)
    d2 = sp.diff(d1, x)
    return (f"题目：求函数 f(x) = {fmt(expr)} 的二阶导数。\n"
            f"解：先求一阶导 f'(x) = {fmt(d1)}；再对一阶导求导。\n"
            f"答：f''(x) = {fmt(d2)}。")


def gen_definite_integral(rng):
    # 只用可快速积分的安全子集
    expr = rand_safe_expr(rng, rng.randint(1, 2))
    F = sp.integrate(expr, x)
    if F.has(sp.Integral):
        return gen_definite_integral(rng)
    a, b = rng.randint(0, 2), rng.randint(3, 6)
    try:
        val = sp.simplify(F.subs(x, b) - F.subs(x, a))
    except Exception:
        return gen_definite_integral(rng)
    if val.has(sp.zoo) or val.has(sp.nan):
        return gen_definite_integral(rng)
    return (f"题目：计算定积分 ∫({fmt(expr)})dx 从 {a} 到 {b}。\n"
            f"解：先求原函数 F(x) = {fmt(F)}，再用牛顿-莱布尼茨公式。\n"
            f"答：∫ 从 {a} 到 {b} = {fmt(val)}。")


def gen_taylor(rng):
    # 在 x=0 处展开到指定阶；只用 sin/cos/exp（展开稳定）
    expr = rng.choice([sp.sin, sp.cos, sp.exp])(rng.randint(1, 3) * x)
    order = rng.randint(3, 5)
    try:
        t = sp.series(expr, x, 0, order + 1).removeO()
    except Exception:
        return gen_taylor(rng)
    if t.has(sp.Order) or t.has(sp.nan):
        return gen_taylor(rng)
    return (f"题目：将函数 f(x) = {fmt(expr)} 在 x = 0 处展开为 {order} 阶泰勒多项式。\n"
            f"解：利用基本展开公式逐项计算。\n"
            f"答：f(x) ≈ {fmt(t)} + o(x^{order})。")


GENS = [(3, gen_derivative), (3, gen_integral), (2, gen_limit),
        (2, gen_derivative_at_point), (2, gen_second_derivative),
        (2, gen_definite_integral), (1, gen_taylor)]


def main():
    import time

    args = make_argparser("Stage4 高等数学数据生成").parse_args()
    rng = random.Random(args.seed)
    w = JsonlWriter(args.outdir, "stage4_calculus.jsonl", max_unique=args.max_unique)
    fns, weights = [g for _, g in GENS], [wt for wt, _ in GENS]

    for i in range(args.num):
        if i % 500 == 0:
            print(f"[progress] {i}/{args.num} unique={w.unique}", flush=True)
        try:
            text = rng.choices(fns, weights=weights)[0](rng)
        except Exception:
            continue
        r = w.write("s4-calc", 4, "advanced_math", "大学", text)
        if r == "STOP":
            break
    w.close()


if __name__ == "__main__":
    main()
