# 飞书 Agent 完成卡 JSON 规范

本目录是 Mac `feishu-bridge` 的消息卡片模板与规范（源自火山云现网对齐稿）。`src/card.mjs` 会加载这里的 JSON 骨架并填充运行时内容：一张 schema 2.0 卡从「处理中」刷到「完成」，不拆成多条 `post`。

官方基础：[卡片 JSON 2.0](https://open.feishu.cn/document/feishu-cards/card-json-v2-structure)、[流式更新](https://open.feishu.cn/document/cardkit-v1/streaming-updates-openapi-overview)、[表格](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/content-components/table)。

同目录：

- `stream.json`：处理中（CardKit / 首发 interactive）
- `final.json`：完成（IM PATCH 终卡）
- `stopped.json`：中断
- `error.json`：出错

## 硬约束

| 项 | 值 | 原因 |
|---|---|---|
| schema | `2.0` | 表格冻结、流式、element_id 都要 2.0 |
| 一张任务 | 只发 / 只改这一张 interactive 卡 | 禁止终稿拆成多条 post |
| JSON 软上限 | 24000 字节 | 超了先丢依据、再把表改回 markdown、再截过程 |
| `element_id` | 字母开头，字母数字下划线，≤20 | 飞书 2.0 规定 |
| 标题 / 副标题 | 各 ≤40 字 | header `plain_text` |
| 聊天列表 summary | 完成：结论首句 ≤80；处理中：`处理中 · …` ≤80 | `config.summary.content` |
| markdown 单块 | ≤3500 字 | 再长就折叠「结论续 N」 |
| 过程区 | ≤3500 字 | 超出留最新，并写「更早 N 条省略」 |
| 图 | 最多 3 张，用 `img_key` 嵌在卡内 | 不要另发 image 消息（上传失败才允许） |

`element_id` 固定名（流式局部更新要用同一套）：

| id | 用途 |
|---|---|
| `el_sub` | 灰字当前动作（仅处理中） |
| `el_proc` | 过程正文 |
| `el_body` | 流式结论（处理中） |
| `el_evi` | 依据 |
| `el_foot` | 底栏 |
| `el_b0`… | 完成卡结论段落 |
| `el_t0`… | 表；多出来的列用 `el_t0p1` |
| `el_proc_box` | 完成卡过程折叠壳 |
| `el_panel` | 依据折叠壳 |
| `el_img0`… | 图 |

## 两种状态

**处理中（蓝）**  
CardKit `streaming_mode=true`。顺序：副标题 → 过程（展开）→ 结论草稿 → 依据占位 → 底栏。

- 卡头标题 = 用户问题前 40 字
- 卡头副标题 = 当前工具 / 阶段
- 标签：`处理中` / `blue`

**完成（绿）**  
整卡 PATCH，关掉流式。顺序：结论 → 图 → 过程折叠 → 依据折叠 → 可选链接按钮 → 底栏。

- 卡头标题 = 结论首句（先 `#` 标题，否则第一句，去掉 markdown）
- 卡头副标题 = 原问题
- 标签：`完成` / `green`；停止 `orange`；出错 `red`

结论首句跳过空行、表格行、`**结论**`。

## 结论怎么切

把 Agent 正文按「markdown / 管道表」交替切开：

1. 先输出一块 `**结论**` markdown（`el_b0`）
2. 管道表转飞书 `table`，不要把 `| a | b |` 当 markdown 扔进去
3. 结论后半段超过 3500 字：前两块展开，后面进折叠「结论续 N」，最多大约 10 块，不再拆消息

## 表格

| 项 | 值 |
|---|---|
| `page_size` | 5（飞书允许 1–10） |
| `freeze_first_column` | true |
| `row_height` | `low` |
| 每张表列数 | ≤4（第 1 列 + 最多 3 列） |
| 更宽的表 | 拆多张，每张都带第 1 列 |
| 首列宽 | `120px`，其余 `auto` |
| 表头名 | ≤20 字 |
| 单元格 | ≤80 字 |
| 行数 | 最多 50 |

列 `name` 用 `c0` `c1`…，行对象的 key 必须和 `columns[].name` 对上。

## 过程 / 依据

- 过程：一条一行 `- …`。完成卡包进折叠，标题 `**过程 · N 步**`，默认 `expanded: false`
- 依据：工具名最多 16 条，链接最多 8 条，默认折叠
- 不要把 20+ 步工具流水账铺在第一屏

## 图和按钮

- 图：`tag=img`，`img_key` 来自 `im/v1/images`（`image_type=message`），`scale_type=fit_horizontal`
- 链接按钮最多 4 个，`open_url`
- 开新会话用聊天命令 `/new`（不退出当前执行器）；终卡不再放「新会话」callback 按钮

## 减肥顺序（超 24KB）

1. 去掉依据，过程只留最近 8 条
2. 表改回 markdown，过程留 4 条
3. 去掉按钮，过程留 2 条
4. 仍失败：PATCH 成中断卡，提示用户重发，**禁止**再拆段发送

## 不要做

- 终稿拆成多条 `post` / `text`
- 过程默认展开压住结论
- 标题用问题截断、列表预览用问题（完成态必须用结论首句）
- 一张表塞 5 列以上还不拆
- 图另发一条，结论卡里没有图

## 权限（对方自己的应用）

最少：`im:message`、`im:message:send_as_bot`、`cardkit:card:write`、`im:resource`、`im:resource:upload`。事件走长连接：`im.message.receive_v1`；按钮走 `card.action.trigger`。

同一飞书 App 只能有一条长连接。不要复用别人的 App ID / Secret。
