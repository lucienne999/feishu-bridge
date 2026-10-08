# Mac 飞书远程助手 · 本地原型

Mac 是执行机器，手机飞书是入口。无需公网端口。本版通过已安装的 `lark-cli` 复用飞书应用配置，通过 `codex exec --json` 执行任务并续接会话。

## 当前支持

- 仅白名单用户与机器人的私聊文字消息；群聊、机器人消息、超过五分钟的旧消息不执行。
- 由白名单用户通过 `/cd 绝对路径` 选择项目；默认只读，可在初始化时选择 workspace-write。
- `/codex`、`/cursor`、`/qcoder`、`/opencode` 进入对应执行器，后续文字续接；`/exit` 回到命令模式。目录切换解除旧会话绑定。未指定时用 `config.json` 的 `defaultMode`（默认 `codex`），可直接发任务。
- Agent 任务结果用飞书卡片 2.0 回传：先发「处理中」卡，完成/取消/失败时原地更新为终卡（管道表转 table，过程/依据折叠）；开新会话用 `/new`（不退出当前执行器模式）。模板与规范在 `src/message-templates/agent-card/`。命令类回复仍为纯文字。
- 目录、程序启动、认证、额度、网络、超时等失败通过飞书返回阶段与分类原因，不回传可能含密钥的原始诊断。
- 持久化消息去重、会话续接、状态查询、新会话、取消、十分钟任务上限。
- 一次执行一个任务，忙碌时明确拒绝，请用户稍后重发；没有后台排队。
- 生成 macOS LaunchAgent 配置，供登录后自动启动。

这是可验证的原型：未包含业务 API 适配、审批卡片、附件、多机器路由、自动升级或消息补发。Codex 使用非交互模式；需要额外权限的操作会失败，不会自动越过沙箱。指定目录是工作与写入范围，不等于文件读取隔离；Mac 应用操作还可能需要系统隐私授权。不要把它当作通用桌面遥控器。

## 准备与安装

需要 Node.js 22.13 或更新版本（含 node:sqlite）、Codex CLI、Lark CLI。本原型无 npm 外部依赖。运行目录需要保持稳定。

1. 在 Mac 终端确认 `codex login status` 正常；未登录时运行 `codex login`。
2. 未安装飞书 CLI 时执行 `npx @larksuite/cli@latest install`。
3. 确认应用开启机器人能力、长连接事件接收，订阅 `im.message.receive_v1`，回调配置启用 `card.action.trigger`；有私聊消息读取 `im:message.p2p_msg:readonly`、以机器人发送消息 `im:message:send_as_bot`，以及更新卡片 `im:message:update`（或等价 `im:message`）权限；完成发布及可见范围配置。
4. 在本目录运行 **`npm run init`**（通常只需一次）：检查 Node / Lark CLI / Codex，完成飞书机器人连接与白名单配对。
   - 未指定自定义 BOT 时，自动使用当前 **Lark CLI** 已配置的机器人（`lark-cli auth status`）。
   - 若 Lark CLI 尚无应用，可先 `lark-cli config init --new`，或在 init 提示时填写 App ID / App Secret；非交互：`printf '%s' "$APP_SECRET" | npm run init -- --app-id cli_xxx --app-secret-stdin`。
   - 已有 `config.json` 时跳过配对；仅检查连接可用 `--skip-pair`。
   - **全量模式** `npm run init -- --full`：主动安装缺失的 Codex、Cursor CLI、Qoder CLI、[OpenCode](https://opencode.ai/)（官方安装脚本），再完成上述检查与飞书配置。
5. 运行 `npm start`。看到“飞书订阅已就绪”后，在手机上私聊机器人，先发 `/status`。

手工分步（`setup` / `connect` / `pair` / `doctor` / `bindbot`）仍可用；新环境优先走 `init`。

先发 `/status`，再发 `/cd /Users/你的名字/projects/demo` 选择目录；路径可以包含空格，不需要加引号，支持 `~/`。默认执行器是 Codex，可直接发任务，例如「读取 README，告诉我这个目录是干什么的」。接着发“继续详细解释”验证续接。`/cursor` 等命令切换执行器；`/exit` 返回命令模式（再发任务会回到默认执行器）；`/new` 开新会话且留在当前执行器模式；`/cancel` 取消当前任务。忙碌期间不能切目录。重启后正在执行的任务标为 interrupted，不会自动重做，以免重复修改。

默认白名单用户可选择当前 macOS 账户能够访问的目录；若需要限定范围，在 config.json 加入 `"allowedRoots": ["/Users/你的名字/projects"]`。在 config.json 把 `"defaultMode"` 改成 `cursor` / `qcoder` / `opencode` 可换默认执行器（需重启服务）。目录检查解析符号链接，不使用 shell 执行 `/cd` 的文本。

密钥由现有 CLI 管理，本工具不复制密钥。macOS 钥匙串在某些沙箱或后台上下文中不可用；先在交互终端验证，不要为跑通而降低钥匙串保护。诊断成功代表本地配置存在，不代表消息收发权限已完成实测。

## 登录后自动启动

先在前台完成手机收发验证，再运行 `npm run launchagent`。生成的 plist 只含路径和运行配置，不含凭据。

在本目录的终端中执行：

```sh
mkdir -p "$HOME/Library/LaunchAgents"
cp local.launchagent.plist "$HOME/Library/LaunchAgents/local.mac-feishu-bridge.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.mac-feishu-bridge.plist"
```

启动后台服务前先停止前台实例。服务日志在本目录 `service.log` 和 `service-error.log`。LaunchAgent 在用户登录后运行，退出登录后停止；不是开机未登录即可运行的系统服务。若后台钥匙串访问失败，先解决该访问问题。

停止并卸载后台项：

```sh
launchctl bootout "gui/$(id -u)/local.mac-feishu-bridge"
rm "$HOME/Library/LaunchAgents/local.mac-feishu-bridge.plist"
```

## 在线与休眠

Mac 必须开机、联网、用户会话可用且系统未休眠。锁屏或关闭显示器本身不等于系统休眠；合盖可能导致休眠。按需调整接电源时的系统睡眠设置。本工具不会修改睡眠设置，也不会唤醒已睡眠的机器。离线期间不保证事件补投；重新上线后请查看状态，必要时重新发送任务。

## 数据与限制

`config.json` 保存白名单和项目目录；`state.sqlite` 保存消息 ID、状态和 Codex 会话 ID；Codex 自行保存其会话。请勿将这些运行文件提交或随安装包共享。去重记录持久保留，原型未做自动清理。结果超过长度限制会截断；回复失败不会重复执行任务。程序避免把用户消息拼接成 shell 命令，消息通过标准输入交给 Codex。

`npm run init` 会检查依赖并完成本地飞书连接与配对，但不会代替飞书管理员在开放平台完成授权与订阅。后续产品化还可覆盖自动装依赖、配置迁移、升级回滚和真实设备验收。

## 开发验证

`npm test` 检查身份过滤、旧消息过滤、会话隔离、执行参数和 plist 转义。测试不调用飞书或模型。完整验收需实际手机消息、Codex 执行、结果回传，并检查取消、重复投递、重启和断网恢复。

## 自动获取飞书机器人入口

运行 `npm run connect`。它复用当前 `lark-cli` 配置，读取已启用机器人的名称、应用 ID 和机器人身份，生成官方 AppLink 聊天入口，并进行三秒接收事件探测。此检查只读，不发送消息、不配置新应用、不修改飞书后台订阅。

`connection.json` 只保存机器人身份、入口和检查结果，不含 App Secret 或访问令牌。启动时核对当前 CLI 应用，避免更换配置后静默连接另一机器人。若检查失败，会明确返回失败状态；“接收事件已就绪”仍不代表回复权限和手机联调通过。

随后运行 `npm run setup` 配置本人的白名单，再运行 `npm start`。打开入口发送 `/status` 验证。当前入口属于应用机器人；长连接承担消息接收，聊天入口不是 Webhook。已有 Aily 智能体需要独立确认其接入能力，本命令不会自动绑定。

官方依据：
- 机器人信息：https://open.feishu.cn/document/client-docs/bot-v3/obtain-bot-info
- 机器人聊天入口：https://open.feishu.cn/document/develop-an-echo-bot/introduction

## 换新机器人

本工具绑定的是当前 `lark-cli` 配置的应用机器人。当前本机绑定见 `connection.json` 的 `botName` / `appId`。

在 Mac 终端运行 `npm run bindbot`（飞书里发 `/bindbot` 只会提示到本机操作，**不要在聊天里发密钥**）：

1. 先停止本地服务（前台退出，或已装 LaunchAgent 先 `bootout`）。
2. 按提示填入新应用的 **App ID**（`cli_` 开头）和 **App Secret**（开放平台凭证，不是公私钥）。
3. 程序会写入本机 `lark-cli` 配置、自动拉取机器人 open_id / 名称 / 聊天入口，并清除旧白名单。
4. `npm start` 重新配对后，在新机器人私聊发送 `/status` 验证。

非交互写法：`printf '%s' "$APP_SECRET" | npm run bindbot -- --app-id cli_xxx --app-secret-stdin`。新应用仍需机器人能力、长连接与上文权限/订阅；`botOpenId` 无需手填。

## 不查 open_id 的首次配对

已有机器人入口后，运行 `npm run pair`。等待“配对监听已就绪”，把终端显示的 `/pair 一次性配对码` 发到该机器人的私聊中。程序只接受五分钟内收到的匹配文本，读取发送者的 open_id 并新建本地 config.json；群消息、错误配对码、旧消息不会写入白名单。配对码不要分享给他人。已有配置时拒绝覆盖。

初次配对默认只读模式，初始目录为 demo，之后可用 `/cd` 切换。配对成功后运行 `npm start`，再发送 `/status` 验证收发。要允许 Codex 修改选中的项目，在本机将 config.json 的 sandbox 改为 workspace-write 并重启服务。配对程序不调用 Codex，也不发送飞书消息；成功提示显示在本机终端。

## 推荐入口

新环境先运行一次 `npm run init`，再 `npm start`。

- `init`：依赖检查 + 飞书 BOT（默认复用 Lark CLI）+ 事件探测 + 白名单配对。
- `init -- --full`：额外安装 Codex / Cursor CLI / Qoder CLI / OpenCode。
- `start`：已绑定则直接启动；若尚未配对，仍会自动 `connect` + `pair`（兼容旧流程）。
- 绑定默认只读，不自动授予修改权限。`setup` / `connect` / `pair` / `bindbot` 保留用于手工诊断。

缺少依赖或开放平台权限时，`init` 会给出明确失败原因；飞书后台订阅与发布仍需管理员完成。

## 执行器：Codex / Cursor / Qoder / OpenCode

飞书里用 `/codex`、`/cursor`、`/qcoder`、`/opencode` 进入对应模式；进入后普通文字续接该执行器会话。会话彼此隔离。未进执行器或 `/exit` 后直接发任务，走 `config.json` 的 `defaultMode`（默认 Codex）。`/cd` 清除全部绑定并留在当前执行器（若在命令模式则用默认执行器）；`/new` 只清当前模式会话并留在该模式。取消、超时和失败回传共用。

| 命令 | CLI | 安装（或 `npm run init -- --full`） | 登录 |
|------|-----|--------------------------------------|------|
| `/codex` | Codex | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` | `codex login` |
| `/cursor` | Cursor Agent | `curl https://cursor.com/install -fsSL \| bash` | `npm run cursor:login` |
| `/qcoder` | [Qoder CLI](https://docs.qoder.com/cli/installation) | `curl -fsSL https://qoder.com/install \| bash` | `npm run qcoder:login` |
| `/opencode` | [OpenCode](https://opencode.ai/) | `curl -fsSL https://opencode.ai/v2/install \| bash` | `npm run opencode:login` |

Cursor：只读对应 Ask + sandbox；非交互加 `--trust`（跳过目录信任提示，不是 `--force`）。本工具优先 `~/.local/bin/cursor-agent`。

Qoder：非交互 `qoder --print --output-format stream-json`；只读用 `--permission-mode plan`，可写用 `accept_edits`，不使用 `--yolo`。会话按 `session_id` / `--resume` 续接。

OpenCode：非交互 [`opencode run --format json`](https://opencode.ai/docs/cli/)；只读用 `--agent plan`，可写用 `--agent build --auto`。会话按 `sessionID` / `--session` 续接。

只有收到成功终止事件且进程成功退出，才向飞书报告成功。登录或额度失败会提示相应执行器。
