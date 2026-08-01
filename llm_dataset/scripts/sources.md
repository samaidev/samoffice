# 各阶段推荐开源语料清单

合成生成器覆盖不了的学科（文科、阅读理解、成体系教材），从以下开源数据获取。
推荐用 `scripts/ingest_corpus.py` 一键下载+清洗+路由（详见 README 第四节）：

```bash
# 通用语料（general，30%）—— 规模主来源
python scripts/ingest_corpus.py --repo BAAI/CCI3-HQ --split train --text-field text --target general --max-docs 6000000
python scripts/ingest_corpus.py --repo Skywork/SkyPile-150B --split train --text-field text --target general --max-docs 8000000
python scripts/ingest_corpus.py --repo wikimedia/wikipedia --config zh --split train --text-field text --target general --max-docs 3000000

# 高中学科（stage3，25%）
python scripts/ingest_corpus.py --repo BAAI/COIG --split train --text-field text --target stage3 --max-docs 4000000

# 本地已有语料离线清洗
python scripts/ingest_corpus.py --local-dir /path/to/raw/stage3 --target stage3 --max-docs 4000000
```

下载后数据落在 `C:\laldata\data\<stage>\corpus_*.jsonl`，`mix.py` 自动合并并按 ratio 截断。

## 语言基础 / 小学（stage 0-1）

| 数据集 | 内容 | 获取方式 |
|--------|------|---------|
| chinese-poetry | 唐诗宋词（古诗启蒙） | github.com/chinese-poetry/chinese-poetry |
| Chinese-Idioms / THUOCL | 成语、词表 | GitHub 搜索 chinese-xinhua（含字典、词语、成语、歇后语 JSON） |
| Math23K | 2.3 万道小学数学应用题（带方程） | 论文公开数据，HuggingFace: Gxg/Math23K |
| APE210K | 21 万道小学数学应用题 | github.com/Chenny0808/ape210k |
| CMATH | 小学各年级数学题（分年级标注） | HuggingFace: weitianwen/cmath |

## 初中 / 高中（stage 2-3）

| 数据集 | 内容 | 获取方式 |
|--------|------|---------|
| COIG (exam 子集) | 中高考、各科考试题 | HuggingFace: BAAI/COIG |
| Exam/GaoKao 题库 | 高考真题（各科） | github.com/OpenLMLab/GAOKAO-Bench（注意仅训练用其文本，别污染评测） |
| BELLE school_math | 25 万道中文数学题（带步骤） | HuggingFace: BelleGroup/school_math_0.25M |
| 中文维基百科（学科词条） | 物理/化学/生物/地理/历史词条 | dumps.wikimedia.org/zhwiki，用 wikiextractor 抽取 |
| 百度百科开源抓取集 | 学科词条（MNBVC 内含） | github.com/esbatmop/MNBVC |

## 大学（stage 4）

| 数据集 | 内容 | 获取方式 |
|--------|------|---------|
| 中文维基（数学/物理条目） | 高数、大学物理概念 | 同上，按类别过滤 |
| MathGLM / MathPile 中文部分 | 数学语料 | HuggingFace: GAIR/MathPile |
| 开源教材/讲义 | OpenStax 中译、各校开放课程讲义 | 注意逐项确认许可证 |

## 通用语料（general，全程混入 ~30%）

| 数据集 | 内容 | 获取方式 |
|--------|------|---------|
| WanJuan 1.0（万卷） | 高质量中文网页/书籍/专利 | opendatalab.com |
| SkyPile-150B | 高质量中文网页 | HuggingFace: Skywork/SkyPile-150B |
| CCI 3.0 | BAAI 高质量中文互联网语料 | HuggingFace: BAAI/CCI3-HQ |
| MNBVC | 超大规模中文杂类语料 | github.com/esbatmop/MNBVC |
| 中文维基百科全量 | 百科 | dumps.wikimedia.org/zhwiki |

## 注意事项

1. **许可证**：训练前逐项确认许可证（尤其教材类）；教科书原文多有版权，优先使用百科、公开题库、开源整理集。
2. **评测集隔离**：C-Eval、CMMLU、GAOKAO-Bench 若用于评测，绝不能混入训练集；用 n-gram 去重做污染检测。
3. **配比**：下载量远大于所需时，clean 后随机采样即可，mix.py 会按 ratio 截断。
