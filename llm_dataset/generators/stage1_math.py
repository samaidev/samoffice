# -*- coding: utf-8 -*-
"""Stage 1 小学数学：按年级分层生成四则运算、小数分数、应用题（均带解题步骤）。

用法: python stage1_math.py -n 200000 -o data/stage1
"""
import random
from fractions import Fraction

from common import make_argparser, JsonlWriter


def g1_add_sub(rng):
    """一年级：20以内加减"""
    a, b = rng.randint(1, 19), rng.randint(1, 19)
    if rng.random() < 0.5:
        a, b = max(a, b), min(a, b)
        return "一年级", f"题目：{a} - {b} = ?\n解：从{a}里去掉{b}，得到{a - b}。\n答：{a} - {b} = {a - b}。"
    if a + b > 20:
        a, b = 20 - b if 20 - b > 0 else 1, b
    return "一年级", f"题目：{a} + {b} = ?\n解：{a}加上{b}，得到{a + b}。\n答：{a} + {b} = {a + b}。"


def g2_mul_div(rng):
    """二年级：表内乘除"""
    a, b = rng.randint(2, 9), rng.randint(2, 9)
    if rng.random() < 0.5:
        return "二年级", f"题目：{a} × {b} = ?\n解：{a}乘{b}，口诀：{a}{'一二三四五六七八九'[b-1]}{'得' if a*b<10 else ''}{a*b}。\n答：{a} × {b} = {a * b}。"
    c = a * b
    return "二年级", f"题目：{c} ÷ {a} = ?\n解：因为 {a} × {b} = {c}，所以 {c} ÷ {a} = {b}。\n答：{c} ÷ {a} = {b}。"


def g3_multi_digit(rng):
    """三年级：多位数加减乘"""
    op = rng.choice(["+", "-", "×"])
    if op == "×":
        a, b = rng.randint(11, 99), rng.randint(2, 9)
        return "三年级", f"题目：{a} × {b} = ?\n解：{a} × {b} = {a // 10 * 10} × {b} + {a % 10} × {b} = {a // 10 * 10 * b} + {a % 10 * b} = {a * b}。\n答：{a * b}。"
    a, b = rng.randint(100, 999), rng.randint(100, 999)
    if op == "-":
        a, b = max(a, b), min(a, b)
        return "三年级", f"题目：{a} - {b} = ?\n解：按位相减，{a} - {b} = {a - b}。\n答：{a - b}。"
    return "三年级", f"题目：{a} + {b} = ?\n解：按位相加，{a} + {b} = {a + b}。\n答：{a + b}。"


def g4_mixed(rng):
    """四年级：混合运算（先乘除后加减）"""
    a, b, c = rng.randint(2, 20), rng.randint(2, 9), rng.randint(2, 9)
    if rng.random() < 0.5:
        return "四年级", (f"题目：{a} + {b} × {c} = ?\n解：先算乘法，{b} × {c} = {b * c}；"
                          f"再算加法，{a} + {b * c} = {a + b * c}。\n答：{a + b * c}。")
    d = b * c
    return "四年级", (f"题目：({a} + {d}) ÷ {b} = ?\n解：先算括号，{a} + {d} = {a + d}；"
                      f"再算除法，{a + d} ÷ {b} = {(a + d) / b if (a + d) % b else (a + d) // b}。\n答：{(a + d) // b if (a + d) % b == 0 else round((a + d) / b, 2)}。")


def g5_decimal_fraction(rng):
    """五年级：小数与分数"""
    if rng.random() < 0.5:
        a = round(rng.uniform(0.1, 99.9), 1)
        b = round(rng.uniform(0.1, 9.9), 1)
        return "五年级", f"题目：{a} + {b} = ?\n解：小数点对齐相加，{a} + {b} = {round(a + b, 2)}。\n答：{round(a + b, 2)}。"
    f1 = Fraction(rng.randint(1, 5), rng.randint(2, 9))
    f2 = Fraction(rng.randint(1, 5), rng.randint(2, 9))
    s = f1 + f2
    return "五年级", (f"题目：{f1.numerator}/{f1.denominator} + {f2.numerator}/{f2.denominator} = ?\n"
                      f"解：通分后相加，结果约分为 {s.numerator}/{s.denominator}。\n"
                      f"答：{s.numerator}/{s.denominator}。")


def g6_percent(rng):
    """六年级：百分数与比例"""
    total = rng.randint(2, 20) * 50
    p = rng.choice([10, 20, 25, 40, 50, 60, 75, 80])
    part = total * p // 100
    return "六年级", (f"题目：{total}的{p}%是多少？\n解：{total} × {p}% = {total} × {p / 100} = {part}。\n答：{part}。")


NAMES = ["小明", "小红", "小刚", "小丽", "小华"]
ITEMS = [("苹果", "个", 2, 8), ("铅笔", "支", 1, 5), ("本子", "本", 2, 6),
         ("橡皮", "块", 1, 3), ("糖果", "颗", 1, 4), ("气球", "个", 2, 5)]


def word_problem(rng):
    """应用题（购物/分配/行程）"""
    kind = rng.randint(0, 2)
    name = rng.choice(NAMES)
    if kind == 0:  # 购物
        item, unit, lo, hi = rng.choice(ITEMS)
        price, n = rng.randint(lo, hi), rng.randint(2, 9)
        return "三年级", (f"题目：{name}买了{n}{unit}{item}，每{unit}{item}{price}元，一共花了多少元？\n"
                          f"解：总价 = 单价 × 数量 = {price} × {n} = {price * n}（元）。\n"
                          f"答：一共花了{price * n}元。")
    if kind == 1:  # 平均分
        item, unit, _, _ = rng.choice(ITEMS)
        k = rng.randint(2, 6)
        each = rng.randint(2, 9)
        total = k * each
        return "三年级", (f"题目：把{total}{unit}{item}平均分给{k}个小朋友，每人分到几{unit}？\n"
                          f"解：{total} ÷ {k} = {each}（{unit}）。\n"
                          f"答：每人分到{each}{unit}{item}。")
    # 行程
    v, t = rng.randint(4, 15) * 5, rng.randint(2, 6)
    return "四年级", (f"题目：一辆汽车每小时行驶{v}千米，行驶{t}小时，一共行驶了多少千米？\n"
                      f"解：路程 = 速度 × 时间 = {v} × {t} = {v * t}（千米）。\n"
                      f"答：一共行驶了{v * t}千米。")


GENS = [(2, g1_add_sub), (2, g2_mul_div), (2, g3_multi_digit), (2, g4_mixed),
        (2, g5_decimal_fraction), (1, g6_percent), (3, word_problem)]


def main():
    args = make_argparser("Stage1 小学数学数据生成").parse_args()
    rng = random.Random(args.seed)
    w = JsonlWriter(args.outdir, "stage1_math.jsonl", max_unique=args.max_unique)
    fns, weights = [g for _, g in GENS], [wt for wt, _ in GENS]
    for _ in range(args.num):
        grade, text = rng.choices(fns, weights=weights)[0](rng)
        r = w.write("s1-math", 1, "math", f"小学{grade}", text)
        if r == "STOP":
            break
    w.close()


if __name__ == "__main__":
    main()
