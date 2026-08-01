# -*- coding: utf-8 -*-
"""Stage 0 语言启蒙：拼音标注、常用字、量词搭配、简单句型、重复式短句。

依赖 pypinyin 自动标注拼音，无需手工字典。
用法: python stage0_basics.py -n 50000 -o data/stage0
"""
import random

from pypinyin import pinyin, Style

from common import make_argparser, JsonlWriter

# 常用字词库（可自行扩充；也可替换为 3500 常用字表文件）
# 为突破模板组合天花板，NOUNS/VERBS/ADJS 扩充为较大常用词集合。
NOUNS = ["山", "水", "花", "草", "树", "鸟", "鱼", "云", "月亮", "太阳", "星星",
         "书", "笔", "桌子", "椅子", "房子", "汽车", "苹果", "米饭", "妈妈", "爸爸",
         "老师", "同学", "小狗", "小猫", "学校", "公园", "天空", "大海", "雨", "雪",
         "风", "火", "石", "田", "河", "桥", "门", "窗", "灯", "钟", "衣", "鞋",
         "马", "牛", "羊", "鸡", "鸭", "鹅", "兔", "熊", "虎", "狮", "龙", "蛇",
         "叶", "果", "瓜", "菜", "米", "面", "糖", "盐", "茶", "酒", "肉", "蛋",
         "城", "村", "路", "街", "店", "厂", "船", "机", "车", "票", "旗", "鼓",
         "心", "手", "眼", "耳", "口", "头", "脚", "脸", "发", "牙"]
VERBS = ["看", "读", "写", "画", "吃", "喝", "跑", "跳", "唱", "听", "说", "玩", "爱", "喜欢",
         "找", "拿", "放", "开", "关", "走", "坐", "站", "飞", "游", "爬", "哭", "笑",
         "想", "学", "问", "答", "帮", "送", "买", "卖", "种", "养", "洗", "扫", "做", "织"]
ADJS = ["大", "小", "红", "绿", "高", "矮", "美丽", "可爱", "明亮", "安静", "快乐", "温暖",
        "长", "短", "方", "圆", "甜", "酸", "香", "凉", "热", "新", "旧", "快", "慢",
        "白", "黑", "黄", "蓝", "轻", "重", "真", "假", "好", "坏", "多", "少", "远", "近"]
MEASURES = [("只", ["鸟", "鱼", "小狗", "小猫", "鸡", "鸭", "鹅", "兔", "羊", "牛", "马"]),
            ("本", ["书"]), ("朵", ["花", "云"]), ("棵", ["树", "草", "菜"]),
            ("座", ["山", "房子", "学校", "公园", "桥", "城"]), ("辆", ["汽车", "车"]),
            ("个", ["苹果", "同学", "太阳", "月亮", "蛋", "果", "瓜"]), ("支", ["笔"]),
            ("张", ["桌子", "脸", "纸", "嘴", "床"]), ("把", ["椅子", "刀", "伞", "锁"]),
            ("条", ["河", "路", "鱼", "狗", "蛇", "龙", "毛巾"]), ("双", ["鞋", "手", "眼"]),
            ("头", ["牛", "羊", "猪", "大象"]), ("顶", ["帽子"]), ("件", ["衣", "事"]),
            ("片", ["叶", "云", "雪", "田"]), ("杯", ["茶", "水", "酒"]), ("碗", ["米", "饭"])]
SUBJECTS = ["我", "你", "他", "她", "我们", "你们", "他们", "小明", "小红", "妈妈", "老师",
            "爸爸", "爷爷", "奶奶", "哥哥", "姐姐", "弟弟", "妹妹", "小猫", "小狗", "同学"]
NUM_CN = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]


def py(word):
    return " ".join(s[0] for s in pinyin(word, style=Style.TONE))


def gen_hanzi_card(rng):
    w = rng.choice(NOUNS + VERBS + ADJS)
    return f"生字：{w}。拼音：{py(w)}。"


def gen_measure(rng):
    m, nouns = rng.choice(MEASURES)
    n = rng.choice(nouns)
    num = rng.choice(NUM_CN[:5])
    return f"量词练习：{num}{m}{n}。拼音：{py(num + m + n)}。"


def gen_simple_sentence(rng):
    s, v, n = rng.choice(SUBJECTS), rng.choice(VERBS), rng.choice(NOUNS)
    sent = f"{s}{v}{n}。"
    return f"句子：{sent}拼音：{py(sent[:-1])}。"


def gen_adj_sentence(rng):
    n, a = rng.choice(NOUNS), rng.choice(ADJS)
    return f"句子：{n}很{a}。{n}真{a}呀！"


def gen_count(rng):
    start = rng.randint(0, 5)
    seq = "、".join(NUM_CN[start:start + 5])
    return f"数数：{seq}。"


def gen_repeat_rhyme(rng):
    n, a = rng.choice(NOUNS), rng.choice(ADJS)
    v = rng.choice(VERBS)
    return f"{a}{n}，{a}{n}，我{v}{a}{n}。"


GENS = [(3, gen_hanzi_card), (2, gen_measure), (3, gen_simple_sentence),
        (2, gen_adj_sentence), (1, gen_count), (1, gen_repeat_rhyme)]


def main():
    args = make_argparser("Stage0 语言启蒙数据生成").parse_args()
    rng = random.Random(args.seed)
    w = JsonlWriter(args.outdir, "stage0_basics.jsonl", max_unique=args.max_unique)
    fns, weights = [g for _, g in GENS], [wt for wt, _ in GENS]
    for _ in range(args.num):
        fn = rng.choices(fns, weights=weights)[0]
        r = w.write("s0-lang", 0, "chinese_basics", "学前/一年级", fn(rng))
        if r == "STOP":
            break
    w.close()


if __name__ == "__main__":
    main()
