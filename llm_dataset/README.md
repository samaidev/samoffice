# 中文课程式预训练数据集（面向 ~100M 参数 LLM）

按人类认知发展顺序组织数据（curriculum learning）：先学语言基础，再逐级学习学科知识。
训练时按 stage 顺序喂数据（或按阶段调整混合比例），小模型收敛更快、基础能力更扎实。

## 一、阶段设计与 Token 预算

100M 模型按 Chinchilla 比例约需 **2B tokens**，实际建议 **2~5B**（可多 epoch）。
中文约 1.6 字符/token，2B tokens ≈ 3.2B 字符。

> **当前状态（仅合成数据，221,559 条 ≈ 10.6M tokens）距离 2B 还差 ~190 倍。**
> 纯合成路线受模板组合天花板限制（各生成器唯一上限见下表），**必须引入真实开源语料**
> 才能跨越两个数量级。补足方案见第五节。

### 各阶段容量与补足目标

`mix` 输出条数由 `min(各阶段条数 / ratio)` 决定（scale）。要让最终训练集达到 2B tokens，
需使每个阶段的「条数 / ratio」都 ≥ 目标 scale（约 16M）。下表给出**目标条数**（含真实语料）：

| Stage | 占比 | 合成唯一上限 | 目标条数(含真实语料) | 主要补足语料来源 |
|-------|------|------------|---------------------|------------------|
| 0 | 3%  | 74,704   | ≥ 480K  | 分级读物/儿歌/拼音童谣（sources.md） |
| 1 | 12% | 83,594   | ≥ 1.9M  | 小学教材/教辅 OCR、应用题库 |
| 2 | 20% | 69,017   | ≥ 3.2M  | 初中教材、学科百科 |
| 3 | 25% | 55,390   | ≥ 4.0M  | 高中教材、高考题、学科百科 |
| 4 | 10% | 145,110  | ≥ 1.6M  | 大学教材、习题解析 |
| G | 30% | 69,990   | ≥ 4.8M  | SkyPile-150B / CCI3-HQ / 中文维基 |

达到上述目标后，scale ≈ 16M，混合平均 200 字符/条约产出 **3.2B 字符 ≈ 2B tokens**。

## 二、目录结构

```
llm_dataset/
├── config/curriculum.yaml   # 阶段、比例、路径配置
├── generators/              # 合成数据生成器（可无限量生成带解题过程的数据）
│   ├── common.py
│   ├── stage0_basics.py     # 拼音/汉字/简单句
│   ├── stage1_math.py       # 小学数学（含应用题、解题步骤）
│   ├── stage1_chinese.py    # 小学语文（组词/造句/短文模板）
│   ├── stage2_science.py    # 初中数理化（方程、物理公式、化学计算）
│   └── stage4_calculus.py   # 大学高数（sympy 生成求导/积分/极限）
├── scripts/
│   ├── sources.md           # 各阶段推荐开源语料下载清单
│   ├── clean.py             # 清洗、规范化、去重
│   └── mix.py               # 按 curriculum.yaml 比例混合并按阶段排序输出
├── raw/                     # 下载的原始开源语料放这里（按 stage 分子目录）
└── data/                    # 生成/清洗后的 JSONL
```

## 三、数据格式（JSONL，每行一条）

```json
{"id": "s1-math-000001", "stage": 1, "subject": "math", "grade": "小学三年级", "type": "synthetic", "text": "题目：…\n解：…\n答：…"}
```

预训练时只取 `text` 字段拼接；其余字段用于配比与追溯。

## 四、使用步骤

```bash
pip install -r requirements.txt

# 1. 生成合成数据（每个生成器都支持 -n 指定条数，已到唯一上限后自动停止）
python generators/stage0_basics.py   -n 100000 -o data/stage0
python generators/stage1_math.py     -n 300000 -o data/stage1
python generators/stage1_chinese.py  -n 100000 -o data/stage1
python generators/stage2_science.py  -n 300000 -o data/stage2
python generators/stage3_senior.py   -n 200000 -o data/stage3
python generators/general_corpus.py  -n 200000 -o data/general
python generators/stage4_fast.py     -n 300000 -o data/stage4

# 2. 接入真实开源语料（补足 2B tokens 的关键，详见第五节）
#    方式 A（推荐）：用 batch_download.py 从 hf-mirror 下载 SkyPile-150B
#    此脚本处理 Xet 存储、自动解压、清洗去重，可断点续传
python C:/laldata/scripts/batch_download.py --files 50 --target general --max-docs 8000000

#    方式 B：联网直接拉取其他 HuggingFace 数据集（部分需申请访问）
python scripts/ingest_corpus.py --repo BAAI/CCI3-HQ --split train \
    --text-field text --target general --max-docs 6000000 --min-len 80 --max-len 4000
python scripts/ingest_corpus.py --repo wikimedia/wikipedia --config zh --split train \
    --text-field text --target general --max-docs 3000000

#    方式 C：本地已有语料（.txt/.jsonl/.json）离线清洗并入
python scripts/ingest_corpus.py --local-dir /path/to/raw/stage3 --target stage3 --max-docs 4000000
python scripts/ingest_corpus.py --local-dir /path/to/raw/general --target general --max-docs 5000000

# 3. 按课程比例混合，输出最终训练集（按 stage 升序 = 课程学习顺序）
python scripts/mix.py -c config/laldata.yaml -o C:/laldata/train.jsonl

# 4. 验证规模与质量
python scripts/full_verify.py C:/laldata/train.jsonl
```

> 数据实际落地目录为 `C:\laldata\data`，混合配置为 `config/laldata.yaml`
> （与仓库内 `data/` 不同；保持一份权威副本在 `C:\laldata` 避免被 .gitignore 误删）。

## 五、补足到 100M 模型所需规模（关键）

纯合成数据上限约 **221K 条 / 10.6M tokens**，对 100M 模型（需 2B tokens）**不足 0.5%**。
必须引入真实语料。最佳路径（已验证可访问）：

1. **SkyPile-150B**（Skywork/SkyPile-150B）：**非 gated，可从 hf-mirror.com 直接下载**。
   437 个 JSONL shard，约 150B tokens 原始数据。首选通用语料（general）。
2. **CCI3-HQ**（BAAI/CCI3-HQ）：高质量中文网页，但 gated（需申请访问）。
3. **中文维基**（wikimedia/wikipedia config=zh）：非 gated，学科词条供给 stage3。
4. **开源教材/教辅 OCR**：分级读物（stage0）、中小学教材（stage1/2/3）。

**推荐下载命令**（在联网机器 cmd 中运行）：
```bash
# 安装依赖
pip install huggingface_hub pyarrow httpx

# 下载 SkyPile 50 个 shard 到 data/general（约 5GB/天）
cd C:\laldata\scripts
python batch_download.py --files 30 --target general --max-docs 6000000

# 混入训练集
cd C:\Users\Administrator\samoffice\llm_dataset
python scripts/mix.py -c config/laldata.yaml -o C:/laldata/train.jsonl
```
batch_download.py 支持断点续传、逐 shard 下载→处理→删除缓存（内存高效）。
下载 30 个 shard（约 1800 万行 → 清洗后约 500 万条 → ～1B tokens）即可将 mix 规模推到所需量级。

**规模验证**（混完后跑）：
```bash
python -c "import json;n=0;c=0
for l in open('C:/laldata/train.jsonl',encoding='utf-8'):
    t=json.loads(l)['text'];n+=1;c+=len(t)
print('条数',n,'字符',c,'估算tokens',c//1.6)"
```
达到 `tokens ≥ 2_000_000_000` 即满足 100M 单 epoch 训练需求。

## 六、要点建议

- **合成数据带完整解题步骤**：小模型极度依赖显式推理链，生成器均输出「题目/解/答」三段式。
- **初高中文科（政治/地理/生物）难以程序合成**：以开源教材、百科词条、考试题库为主，见 `scripts/sources.md`。
- **通用语料全程混入**：纯教材数据语言分布太窄，会损害流畅性；保持 ~30% 百科/书籍类语料。
- **真实语料是规模主来源**：合成数据负责"题型与推理链"，真实语料负责"覆盖广度与流畅度"。
- **去重很关键**：模板生成的数据要控制模板多样性并做精确去重（ingest_corpus.py 与 mix.py 双重去重）。
- **分词器**：建议在混合后的数据上训练 BPE（如 sentencepiece，vocab 32k），中文覆盖优先。
- **许可证与隔离**：引入开源语料时注意许可证，并剔除与下游评测集（如 C-Eval / CMMLU）重叠样本。
