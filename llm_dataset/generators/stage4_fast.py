# -*- coding: utf-8 -*-
"""Stage4 大学数学（快速路径，纯标准库）：线性代数 / 概率统计 / 解析几何 /
离散数学等题目，全部用纯 Python 数值计算（不依赖 numpy），微秒级，
unique 上限极高，与 sympy 路径(stage4_calculus)并存，mix 阶段合并。

用法: python generators/stage4_fast.py -n 200000 -o C:/laldata/data/stage4
"""
import math
import random

from common import make_argparser, JsonlWriter


# ---------- 纯 Python 矩阵/向量工具 ----------
def mat_add(A, B):
    return [[A[i][j] + B[i][j] for j in range(len(A[0]))] for i in range(len(A))]


def mat_mul(A, B):
    n, k, m = len(A), len(A[0]), len(B[0])
    return [[sum(A[i][t] * B[t][j] for t in range(k)) for j in range(m)]
            for i in range(n)]


def mat_det(M):
    n = len(M)
    if n == 1:
        return M[0][0]
    if n == 2:
        return M[0][0] * M[1][1] - M[0][1] * M[1][0]
    det = 0
    for c in range(n):
        minor = [[M[i][j] for j in range(n) if j != c] for i in range(1, n)]
        det += ((-1) ** c) * M[0][c] * mat_det(minor)
    return det


def mat_inv(M):
    n = len(M)
    # 增广 [M | I]，高斯消元
    A = [row[:] + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(M)]
    for i in range(n):
        # 主元
        p = i
        while p < n and abs(A[p][i]) < 1e-9:
            p += 1
        if p == n:
            raise ValueError("singular")
        A[i], A[p] = A[p], A[i]
        piv = A[i][i]
        A[i] = [x / piv for x in A[i]]
        for r in range(n):
            if r != i:
                f = A[r][i]
                A[r] = [A[r][k] - f * A[i][k] for k in range(2 * n)]
    return [[round(A[i][j + n], 3) for j in range(n)] for i in range(n)]


def mat_eig2(M):
    a, b, c, d = M[0][0], M[0][1], M[1][0], M[1][1]
    tr, det = a + d, a * d - b * c
    disc = tr * tr - 4 * det
    if disc < 0:
        return [round(tr / 2, 3), round(tr / 2, 3)]
    s = disc ** 0.5
    return sorted([round((tr + s) / 2, 3), round((tr - s) / 2, 3)])


def rint(rng, lo, hi, size):
    if isinstance(size, int):
        return [rng.randint(lo, hi) for _ in range(size)]
    return [[rng.randint(lo, hi) for _ in range(size[1])] for _ in range(size[0])]


# ---------- 题型 ----------
def gen_matrix_add(rng):
    n, m = rng.randint(2, 4), rng.randint(2, 4)
    A = rint(rng, -9, 9, (n, m)); B = rint(rng, -9, 9, (n, m))
    C = mat_add(A, B)
    return (f"题目：已知矩阵 A = {A}，B = {B}，求 A + B。\n"
            f"解：对应元素相加。\n答：A + B = {C}。")


def gen_matrix_mul(rng):
    n, k, m = rng.randint(2, 3), rng.randint(2, 3), rng.randint(2, 3)
    A = rint(rng, -9, 9, (n, k)); B = rint(rng, -9, 9, (k, m))
    C = mat_mul(A, B)
    return (f"题目：计算矩阵乘积 AB，其中 A = {A}，B = {B}。\n"
            f"解：按矩阵乘法 (AB)ij = Σ_k Aik·Bkj。\n答：AB = {C}。")


def gen_determinant(rng):
    A = rint(rng, -6, 6, (3, 3))
    det = round(mat_det(A), 4)
    return (f"题目：求三阶矩阵 A = {A} 的行列式 |A|。\n"
            f"解：按行列式展开或初等变换计算。\n答：|A| = {det}。")


def gen_inverse(rng):
    while True:
        A = rint(rng, -4, 4, (3, 3))
        if abs(mat_det(A)) > 1e-6:
            break
    inv = mat_inv(A)
    return (f"题目：求矩阵 A = {A} 的逆矩阵 A⁻¹。\n"
            f"解：用初等行变换（增广矩阵 [A|I] 化为 [I|A⁻¹]）。\n答：A⁻¹ = {inv}。")


def gen_eigen(rng):
    M = rint(rng, -5, 5, (2, 2))
    vals = mat_eig2(M)
    return (f"题目：求矩阵 A = {M} 的特征值。\n"
            f"解：解特征方程 |A - λI| = 0。\n答：特征值 λ = {vals}。")


def gen_vec_dot(rng):
    n = rng.randint(3, 5)
    u = rint(rng, -9, 9, n); v = rint(rng, -9, 9, n)
    dot = sum(a * b for a, b in zip(u, v))
    norm_u = round(sum(a * a for a in u) ** 0.5, 3)
    return (f"题目：已知向量 u = {u}，v = {v}，求内积 u·v 与 |u|。\n"
            f"解：u·v = Σ ui·vi，|u| = √(Σ ui²)。\n答：u·v = {dot}，|u| = {norm_u}。")


def gen_combination(rng):
    n = rng.randint(5, 12); k = rng.randint(2, min(5, n - 1))
    c = math.comb(n, k)
    return (f"题目：从 {n} 个不同元素中任取 {k} 个，有多少种取法（组合数 C({n},{k})）？\n"
            f"解：C(n,k) = n! / (k!(n-k)!)。\n答：C({n},{k}) = {c}。")


def gen_permutation(rng):
    n = rng.randint(4, 8); k = rng.randint(2, n - 1)
    p = 1
    for i in range(k):
        p *= (n - i)
    return (f"题目：从 {n} 个不同元素中取 {k} 个排列，有多少种（排列数 A({n},{k})）？\n"
            f"解：A(n,k) = n! / (n-k)!。\n答：A({n},{k}) = {p}。")


def gen_binomial(rng):
    n = rng.randint(4, 10); k = rng.randint(1, n - 1)
    p = round(rng.uniform(0.2, 0.8), 2)
    prob = math.comb(n, k) * (p ** k) * ((1 - p) ** (n - k))
    prob = round(prob, 4)
    return (f"题目：设随机变量 X ~ B(n={n}, p={p})（二项分布），求 P(X={k})。\n"
            f"解：P(X=k) = C({n},{k})·p^{k}·(1-p)^({n}-{k})。\n答：P(X={k}) = {prob}。")


def gen_expectation(rng):
    n = rng.randint(3, 5)
    vals = [rng.randint(1, 10) for _ in range(n)]
    probs = [round(rng.uniform(0.1, 0.5), 2) for _ in range(n)]
    s = sum(probs); probs = [round(p / s, 3) for p in probs]
    E = round(sum(v * p for v, p in zip(vals, probs)), 4)
    var = round(sum(p * (v - E) ** 2 for v, p in zip(vals, probs)), 4)
    return (f"题目：离散随机变量 X 的分布为 取值{vals} 对应概率{probs}，求期望 E(X) 与方差 D(X)。\n"
            f"解：E(X)=Σ x_i·p_i，D(X)=Σ (x_i-E)²·p_i。\n答：E(X) = {E}，D(X) = {var}。")


def gen_line_plane(rng):
    a, b, c = [rng.randint(-6, 6) for _ in range(3)]
    while a == 0 and b == 0 and c == 0:
        a, b, c = [rng.randint(-6, 6) for _ in range(3)]
    d = rng.randint(-10, 10)
    norm = (a * a + b * b + c * c) ** 0.5
    dist = round(abs(d) / norm, 3)
    return (f"题目：已知平面方程为 {a}x + {b}y + {c}z + ({d}) = 0，求原点到该平面的距离。\n"
            f"解：点到平面距离 = |Ax0+By0+Cz0+D| / √(A²+B²+C²)。\n答：距离 = {dist}。")


def gen_line_intersect(rng):
    x1, y1 = rng.randint(-5, 5), rng.randint(-5, 5)
    a1, b1 = rng.randint(-4, 4), rng.randint(-4, 4)
    a2, b2 = rng.randint(-4, 4), rng.randint(-4, 4)
    c1 = a1 * x1 + b1 * y1
    # 随机选第二个交点保证不平行
    x2, y2 = rng.randint(-5, 5), rng.randint(-5, 5)
    c2 = a2 * x2 + b2 * y2
    det = a1 * b2 - a2 * b1
    if det == 0:
        return gen_line_intersect(rng)
    xi = (c1 * b2 - c2 * b1) / det; yi = (a1 * c2 - a2 * c1) / det
    return (f"题目：求两直线 {a1}x + {b1}y = {c1} 与 {a2}x + {b2}y = {c2} 的交点。\n"
            f"解：联立方程组求解。\n答：交点 = ({round(xi,3)}, {round(yi,3)})。")


def gen_logic(rng):
    props = ["p", "q", "r"]
    f1 = rng.choice([f"{a} ∧ {b}" for a in props for b in props if a != b] +
                    [f"¬{a}" for a in props] + [f"{a} → {b}" for a in props for b in props if a != b])
    f2 = rng.choice([f"{a} ∨ {b}" for a in props for b in props if a != b] +
                    [f"{a} ↔ {b}" for a in props for b in props if a != b])
    return (f"题目：对命题公式 {f1} 和 {f2}，判断二者是否逻辑等价。\n"
            f"解：列出真值表（共 8 行）比较各解释下真值。\n"
            f"答：等价当且仅当所有赋值下真值相同（需逐行核对）。")


def gen_set_op(rng):
    U = list(range(1, rng.randint(6, 10) + 1))
    A = sorted(rng.sample(U, rng.randint(2, 4)))
    B = sorted(rng.sample(U, rng.randint(2, 4)))
    inter = sorted(set(A) & set(B)); uni = sorted(set(A) | set(B))
    return (f"题目：全集 U = {U}，A = {A}，B = {B}，求 A∩B 与 A∪B。\n"
            f"解：交集取公共元素，并集取所有元素。\n答：A∩B = {inter}，A∪B = {uni}。")


GENS = [
    (3, gen_matrix_add), (3, gen_matrix_mul), (2, gen_determinant),
    (2, gen_inverse), (2, gen_eigen), (2, gen_vec_dot),
    (2, gen_combination), (2, gen_permutation), (2, gen_binomial),
    (2, gen_expectation), (2, gen_line_plane), (2, gen_line_intersect),
    (1, gen_logic), (1, gen_set_op),
]


def main():
    import sys
    sys.path.insert(0, "generators")
    args = make_argparser("Stage4 大学数学（快速纯 Python 路径）").parse_args()
    rng = random.Random(args.seed)
    w = JsonlWriter(args.outdir, "stage4_fast.jsonl", max_unique=args.max_unique)
    fns, weights = [g for _, g in GENS], [wt for wt, _ in GENS]
    for i in range(args.num):
        if i % 2000 == 0:
            print(f"[progress] {i}/{args.num} unique={w.unique}", flush=True)
        try:
            text = rng.choices(fns, weights=weights)[0](rng)
        except Exception:
            continue
        r = w.write("s4-fast", 4, "advanced_math", "大学", text)
        if r == "STOP":
            break
    w.close()


if __name__ == "__main__":
    main()
