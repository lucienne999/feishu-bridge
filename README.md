# 飞书远程助手 · 本地原型

本机（macOS / Linux）是执行机器，手机飞书是入口。无需公网端口。本版通过已安装的 `lark-cli` 复用飞书应用配置，通过 `codex exec --json` 执行任务并续接会话。Windows 暂不支持，后续做平台适配。

## 当前支持

- 仅白名单用户与机器人的私聊文字；群聊、机器人消息、超过五分钟的旧消息不执行。
- 由白名单用户通过 `/cd` 选择项目；默认只读，可在初始化时选择 workspace-write。
- Agent 任务结果用飞书卡片 2.0 回传；命令类回复为纯文字。模板见 `src/message-templates/agent-card/`。
- 一次执行一个任务；忙碌时拒绝新任务。失败只回传阶段与分类原因，不回传可能含密钥的原始诊断。
- 生成 macOS LaunchAgent，供登录后自动启动。

### 飞书命令

| 命令 | 说明 |
|------|------|
| `/help` | 列出可用命令（未知斜杠命令也会回这份帮助） |
| `/status` | 本机是否在线、当前目录、执行器模式、**当前模型**、是否忙碌 |
| `/cd 绝对路径` | 切换工作目录（支持 `~/`）；清除会话绑定；忙碌时不可用 |
| `/codex [任务]` | 进入 Codex；可带任务，或之后直接发文字续接 |
| `/cursor [任务]` | 进入 Cursor Agent |
| `/qcoder [任务]` | 进入 Qoder |
| `/opencode [任务]` | 进入 OpenCode |
| `/model` | 列出**当前执行器**可用模型（命令模式则看 `defaultMode`） |
| `/model 模型名` | 设置模型（须在列表中）；也支持 `/cursor /model 模型名` |
| `/model clear` | 恢复该执行器默认模型 |
| `/exit` | 退出执行器模式；再发任务走 `defaultMode` |
| `/new` | 开新会话：在执行器内只清当前模式会话；命令模式清全部 |
| `/cancel` | 取消当前正在执行的任务 |
| `/bindbot` | 提示到本机运行 `feishu-bridge bindbot`（**勿在聊天发密钥**） |

未进执行器时可直接发任务，使用 `config.json` 的 `defaultMode`（默认 `codex`）。`/cd` 与 `/new` 行为见下表「执行器」一节。

这是可验证的原型：未包含业务 API 适配、审批卡片、附件、多机器路由、自动升级或消息补发。Codex 使用非交互模式；需要额外权限的操作会失败，不会自动越过沙箱。指定目录是工作与写入范围，不等于文件读取隔离；本机应用操作还可能需要系统隐私授权。不要把它当作通用桌面遥控器。

## 准备与安装（clone + npm）

需要 Node.js 22.13+（含 `node:sqlite`）。本工具无 npm 外部依赖；clone 后在仓库目录运行时，`config.json` / `state.sqlite` 等会写在本目录（已 gitignore）。也可用环境变量 `FEISHU_BRIDGE_HOME` 指定数据目录。

### 1. 克隆仓库

```sh
git clone https://github.com/lucienne999/feishu-bridge.git
cd feishu-bridge
```

### 2. 准备本机依赖与飞书应用

1. 在本机终端确认 `codex login status` 正常；未登录时运行 `codex login`。
2. 未安装飞书 CLI 时执行 `npx @larksuite/cli@latest install`。
3. 确认应用开启机器人能力、长连接事件接收，订阅 `im.message.receive_v1`，回调配置启用 `card.action.trigger`；有私聊消息读取 `im:message.p2p_msg:readonly`、以机器人发送消息 `im:message:send_as_bot`，以及更新卡片 `im:message:update`（或等价 `im:message`）权限；完成发布及可见范围配置。

### 3. 初始化与启动

```sh
npm run init    # 通常只需一次：检查依赖、飞书 BOT、白名单配对
npm start       # 启动长连接；看到「飞书订阅已就绪」后即可用手机私聊
```

手机上先发 `/status` 或 `/help` 验证收发。

常用脚本：

| 命令 | 说明 |
|------|------|
| `npm run init` | 依赖检查 + 飞书 BOT + 配对 |
| `npm start` | 启动长连接服务 |
| `npm run doctor` | 诊断本机配置（会打印数据目录） |
| `npm run connect` / `pair` / `setup` / `bindbot` | 手工分步 |
| `npm run launchagent` | 生成 macOS 登录自启 plist |
| `npm test` | 本地单测 |

### `npm run init` 细节

**默认：`npm run init`**

1. 安装 Codex CLI（已装则跳过）
2. 检查登录；未登录则拉起 `codex login`
3. 再继续飞书配置 / 配对（默认复用 Lark CLI 已配置的 BOT；无 BOT 时提示填写 App ID / App Secret）

**全量：`npm run init -- --full`**

1. 安装全部 Agent（Codex / Cursor / Qoder / OpenCode；已装则跳过）
2. 提示选择要做登录初始化的 Agent（可多选）
3. 对选中的逐个做登录验证

非交互全量可指定 Agent，例如：

```sh
npm run init -- --full --agents codex,cursor
npm run init -- --full --agents all
```

其它常用参数：`--skip-pair`（跳过白名单配对）；`--app-id` + `--app-secret-stdin`（非交互绑定自定义 BOT）。若 Lark CLI 尚无应用，也可先 `lark-cli config init --new`。

先发 `/status`，再 `/cd ~/projects/demo`；默认 Codex，可直接发任务。需要换模型时先 `/model` 查看列表，再 `/model 模型名`。完整命令表见上文「飞书命令」。忙碌期间不能切目录。重启后正在执行的任务标为 interrupted，不会自动重做。

默认白名单用户可选择当前系统账户能够访问的目录；若需要限定范围，在本目录 `config.json` 加入 `"allowedRoots": ["/home/你的名字/projects"]`（macOS 多为 `/Users/...`）。把 `"defaultMode"` 改成 `cursor` / `qcoder` / `opencode` 可换默认执行器（需重启服务）。目录检查解析符号链接，不使用 shell 执行 `/cd` 的文本。

密钥由现有 CLI 管理，本工具不复制密钥。macOS 钥匙串在某些沙箱或后台上下文中不可用；先在交互终端验证，不要为跑通而降低钥匙串保护。诊断成功代表本地配置存在，不代表消息收发权限已完成实测。

### 可选：不 clone，用 npx

不想落盘仓库时，也可直接：

```sh
npx --yes github:lucienne999/feishu-bridge init
npx --yes github:lucienne999/feishu-bridge start
```

此时运行时数据默认写在 `~/.feishu-bridge/`（可用 `FEISHU_BRIDGE_HOME` 覆盖）。子命令与上表相同（把 `npm run X` 换成 `npx --yes github:lucienne999/feishu-bridge X`）。日常使用与排错更推荐 clone + npm。

## 登录后自动启动

先在前台完成手机收发验证，再在仓库目录运行 `npm run launchagent`。生成的 plist 只含路径和运行配置，不含凭据；默认写在本仓库目录的 `local.launchagent.plist`（若用了 `FEISHU_BRIDGE_HOME` / npx，则在对应数据目录，可用 `npm run doctor` 确认）。

```sh
mkdir -p "$HOME/Library/LaunchAgents"
cp local.launchagent.plist "$HOME/Library/LaunchAgents/local.mac-feishu-bridge.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.mac-feishu-bridge.plist"
```

启动后台服务前先停止前台实例。服务日志在数据目录的 `service.log` / `service-error.log`。仓库路径变更或更新代码后请重新生成并安装 LaunchAgent。LaunchAgent 在用户登录后运行，退出登录后停止。若后台钥匙串访问失败，先解决该访问问题。

停止并卸载后台项：

```sh
launchctl bootout "gui/$(id -u)/local.mac-feishu-bridge"
rm "$HOME/Library/LaunchAgents/local.mac-feishu-bridge.plist"
```

## 在线与休眠

本机必须开机、联网、用户会话可用且系统未休眠。锁屏或关闭显示器本身不等于系统休眠；笔记本合盖可能导致休眠。按需调整接电源时的系统睡眠设置。本工具不会修改睡眠设置，也不会唤醒已睡眠的机器。离线期间不保证事件补投；重新上线后请查看状态，必要时重新发送任务。

## 数据与限制

clone 运行时，本目录下的 `config.json`（白名单与项目目录）、`connection.json`（机器人身份，无 Secret）、`state.sqlite`（消息去重与会话）为运行时文件，已 gitignore，请勿提交或分享。用 npx 且未设置 `FEISHU_BRIDGE_HOME` 时，这些文件在 `~/.feishu-bridge/`。Codex 自行保存其会话。去重记录持久保留，原型未做自动清理。结果超过长度限制会截断；回复失败不会重复执行任务。程序避免把用户消息拼接成 shell 命令，消息通过标准输入交给 Codex。

`npm run init` 会检查依赖并完成本地飞书连接与配对，但不会代替飞书管理员在开放平台完成授权与订阅。

## 开发验证

`npm test` 检查身份过滤、旧消息过滤、会话隔离、执行参数和路径解析。测试不调用飞书或模型。完整验收需实际手机消息、Codex 执行、结果回传，并检查取消、重复投递、重启和断网恢复。

## 自动获取飞书机器人入口

运行 `npm run connect`。它复用当前 `lark-cli` 配置，读取已启用机器人的名称、应用 ID 和机器人身份，生成官方 AppLink 聊天入口，并进行三秒接收事件探测。此检查只读，不发送消息、不配置新应用、不修改飞书后台订阅。

`connection.json` 只保存机器人身份、入口和检查结果，不含 App Secret 或访问令牌。启动时核对当前 CLI 应用，避免更换配置后静默连接另一机器人。若检查失败，会明确返回失败状态；“接收事件已就绪”仍不代表回复权限和手机联调通过。

随后运行 `npm run init` 或 `npm run pair` 完成白名单，再 `npm start`。打开入口发送 `/status` 验证。当前入口属于应用机器人；长连接承担消息接收，聊天入口不是 Webhook。已有 Aily 智能体需要独立确认其接入能力，本命令不会自动绑定。

官方依据：
- 机器人信息：https://open.feishu.cn/document/client-docs/bot-v3/obtain-bot-info
- 机器人聊天入口：https://open.feishu.cn/document/develop-an-echo-bot/introduction

## 换新机器人

本工具绑定的是当前 `lark-cli` 配置的应用机器人。当前本机绑定见 `connection.json` 的 `botName` / `appId`。

在本机终端运行 `npm run bindbot`（飞书里发 `/bindbot` 只会提示到本机操作，**不要在聊天里发密钥**）：

1. 先停止本地服务（前台退出，或已装 LaunchAgent 先 `bootout`）。
2. 按提示填入新应用的 **App ID**（`cli_` 开头）和 **App Secret**（开放平台凭证，不是公私钥）。
3. 程序会写入本机 `lark-cli` 配置、自动拉取机器人 open_id / 名称 / 聊天入口，并清除旧白名单。
4. `npm start` 重新配对后，在新机器人私聊发送 `/status` 验证。

非交互写法：`printf '%s' "$APP_SECRET" | npm run bindbot -- --app-id cli_xxx --app-secret-stdin`。新应用仍需机器人能力、长连接与上文权限/订阅；`botOpenId` 无需手填。

## 不查 open_id 的首次配对

已有机器人入口后，运行 `npm run pair`（或走 `npm run init`）。等待“配对监听已就绪”，把终端显示的 `/pair 一次性配对码` 发到该机器人的私聊中。程序只接受五分钟内收到的匹配文本，读取发送者的 open_id 并新建本地 config.json；群消息、错误配对码、旧消息不会写入白名单。配对码不要分享给他人。已有配置时拒绝覆盖。

初次配对默认只读模式，初始目录为仓库内 `demo`，之后可用 `/cd` 切换。配对成功后运行 `npm start`，再发送 `/status` 验证收发。要允许修改选中的项目，在本机将 `config.json` 的 sandbox 改为 workspace-write 并重启服务。配对程序不调用 Codex，也不发送飞书消息；成功提示显示在本机终端。

## 推荐入口

新环境优先：

```sh
git clone https://github.com/lucienne999/feishu-bridge.git
cd feishu-bridge
npm run init
npm start
```

- `npm start`：已绑定则直接启动；若尚未配对，仍会自动 `connect` + `pair`（兼容旧流程）。
- 绑定默认只读，不自动授予修改权限。`setup` / `connect` / `pair` / `bindbot` 保留用于手工诊断。

缺少依赖或开放平台权限时，`init` 会给出明确失败原因；飞书后台订阅与发布仍需管理员完成。

## 执行器：Codex / Cursor / Qoder / OpenCode

飞书里用 `/codex`、`/cursor`、`/qcoder`、`/opencode` 进入对应模式；进入后普通文字续接该执行器会话。会话彼此隔离。未进执行器或 `/exit` 后直接发任务，走 `config.json` 的 `defaultMode`（默认 Codex）。`/cd` 清除全部绑定并留在当前执行器（若在命令模式则用默认执行器）；`/new` 只清当前模式会话并留在该模式。`/model` 按**当前执行器**列模型并设置（Codex 读 `~/.codex/models_cache.json`，其余调对应 CLI）；模型偏好按会话+执行器持久化。取消、超时和失败回传共用。

| 命令 | CLI | 安装（或 `init --full`） | 登录 | 模型列表来源 |
|------|-----|--------------------------------------|------|----------------|
| `/codex` | Codex | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | `codex login` | `~/.codex/models_cache.json` |
| `/cursor` | Cursor Agent | `curl https://cursor.com/install -fsSL \| bash` | `npm run cursor:login` | `cursor-agent models` |
| `/qcoder` | [Qoder CLI](https://docs.qoder.com/cli/installation) | `curl -fsSL https://qoder.com/install \| bash` | `npm run qcoder:login` | `qoder --list-models` |
| `/opencode` | [OpenCode](https://opencode.ai/) | `curl -fsSL https://opencode.ai/v2/install \| bash` | `npm run opencode:login` | `opencode models` |

Cursor：默认 Agent 模式 + sandbox；非交互加 `--trust`（跳过目录信任提示，不是 `--force`）。本工具优先 `~/.local/bin/cursor-agent`。

Qoder：非交互 `qoder --print --output-format stream-json`；只读用 `--permission-mode plan`，可写用 `accept_edits`，不使用 `--yolo`。会话按 `session_id` / `--resume` 续接。

OpenCode：非交互 [`opencode run --format json`](https://opencode.ai/docs/cli/)；只读用 `--agent plan`，可写用 `--agent build --auto`。会话按 `sessionID` / `--session` 续接。

只有收到成功终止事件且进程成功退出，才向飞书报告成功。登录或额度失败会提示相应执行器。
