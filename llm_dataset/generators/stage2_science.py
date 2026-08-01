# -*- coding: utf-8 -*-
"""Stage 2 初中数理化：一元一次/二次方程（带步骤）、物理公式计算、化学相对分子质量。

用法: python stage2_science.py -n 200000 -o data/stage2
"""
import math
import random

from common import make_argparser, JsonlWriter


# ---------- 数学 ----------
def linear_eq(rng):
    """ax + b = c，保证整数解"""
    a = rng.randint(2, 19)
    x = rng.randint(-20, 20)
    b = rng.randint(-50, 50)
    c = a * x + b
    bs = f"+ {b}" if b >= 0 else f"- {-b}"
    return "math", (f"题目：解方程 {a}x {bs} = {c}。\n"
                    f"解：移项得 {a}x = {c} - ({b}) = {c - b}；\n"
                    f"两边同除以{a}，得 x = {c - b} ÷ {a} = {x}。\n"
                    f"答：x = {x}。")


def quadratic_eq(rng):
    """(x-p)(x-q)=0 展开，保证整数根"""
    p, q = rng.randint(-12, 12), rng.randint(-12, 12)
    b, c = -(p + q), p * q
    bs = f"+ {b}x " if b > 0 else (f"- {-b}x " if b < 0 else "")
    cs = f"+ {c}" if c >= 0 else f"- {-c}"
    delta = b * b - 4 * c
    return "math", (f"题目：解一元二次方程 x² {bs}{cs} = 0。\n"
                    f"解：判别式 Δ = b² - 4ac = {b}² - 4×1×({c}) = {delta}；\n"
                    f"因式分解得 (x - {p})(x - {q}) = 0；\n"
                    f"所以 x₁ = {p}，x₂ = {q}。\n"
                    f"答：x₁ = {p}，x₂ = {q}。")


def pythagorean(rng):
    triples = [(3, 4, 5), (6, 8, 10), (5, 12, 13), (9, 12, 15), (8, 15, 17),
               (12, 16, 20), (15, 20, 25), (7, 24, 25), (10, 24, 26), (20, 21, 29),
               (18, 24, 30), (9, 40, 41), (12, 35, 37), (11, 60, 61), (28, 45, 53)]
    a, b, c = rng.choice(triples)
    return "math", (f"题目：直角三角形两直角边分别为{a}和{b}，求斜边长。\n"
                    f"解：由勾股定理，c² = a² + b² = {a}² + {b}² = {a*a} + {b*b} = {a*a+b*b}；\n"
                    f"所以 c = √{a*a+b*b} = {c}。\n"
                    f"答：斜边长为{c}。")


# ---------- 物理 ----------
def physics_speed(rng):
    v = rng.choice([20, 30, 40, 45, 50, 60, 70, 80, 90, 100])
    t = rng.randint(1, 12)
    obj = rng.choice(["汽车", "火车", "自行车", "轮船", "飞机"])
    return "physics", (f"题目：一辆{obj}以{v} km/h的速度匀速行驶{t}小时，通过的路程是多少？\n"
                       f"解：由公式 s = vt，s = {v} km/h × {t} h = {v*t} km。\n"
                       f"答：通过的路程是{v*t}千米。")


def physics_density(rng):
    rho = rng.choice([(0.8, "酒精"), (1.0, "水"), (2.7, "铝"), (7.9, "铁"),
                      (8.9, "铜"), (11.3, "铅"), (13.6, "汞"), (0.9, "煤油")])
    v = rng.choice([20, 30, 40, 50, 60, 80, 100, 120, 150, 200])
    m = round(rho[0] * v, 1)
    return "physics", (f"题目：体积为{v} cm³的{rho[1]}块，质量是多少？（{rho[1]}的密度为{rho[0]} g/cm³）\n"
                       f"解：由 ρ = m/V 得 m = ρV = {rho[0]} g/cm³ × {v} cm³ = {m} g。\n"
                       f"答：质量是{m}克。")


def physics_ohm(rng):
    i = rng.choice([0.2, 0.3, 0.5, 1, 1.5, 2, 2.5, 3, 4])
    r = rng.choice([5, 10, 15, 20, 30, 40, 50, 60, 80, 100])
    u = round(i * r, 1)
    return "physics", (f"题目：电阻为{r} Ω的导体，通过的电流为{i} A，求它两端的电压。\n"
                       f"解：由欧姆定律 I = U/R，得 U = IR = {i} A × {r} Ω = {u} V。\n"
                       f"答：电压为{u}伏特。")


def physics_force(rng):
    m = rng.choice([2, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50])
    g = 10
    return "physics", (f"题目：质量为{m} kg的物体，受到的重力是多少？（g取{g} N/kg）\n"
                       f"解：G = mg = {m} kg × {g} N/kg = {m*g} N。\n"
                       f"答：重力为{m*g}牛顿。")


# ---------- 化学 ----------
ATOMS = {"H": 1, "C": 12, "N": 14, "O": 16, "Na": 23, "Mg": 24, "Al": 27,
         "S": 32, "Cl": 35.5, "K": 39, "Ca": 40, "Fe": 56, "Cu": 64, "Zn": 65, "Ba": 137}
MOLECULES = [
    ("H2O", "水", [("H", 2), ("O", 1)]),
    ("CO2", "二氧化碳", [("C", 1), ("O", 2)]),
    ("NaCl", "氯化钠", [("Na", 1), ("Cl", 1)]),
    ("CaCO3", "碳酸钙", [("Ca", 1), ("C", 1), ("O", 3)]),
    ("H2SO4", "硫酸", [("H", 2), ("S", 1), ("O", 4)]),
    ("NaOH", "氢氧化钠", [("Na", 1), ("O", 1), ("H", 1)]),
    ("Fe2O3", "氧化铁", [("Fe", 2), ("O", 3)]),
    ("CH4", "甲烷", [("C", 1), ("H", 4)]),
    ("HCl", "氯化氢", [("H", 1), ("Cl", 1)]),
    ("MgO", "氧化镁", [("Mg", 1), ("O", 1)]),
    ("Al2O3", "氧化铝", [("Al", 2), ("O", 3)]),
    ("CuSO4", "硫酸铜", [("Cu", 1), ("S", 1), ("O", 4)]),
    ("KNO3", "硝酸钾", [("K", 1), ("N", 1), ("O", 3)]),
    ("NH3", "氨气", [("N", 1), ("H", 3)]),
    ("BaCl2", "氯化钡", [("Ba", 1), ("Cl", 2)]),
    ("ZnO", "氧化锌", [("Zn", 1), ("O", 1)]),
]


def chem_molar_mass(rng):
    formula, name, comp = rng.choice(MOLECULES)
    parts = " + ".join(f"{ATOMS[el]}×{n}" for el, n in comp)
    total = sum(ATOMS[el] * n for el, n in comp)
    total = int(total) if total == int(total) else total
    return "chemistry", (f"题目：计算{name}（{formula}）的相对分子质量。\n"
                         f"解：{formula} 的相对分子质量 = {parts} = {total}。\n"
                         f"答：{name}的相对分子质量为{total}。")


EQUATIONS = [
    ("2H2 + O2 =点燃= 2H2O", "氢气在氧气中燃烧生成水"),
    ("C + O2 =点燃= CO2", "碳在氧气中充分燃烧生成二氧化碳"),
    ("CaCO3 =高温= CaO + CO2↑", "碳酸钙高温分解生成氧化钙和二氧化碳"),
    ("Fe + CuSO4 = FeSO4 + Cu", "铁与硫酸铜溶液反应置换出铜"),
    ("NaOH + HCl = NaCl + H2O", "氢氧化钠与盐酸发生中和反应"),
    ("2KMnO4 =加热= K2MnO4 + MnO2 + O2↑", "高锰酸钾加热分解制取氧气"),
    ("Zn + H2SO4 = ZnSO4 + H2↑", "锌与稀硫酸反应放出氢气"),
    ("CO2 + Ca(OH)2 = CaCO3↓ + H2O", "二氧化碳使澄清石灰水变浑浊"),
    ("2H2O2 =MnO2= 2H2O + O2↑", "过氧化氢在二氧化锰催化下分解制氧"),
    ("C + 2CuO =高温= 2Cu + CO2↑", "碳还原氧化铜得到铜"),
]


def chem_equation(rng):
    eq, desc = rng.choice(EQUATIONS)
    return "chemistry", f"化学方程式：{eq}\n说明：{desc}。"


GENS = [(3, linear_eq), (3, quadratic_eq), (1, pythagorean),
        (2, physics_speed), (2, physics_density), (2, physics_ohm), (1, physics_force),
        (2, chem_molar_mass), (1, chem_equation)]


def main():
    args = make_argparser("Stage2 初中数理化数据生成").parse_args()
    rng = random.Random(args.seed)
    w = JsonlWriter(args.outdir, "stage2_science.jsonl", max_unique=args.max_unique)
    fns, weights = [g for _, g in GENS], [wt for wt, _ in GENS]
    for _ in range(args.num):
        subject, text = rng.choices(fns, weights=weights)[0](rng)
        r = w.write("s2-sci", 2, subject, "初中", text)
        if r == "STOP":
            break
    w.close()


if __name__ == "__main__":
    main()
