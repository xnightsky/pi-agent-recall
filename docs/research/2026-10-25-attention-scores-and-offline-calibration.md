---
type: research
date: 2026-10-25
status: 一手核验完成，未作本地标定
---
# 业界注意力评测：证据、版本化更新与离线策略候选

> 核验日期：2026-10-25。recall-reviewer 只读核查原始论文、作者代码/数据、官方方法与公开元数据，经 intercom 交付证据；recall-owner 唯一落盘，并独立复核 PM 固定版本聚合报告、AA 官方 API 文档和 IFBench 固定版本数据卡。本轮未运行模型/judge、未复现论文、未调用鉴权榜单 API。
>
> “注意力”指可观察的上下文利用和行为持续性，不指 Transformer attention 权重。研究只是离线实验依据，不是默认参数、生产接入或付费实验的授权。

## 1. 结论

**有可以持续获取的分维度数据与评测实现；本次核查没有找到能按精确模型版本同时覆盖延迟意图、更新/取消、合法等待、正确停止、提醒误行动及成本的可靠统一注意力分。**

1. 可以离线跟踪 IFEval/IFBench/Multi-IF/MultiChallenge、RULER/HELMET/LongBench v2/MRCR/AA-LCR、LongMemEval 等版本化产物；公开数据不等于已有当前模型的可比成绩，生成与部分 grader 仍有费用。
2. PM-Bench 最接近延迟意图与动作误报；Remember When It Matters 是干预效果实验。两者均不是定期刷新的精确模型注意力评分服务。
3. 最大缺口是本地宿主的合法等待/正确停止、reminder 引发的误行动及净收益。memory QA 的 abstention 不能代替这些指标。
4. 分数必须附模型/推理配置、宿主/脚手架、数据/grader 版本、分母、采样和失败排除。通用智力档位≠注意力画像≠本地干预净收益。
5. 未完成本地标定前保持 conservative/off；显式实验可 shadow。低分不自动增加提醒/wake/频率/预算，高分也不能跳过删除实验。

## 2. 证据矩阵 A：五个指定起点

“公开”只表示可读/下载；论文、代码、数据和榜单条款分别核对，不能把一种许可延伸到另一种产物。

| 来源与版本 | 测量、分母及已核实结果 | 产物、维护与许可 | 适用范围与缺测 |
|---|---|---|---|
| [PM-Bench v1](https://arxiv.org/html/2607.12385v1)，2026-07-14，表1–3/§4/附录A | 同一个v9合成周：7天80步、81可评分执行任务、11更新事件（取消2/override3/改期6）。8模型×8配置=64轨迹，其中6种实跑、2种投票重放。Set-F1=2TP/(2TP+FP+FN)。表2 optional-HB跨模型macro65.1%、micro65.0%、FP178；ledger macro62.8%、FP134；自动30分钟HB macro57.8%、FP489。表3 GPT-5.4/HB-opt79.1%；GPT-5.3-Codex baseline78.9%、ledger74.8%。 | [作者仓](https://github.com/genglinliu/PMBench)公开scenario、JSONL、scorer、报告；e1093c4（2026-07-14）。无持续评分API/更新SLA证据。论文CC-BY-4.0；仓API license=null且树未发现LICENSE，代码/数据授权未明确。 | 最接近延迟意图、隐藏状态查询、更新/取消和FP；同一周不是64独立场景，无跨周重复seed CI。OpenRouter模型名不保证不可变provider快照，不是Pi/真实墙钟Wake。 |
| [Remember When It Matters v1](https://arxiv.org/html/2607.08716v1)，arXiv版本日2026-07-09，表1–2 | TB2.0原89任务中85对有效任务，排除4个容器故障；pass@1是最终verifier通过比例。Sonnet4.5 37.6→45.9%，Opus4.6 43.5→45.9%。τ²每配置278任务（50/114/114），表1task-weighted分别55.0→61.8%、66.2→68.7%。 | [作者仓](https://github.com/yifannnwu/proactive-memory-agent)，89e5c0d（2026-07-14），代码/部分示例轨迹；无定期成绩API证据。论文CC-BY-4.0、代码Apache-2.0；底层任务另核。 | 每步额外调用Opus4.6 memory agent，读最近8消息和bank；不是本库无模型调用策略。品牌版本非完整端点标识，未给本地误行动/成本净收益。 |
| [Drift No More? v2](https://arxiv.org/html/2510.07777v2)，2025-11-21；旧快照v1=2025-10-09 | 合成约束改写、τ-Bench用户模拟；相对GPT-4.1的KL/JS、语义相似度及judge分，不是任务通过率。v2表2仍是KL改善，但Llama3.1-8B和Qwen2-7B的Sim下降。 | 当前论文CC-BY-SA-4.0；未定位可核验的作者结果数据/代码/持续榜单API，不能写成绝对不存在。 | 三个主要模型、少量域；分母、完整logits获取/跨词表对齐及独立复跑条件未核实。只作目标重述假说证据，不给profile数值。 |
| [Lost in the Middle v2](https://arxiv.org/html/2307.03172v2)，2023-07-31；另核[v3](https://arxiv.org/html/2307.03172v3)，2023-11-20 | v2 QA各10/20/30文档档约2.7K例；KV各75/140/300键档500例；GPT-4仅20文档500例。测答案包含/检索准确率×位置；v3仍含0613版本说明与GPT-4子集。 | [作者仓](https://github.com/nelson-liu/lost-in-the-middle)，29b8a6d（2024-01-04），MIT代码；NQ/Wikipedia原素材另计。数据/生成器公开，无新模型刷新SLA。 | 历史位置/长度机制证据；不混v2分母与v3新增模型，不证明现代模型统一遗忘曲线，不测延迟动作、停止或干预收益。 |
| [FlipFlop v2](https://arxiv.org/html/2311.08596v2)，2024-02-21，§4–5/表2 | 当前v2：10模型、7分类任务、5类challenger、67,640实验；平均约46%翻答、准确率平均降低17个百分点（不是相对17%）。过滤初始近随机条件，不能当无条件总体估计。 | 论文公开；未定位作者完整评测代码/结果API。arXiv非独占分发许可不是任意再分发许可。 | 二轮无新证据质疑，不是中性具体锚点/Wake；支持有害翻答负例，不提供当前模型误行动概率。v1的9模型口径不混入v2。 |

### 2.1 勘误、冲突和复算

旧[研究快照](agent-im/2026-10-24-model-attention-interventions.md)保留历史正文，以下新核验优先用于当前结论：

- **PM摘要与原表冲突**：摘要将65.1%关联最佳GPT-5.4，但表2是跨8模型macro，表3该模型HB-opt为79.1%。[固定commit聚合报告](https://github.com/genglinliu/PMBench/blob/e1093c470c8981daf522d4ef047a7c3a71e077d7/runs/all_results_v9/experiment_output_comparison_report.md)给optional-HB的TP/FP/FN=398/178/250，micro F1=796/1224≈65.0%，TP+FN=648=8×81。owner另行抓取原报告复核了这些值。**FP178是计数，不是FPR；不得除以64 runs伪造概率。**
- PM README路径是 runs/March_ALL_results_v9，实际树为 runs/all_results_v9；应锁commit实际产物，不盲执行README脚本。本轮没有运行脚本。
- **Remember表1/表2不可混**：表1Sonnet+memory τ² micro61.8%，表2full61.2%，原因未用完整原轨迹独立核实。表2always-inject micro61.5%高于full61.2%，但macro63.5%低于full64.3%。作者称0.3pp在预期方差内，不等于提供显著性检验/CI；不能说选择性方案所有指标最好。
- **Drift不是全部指标改善**：KL、参考模型相似度、judge分与任务成功各自独立，v1/v2相同表值不补足数据/分母缺失。
- 论文版本日期、HTML内部日期、实验日期和代码提交日期不能互换。Remember HTML内部另见2026-08-24，但arXiv v1提交日2026-07-09；本文按版本历史标记，不臆断实际实验日。

## 3. 证据矩阵 B：可更新来源

| 来源 | 对象、指标和分母 | 获取、维护证据 | 许可和缺测 |
|---|---|---|---|
| [Google IFEval](https://github.com/google-research/google-research/tree/master/instruction_following_eval) | 单轮程序约束。reviewer读取JSONL数得541 prompts、834约束实例、25种约束。prompt-level分母541、instruction-level834；strict/loose分开。 | JSONL/checker/样例响应公开；子目录最近commit e6890f8（2026-07-22）；可重评存量输出，不是当前模型自动榜单。 | 仓根Apache-2.0，非官方支持Google产品。主要格式/词数约束，不等于持续遵循、优先级或正确停止。 |
| [Ai2 IFBench](https://github.com/allenai/IFBench)、[数据卡](https://huggingface.co/datasets/allenai/IFBench_test) | 作者300 prompts、58种OOD约束，另有两轮constraint-isolation。常报prompt-level loose accuracy。[AA方法](https://artificialanalysis.ai/methodology/intelligence-benchmarking#ifbench)为294题×5 repeats、单轮loose prompt pass@1。 | 代码/HF/checker公开；代码1c40f0c（2026-09-09）。作者数据可下载，不自动产生新模型成绩。 | 代码Apache-2.0；数据ODC-BY-1.0，附Ai2 Responsible Use及第三方模型输出条款。owner独立读取固定SHA卡确认300与许可。**300≠294，排除6题ID未核实。** 高约束分不保证主任务质量。 |
| [Multi-IF](https://github.com/facebookresearch/Multi-IF)、[数据](https://huggingface.co/datasets/facebook/Multi-IF)、[表1](https://arxiv.org/html/2410.15553v1) | 4,501段、8语言、每段3轮。o1-preview平均0.877→0.707是instruction/conversation-level×strict/loose四项先平均再跨语言平均；不是统一accuracy，也非13,503独立对话。 | CSV/脚本公开，作者仓archived；1cdb53e（2024-10-29），数据最后修改2024-10-30；无持续维护承诺。 | 代码Apache-2.0，**数据CC-BY-NC-2.0**。语言样本不等量，macro/micro不混，三轮不能外推长agent运行。 |
| [Scale MultiChallenge](https://labs.scale.com/leaderboard/multichallenge)、[数据](https://huggingface.co/datasets/ScaleAI/MultiChallenge) | 指令保持、推理记忆、版本编辑、自洽；实例级rubric LLM judge。[论文v1](https://arxiv.org/html/2501.17399v1)273段，均值5轮/最多10轮；当前官方HF card266段。 | 官方榜单/HF下载，数据670fd81（2026-03-31）；未核实公共成绩API或更新SLA。 | 数据CC-BY-4.0。273→266对应/删题原因未核，旧成绩不能配新分母；最终回复judge不等于实时行为/取消动作正确率。 |
| [NVIDIA RULER](https://github.com/NVIDIA/RULER) | 4类13任务，默认每task×length500例，保留4K–128K长度切片。[scorer](https://github.com/NVIDIA/RULER/blob/c3f5e3b4f87f97e048793bb510a3a6b19a46bf3a/scripts/eval/synthetic/constants.py)对检索算参考答案命中比例再平均，QA为任一参考答案子串命中，不是同一种严格EM。 | 生成器/脚本/README成绩，c3f5e3b（2026-07-22）；修复过answer_prefix路径，无固定更新频率保证。 | 代码Apache-2.0，语料/QA源另核。检索/追踪/聚合不测规则、取消、提醒风险；协议/provider精度可能不同。 |
| [HELMET](https://github.com/princeton-nlp/HELMET) | Recall/RAG/rerank/citation/longQA/summarization/ICL七类，分别EM/F1/召回/排序/模型评分；N由配置和有效实例决定，无统一分母。 | 预处理数据、JSON/score产物和结果表公开；aeadacc（2026-09-19）。CHANGELOG含2024-10 seed修复、2025-02 ICL100→500例，最新commit修demo抽样seed。 | 代码MIT；HF汇总卡无统一license，底层数据逐项遵守。LongQA/summ judge有费用，不能称全程离线零token；无已核精确模型定期分数API。 |
| [LongBench v2](https://longbench2.github.io/)、[代码](https://github.com/THUDM/LongBench)、[数据](https://huggingface.co/datasets/zai-org/LongBench-v2) | 503道4选1、6大类，8k–2M **words**非tokens。官方GPT-4o-2024-08-06 direct50.1%/CoT51.2%，2024-11-20为46.0/51.4；o1-preview-2024-09-12 CoT57.7%。同版本/CoT/截断才比较。 | 欢迎新提交；代码2e00731（2025-01-15），HF最后修改2024-12-20。页脚Last Update2025-05-06但有之后模型行，页脚不是刷新SLA。 | 代码MIT、数据Apache-2.0。长短子集任务分布不同，不以子集直接推出衰减；缺动作/安全停止/成本。 |
| [OpenAI MRCR](https://huggingface.co/datasets/openai/mrcr) | 2/4/8 needle多轮共指检索，各长度bin100例，8 bins约4K–1M，长度按prompt+answer计。无要求随机前缀直接0；否则difflib.SequenceMatcher ratio，**不是accuracy**。 | Parquet/grading示例；f4c69fa（2025-12-08）。card记录约10%样本needle数量、约5%ground truth修复，新增date_added。 | MIT数据；必须锁needle/长度/修复版本。长文本检索不等于遵循新旧指令或未来适时行动。 |
| [LongMemEval v1/cleaned](https://github.com/xiaowu0162/LongMemEval)、[数据](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned) | 500问题：抽取、跨会话、知识更新、时间推理、abstention；oracle/S/M是同问题不同history，不是1,500独立题。QA正确率与检索召回分开。 | 2025-09清理干扰历史，2026-05链接V2；JSON/脚本公开；cleaned98d7416（2025-09-19）。 | 代码/cleaned数据MIT。知识更新/弃答不等于取消真实动作、合法等待、正确停止；默认LLM grader有成本。 |
| [LongMemEval-V2](https://github.com/xiaowu0162/LongMemEval-V2)、[数据](https://huggingface.co/datasets/xiaowu0162/longmemeval-v2)、[榜单协议](https://github.com/xiaowu0162/LongMemEval-V2/tree/2cc8c540bdb87fe6761629b585e727e1c4704520/leaderboard) | 451人工问题、1,870轨迹；最多500轨迹/115M tokens haystack，5种环境经验能力。评memory Query经固定reader后的accuracy与query latency；reader Qwen3.5-9B、judge GPT-5.2，Codex基线另锁CLI/model/effort。 | harness/题目/轨迹/checksum/提交协议/榜单；代码2cc8c54（2026-08-09），数据f152293（2026-05-17），无固定刷新SLA。 | 代码/数据Apache-2.0。LAFS Gain按固定frontier的log latency预算积分，是memory系统分，不是裸模型注意力分，其权重不能给wake标定。 |
| [AA-LCR v1.1](https://huggingface.co/datasets/ArtificialAnalysis/AA-LCR)、[方法](https://artificialanalysis.ai/methodology/intelligence-benchmarking#aa-lcr) | 100问题、7文档类别，约100k输入tokens（cl100k_base），3 repeats、pass@1、equality-checker LLM；当前方法指定GPT-5.6 Luna medium。重复不是300独立题。 | HF CSV/文档/官方榜单；2026-09 v1.1改正16个答案并新增judge系统prompt，明确不能与v1.0直接比较。 | 数据卡Apache-2.0，第三方原文另核；本轮没取得逐模型原始输出，不把网页摘要写入profile。只覆盖长文档推理。 |
| [Artificial Analysis Data API](https://artificialanalysis.ai/documentation) | 智力/性能/价格，不是“注意力API”；[智力指数v4.3.2](https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index)为十项综合，不是持续遵循同义词。 | GET /api/v2/data/llms/models，需账号API key，1,000次/天，建议稳定model/creator ID而非名字/slug。owner与reviewer均核官方文档，**未实际鉴权调用**，不能保证免费schema含所有IFBench/AA-LCR/逐题数据/历史。 | 必须署名，受Terms of Use/Data Platform Terms约束，非开源数据许可。无每模型固定重测SLA；商业API权限另核，不擅自注册/购买/抓受限数据。 |

### 3.1 锁版本记录

GitHub取默认分支commit及committer日期，HF取dataset revision/lastModified；不用可能受其他事件影响的 GitHub updated_at 证明科研维护频率。

| 产物 | 已核revision |
|---|---|
| PM-Bench code/data/logs | e1093c470c8981daf522d4ef047a7c3a71e077d7 |
| Proactive-memory-agent code | 89e5c0d6aadfe531a1aee42fd290d48be89973dd |
| IFEval子目录最近commit | e6890f85757dd84e27ca6df2dd30651dafad28e0 |
| IFBench code / HF test | 1c40f0c10d9b5c5c2f10a175a28007ebb64f7f4d / 2e8a48de45ff3bf41242f927254ca81b59ca3ae2 |
| Multi-IF code / data | 1cdb53ed18499ad729e0766e5d3099dd5344406f / 0ab97ce0b45c7f57772e8ba2ac1616f4b00bd3aa |
| MultiChallenge data | 670fd81f270314d0f8f82b34fcfe2187fd28f699 |
| RULER code | c3f5e3b4f87f97e048793bb510a3a6b19a46bf3a |
| HELMET code / data | aeadacc6593e9a222a84b0660b186a4e23d2efda / dddb209d03e38f1f0faf76d6d05ef4ccf96240ee |
| LongBench code / v2 data | 2e00731f8d0bff23dc4325161044d0ed8af94c1e / 2b48e494f2c7a2f0af81aae178e05c7e1dde0fe9 |
| MRCR data | f4c69fae7cf81f7ca26b9fee34b392a50f6b8a1d |
| LongMemEval-cleaned data | 98d7416c24c778c2fee6e6f3006e7a073259d48f |
| LongMemEval-V2 code / data | 2cc8c540bdb87fe6761629b585e727e1c4704520 / f152293e235517d504809563c833d7190b8c713b |

产物指针不证明榜单每条成绩都用该revision跑出；**成绩自身也必须提供run revision，才形成可比证据链**。AA-LCR此次核到v1.1说明但未记录immutable HF SHA，不冒充已冻结快照。

## 4. 七维画像：不制造任意加权总分

这是离线研究/实验记录建议，不新增runtime契约字段：

| 维度 | 外部线索 | 本地量与分母 | 不可替代项 |
|---|---|---|---|
| C 上下文信息利用 | Lost/RULER/HELMET/LongBench/MRCR/AA-LCR | 按长度、位置、干扰、压缩分层，保留原指标量纲/分母 | advertised context window非有效利用率，MRCR ratio非二元accuracy |
| I 持续约束遵循 | IFEval/IFBench/Multi-IF/MultiChallenge | 各决策点有效约束通过数/有效约束实例；全任务全约束通过率另列，保留轮次/语言 | 检索到≠采用，格式合规≠主任务正确 |
| P 延迟意图 | PM-Bench | deadline前正确行动的gold机会/全部仍有效gold机会；precision/recall/timeliness分开 | 未命中≠信息丢失，无请求≠运行中遗忘 |
| U 更新/取消 | PM、LongMemEval邻近证据 | 最新版本采用/更新机会；取消后不行动/取消负例；旧版本行动单列 | knowledge-update QA≠真实副作用取消 |
| S 合法等待/正确停止 | 未找到可直接迁移的通用分，须本地补齐 | 正确等待/等待负例；正确停止/已完成负例，两类分母分开 | memory abstention≠宿主settled/停止行为 |
| H 干预伤害 | FlipFlop、PM FP、本地paired A/B | 初始正确→提醒后错误/初始正确配对案例；误派工/重复广播/旧锚点行动分别计 | 提交成功、说话/工具调用更多均非恢复 |
| K 成本/延迟 | 官方性能价格、干预论文、本地账单 | 额外run/request，输入/输出/reasoning/cache tokens、费用、p50/p95 deadline延迟；场景配对差 | TTFT不是任务完成延迟，memory query latency不是端到端运行时间 |

### 分母和不确定性

- TP/FP/FN绑定预先定义的“行动机会+deadline”，不能用消息数、step、task互换。
- 只有定义全部负例机会/TN，才能报 FPR=FP/(FP+TN)；否则报FP计数或 FP/(TP+FP) 的false-discovery proportion并注明动作单位。分母0记undefined，不填0或100%。
- 同题重复5次、同周8模型不是独立问题数。CI应按原问题/场景聚类；二元配对可用discordant pairs或配对bootstrap，不从四舍五入百分比倒推CI。
- shadow只能验证候选/门槛/模拟账本，不能证明emit采用或净收益；当前core的shadow从独立零账本起算，并非当前emit历史精确反事实。

### 证据标签与缺测

每条离线记录分开保存：source_verified（原表/代码已读）、reported_not_reproduced/本地复现、identity_match（provider/model revision/effort/endpoint/宿主）、comparability（数据SHA、grader/prompt、截断、能力、采样、失败排除）、uncertainty（N、重复、CI、timeout/unknown）、transfer（外部近邻还是本地净收益）。

缺值原因明确为 not_measured、version_mismatch、protocol_mismatch、unavailable、license_blocked、stale。**缺测不是0分，不向同品牌新模型插值。** 这些仅为研究标签，不是未经评审的新core枚举。当前本地精确模型/宿主组合没有七维完整可比成绩。

## 5. 可重复更新规程

建议“每月一次来源巡检 + 模型/宿主/benchmark改变时复核”。这是项目建议，**不是作者维护频率事实**；本轮不实现cron、daemon、scheduler或core联网。

1. **登记来源及权利**：canonical URL、维护者、论文版本、代码/数据/成绩分别的许可、鉴权/限频。版权不明只留引用/必要事实，不vendor代码/轨迹；NC数据不进可发布包。更新失败显式记下，不静默保留“最新”标签。
2. **只取元数据**：GitHub repo/commit/tree API，HF /api/datasets/{id}与固定revision下载，arXiv版本史及官方榜单/方法。AA只在单独授权key后调用官方API，密钥进外部环境而非仓库。下载不是运行模型，生成/judge走另一条授权车道。
3. **冻结原件/manifest**：许可允许时归档，记录retrievedAt、sourcePublishedAt、runDate、SHA/ETag/hash、split/count、排除ID、scorer/prompt版本；不能归档则记录immutable URL和限制。main链接只用于发现更新。
4. **先核schema/分母**：题数/ID唯一、单位/方向、macro/micro、strict/loose、CoT、judge、tokenizer/长度边界、截断与版本。IFBench300/294、MultiChallenge273/266、MRCR修复、HELMET抽样、AA-LCR1.0/1.1都必须审；不闭合即暂不可比。
5. **身份精确对齐**：stable model/creator ID及实际provider API ID/revision、effort/预算、system prompt、tool/harness/compaction。品牌别名/滚动端点/无日期行只作线索，未知profile保持off。
6. **核数值，不擅自复跑**：许可允许且有存量输出时可以离线确定性grader；LLM judge不是默认零token作业。冲突来源同时保留，不择有利值，作者未给重复/CI就明确无。
7. **产差分画像和候选**：新增/缺失维度、置信度、分母/grader变化；不产任意“Attention Score”。若将来定义项目效用，须用本地数据预注册权重/风险成本并做敏感性分析，注明不是行业权威。
8. **人工审查再发布配置**：owner审dated报告并更新living引用；只有本地验证的完整精确profile才能成为配置，保留旧版、用户覆盖/关闭。单次榜单更新不能在线覆盖动作/预算。

优先级：IFBench/RULER/MRCR/AA-LCR等可锁版本产物帮助画像；PM/Remember帮助实验设计；Drift/FlipFlop/历史位置实验限制推断与风险。这个顺序不代表统一评分权重。

## 6. 离线profile候选映射

先锁 host+hostVersion、provider+model/revision+reasoning、taskFamily/roleTopology、compaction方式、policyVersion、reminderTextVersion。实验身份信息不等于擅自扩展现有公共类型。

| 画像 | 可以尝试 | 不允许据此做什么 |
|---|---|---|
| 关键身份/协议不匹配，或U/S/H缺测 | conservative/off；显式授权的shadow标注 | 不按“强/弱”补分，不把unknown唤醒 |
| C位置/压缩利用下降且下一请求本来会发生 | 单次短小当前锚点reanchor臂，固定预算比有/无 | 不直接启wake；先证只入目标请求、非durable、无额外run |
| I跨轮遗漏，没有确认停后缺口 | 固定内容/任务比较请求前选择性重述，允许沉默 | 不先加cadence，不用格式改善替代任务结果 |
| P漏做且本地仍有具体有效线索，settled且无continuation | 独立有界wake实验，和reanchor分开 | 必须补S/H/deadline/成本；PM虚拟30/60分钟不映射真实timer，不建业务scheduler |
| H高或召回增长同时FP明显增加 | off/低压力具体reanchor的shadow候选 | 不以弱模型为由加重催促，等待/停止负例不能退化 |
| U差或锚点更新/取消 | 仅最新有效版本，严格version/expiry/drop-stale；无法保证则沉默 | 不能用增加次数替代数据安全，分数不能绕prepare |
| 原生无库已不劣或无稳定净收益 | 关profile；只有reanchor有收益则删wake | 用删除实验与共享复杂度判断库价值，不以宿主数量/名次机械裁决 |

**不能从行业分直接导出** turns/bytes/idle阈值、cooldown、attempt cap、wake次数、提醒长度或采样频率；没有Pi上的因果响应曲线，本文不填猜测数字。

## 7. 本地标定与删除门禁

与[测试门禁](../testing.md)一致：

- **V0**：先证core机制。行业分不替代完整fence/close/prepare/尝试预算/回执/shadow/惰性expiry测试。
- **V1**：真双消费者shadow，预先定义gold标签/deadline/unknown；机械、无协作、等待、已完成、更新/取消均有负例。fixture不是真实接入。
- **V2**：锁真实宿主版本，以sandbox+假端点证明机制；submitted≠adopted，agent_end≠settled/无continuation。
- **V3**：必须有真不加载库的原生基线，不只mode=off；旧Wake/nudge固定单列。固定host/model/task/text/预算，随机交错或配对重复，一次一变量。主指标采用/任务结果，反指标S/H、token/extraRun/latency/cache；付费仅显式token车道。
- 推广前预注册最小有意义收益、可接受误行动上界及成本约束，数值来自本地风险而非论文猜测。unknown、超时、基础设施故障分别记录，不择优删除失败。
- **V4**：模型/宿主/原生能力升级后先测无库；不劣则关profile。榜单变好只触发复核，不跳过删除实验。

## 8. 验证、未验证与收口

**已核验**：reviewer读取五篇原文相关表/版本史、作者仓/数据卡/部分scorer、GitHub/HF元数据、PM聚合报告、IFEval输入行数/约束数、AA方法/API文档；owner独立重取PM固定报告、AA文档与IFBench固定数据卡并核对关键数值/条款。识别摘要与原表、表间、路径、分母及许可差异。

**未验证**：未复跑模型/judge/论文、未独立重放PM全部轨迹、未穷尽第三方素材许可；未调用鉴权AA API或证明免费返回包含全部所需维度；无当前本地精确组合的完整七维成绩、无Pi行为净收益结论。

**风险**：数据污染/训练记忆、旧模型/滚动端点、judge/prompt偏差、样本相关、微小修订造成不可比、许可缺口、形式行动/翻对为错，以及等待/停止行业缺测。统一单分不能消除这些风险。

**变更与注释收口**：本次交付是dated报告、议程状态和地图引用；不改core契约/默认参数、原仓历史快照、全局模型路由，不新增skill、联网core、在线调参、scheduler、daemon或judge。相邻仓只读；论文事实与工程建议分栏，历史快照不回写成“当时已知”。
