# mya

`mya` 是一个本地 AI 编码助手。  
你可以直接在终端里用它写代码、读代码、跑命令，也可以把同一个 bot 带到微信和飞书里持续工作。

如果一句话概括：

**`mya` = 终端里的本地代码代理 + 可持续运行的 bot 系统。**

## 快速开始

### 1. 安装

推荐直接用安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/flowxai/mya/main/install.sh | bash
```

如果你想先 clone 再安装：

```bash
git clone https://github.com/flowxai/mya.git mya
cd mya
./install.sh
```

### 2. 终端直接使用

`mya` 并不要求某个固定模型厂商。  
只要你的网关或服务端支持 **`v1/messages`** 这条接口，就可以接进来。

终端全局最重要的就是这 3 个配置：

- `url`
- `key`
- `model`

当前为了兼容已有调用链，环境变量名仍然是：

```bash
export ANTHROPIC_BASE_URL="https://your-endpoint"
export ANTHROPIC_API_KEY="sk-..."
export ANTHROPIC_MODEL="your-model"
mya
```

注意：

- `ANTHROPIC_BASE_URL` 填的是服务根地址，不是 `/v1/messages`
- 只要该地址真正支持 `POST /v1/messages`，模型不局限于某一家
- 如果某个端点只支持 OpenAI 的 `/chat/completions`，那这版 `mya` 不能直接接它

你也可以不配环境变量，直接写全局配置文件：

```text
~/.mya/settings.json
```

示例：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-endpoint",
    "ANTHROPIC_API_KEY": "sk-...",
    "ANTHROPIC_MODEL": "your-model"
  }
}
```

如果只想让某个 bot 用自己的模型配置，就改这个 bot 的：

```text
~/.mya/connect/hub/profiles/<bot-id>/profile.json
```

示例：

```json
{
  "defaultModel": "your-model",
  "baseUrl": "https://your-endpoint",
  "apiKey": "sk-..."
}
```

单次提问：

```bash
mya -p "hello"
```

### 3. 创建或选择一个 bot

创建一个新 bot：

```bash
mya bots add review-bot
```

查看并选择已有 bot：

```bash
mya bots
```

在交互终端里，`mya bots` 会直接打开 bot 列表：

- `↑ / ↓` 选择
- `Enter` 进入
- `q / Esc` 退出

### 4. 先定义 bot 身份

新 bot 第一次进入后，先执行：

```text
/whoru
```

它会引导你补齐：

- bot 名称
- 身份和职责
- 对主人的称呼方式
- 默认语言
- 风格和边界

如果你想一次性写回，也可以直接这样：

```text
/whoru set role="reviewer" purpose="Review risky PRs" style="brief and direct" owner="主人" language="中文"
```

### 5. 连接微信或飞书

微信绑定到某个 bot：

```bash
mya wechat login review-bot
```

不写 bot 时，默认使用 `default`：

```bash
mya wechat login
```

飞书绑定到某个 bot：

```bash
mya feishu login review-bot
```

`mya feishu login` 会交互输入该 bot 专属的 `appId` 和 `appSecret`。

### 6. 启动后台服务

```bash
mya serve
```

`mya serve` 会一次启动所有已经绑定好渠道的 bot。

如果你只是纯终端使用 `mya`，不需要 `serve`。

## bot 是怎么工作的

每个 bot 都有自己的目录：

```text
~/.mya/connect/hub/profiles/<bot-id>/
```

其中最重要的两个文件是：

- `BOT.md`
- `profile.json`

### `BOT.md`

`BOT.md` 是这个 bot 的长期指令文件，作用类似它自己的专属说明文件。

## 微信 / 飞书里能直接用什么

普通消息会直接交给当前 bot 处理。

系统命令由运行时直接处理，不会走 bot 的普通对话：

- `/mya status`
  查看这个 bot 当前的工作状态面板，包括当前阶段、最近动作、是否卡住、后台任务概览
- `/mya message`
  查看最近的会话摘要
- `/mya stop`
  立即停止当前任务，语义接近终端里的 `Esc`
- `/mya approve`
  通过当前等待中的权限请求
- `/mya reject`
  拒绝当前等待中的权限请求

微信和飞书更适合：

- 发起任务
- 接收关键状态和结果
- 处理权限确认

完整过程查看仍然更适合终端。

通常放这些内容：

- bot 身份
- bot 职责
- 工作风格
- 长期规则
- 不该做什么

这份文件会自动进入这个 bot 的 system prompt。

### `profile.json`

`profile.json` 是 bot 的结构化配置，主要放：

- bot 名称
- 默认工作区
- bot 自己的 `model` / `baseUrl` / `apiKey`
- 渠道绑定
- 权限模式
- 调度和唤醒规则

bot 的模型配置本质上也是这 3 项：

- `baseUrl`
- `apiKey`
- `defaultModel`

只要这个 `baseUrl` 背后的服务支持 `v1/messages`，这个 bot 就能接入。
也就是说，除了环境变量以外，你完全可以直接改：

- 全局：`~/.mya/settings.json`
- 单 bot：`~/.mya/connect/hub/profiles/<bot-id>/profile.json`

默认情况下你不需要先手改它。先用：

- `mya bots add`
- `/whoru`
- `mya wechat login`
- `mya feishu login`

就能把大部分流程跑起来。

## 命令一览

### 终端

```bash
mya
mya -p "hello"
```

### bot

```bash
mya bots
mya bots add review-bot
mya bots remove review-bot
```

### 微信

```bash
mya wechat login [bot]
```

规则：

- 不写 `[bot]` 时默认使用 `default`
- 微信全局只能绑定一个 bot

### 飞书

```bash
mya feishu login [bot]
```

规则：

- 不写 `[bot]` 时默认使用 `default`
- 不同 bot 可以各自绑定不同飞书应用
- 每个 bot 可以有自己的 `appId / appSecret`

### 后台服务

```bash
mya serve
```

`mya serve` 是后台常驻服务，用来托管：

- 微信 bot
- 飞书 bot
- 定时唤醒
- 后台任务

定时任务和后台任务完成后，会把结果主动发回这个 bot 最近活跃的微信或飞书会话。

创建定时任务时，直接改这个 bot 的 `profile.json`：

1. 在 `wakePolicy.schedules` 里新增一条规则
2. 常用字段是 `cron`、`prompt` 或 `command`、`workspaceRoot`、`taskType`、`metadata`
3. `prompt` 表示唤醒 bot 跑一轮后台 agent 任务；`command` 表示直接执行 shell 命令
4. 可选 `notification` 用来指定结果回推到哪个渠道或目标；不配时，会回退到这个 bot 最近活跃的微信或飞书会话
5. cron 按本地时间匹配
6. 保存后执行 `mya serve restart`

示例：

```json
{
  "wakePolicy": {
    "schedules": [
      {
        "name": "daily-mail-report",
        "cron": "0 9 * * *",
        "command": "cd /absolute/workspace/path/mail_service && python3 on_wake.py",
        "workspaceRoot": "/absolute/workspace/path",
        "taskType": "scheduled_job",
        "notification": {
          "channelType": "wechat"
        },
        "metadata": {
          "source": "mail-report"
        }
      }
    ]
  }
}
```

说明：

- `command` 型任务会直接执行这条 shell 命令，并把 `stdout / stderr / exit code` 组织成详细报告
- `prompt` 型任务则会启动一轮 bot 自己的后台 agent turn
- `notification.channelType` 可以先粗粒度指定 `wechat` 或 `feishu`
- 如果你需要更精确的路由，也可以在 `notification` 里继续写 `runtimeKey`、`accountId`、`bindingKey`、`chatId`、`userId`

如果这是邮件类定时任务，汇报标准也要写清楚。至少要让 bot 说明：

1. 扫描了多少邮件、筛选出了多少封重点邮件
2. 每封重点邮件的发件人、主题、时间、为什么重要
3. 有没有截止时间、会议、缴费、作业、回复要求、附件或链接
4. 你接下来需要采取什么动作
5. 如果没有重点邮件，也要明确说明判定依据

高级排障命令仍然保留，但不是主流程：

```bash
mya serve status
mya serve restart
mya serve stop
mya serve logs
```

## 权限模式

全局配置文件在：

```text
~/.mya/settings.json
```

如果你要默认就是完全权限，写：

```json
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
```

它等价于：

```bash
mya --dangerously-skip-permissions
```

现在这条模式就是**零询问完全权限**。

也支持别名写法：

```json
{
  "env": {
    "MYA_DEFAULT_PERMISSION_MODE": "dangerously-skip-permissions"
  }
}
```

其它常见值：

- `auto`
- `plan`
- `default`

说明：

- `auto` 不是完全权限
- `bypassPermissions` 才是完全权限
- 如果某个 bot 自己在 `profile.json` 里显式写了 `permissionMode`，它会覆盖全局默认

## 安装后会生成什么

`mya` 现在只使用一个统一根目录：

```text
~/.mya
```

主要包括：

- `~/.mya/settings.json`
- `~/.mya/connect/...`
- `~/.mya/connect/hub/profiles/...`

项目内目录则使用：

```text
.mya/
```

比如附件收件箱会落到：

```text
.mya/inbox/...
```

## 什么时候需要 Node.js

运行依赖：

- macOS 或 Linux
- Bun >= 1.3.11
- Node.js >= 22

其中 Node.js 只在你要使用这些能力时需要：

- `mya wechat ...`
- `mya feishu ...`
- `mya serve`

## 原生命令和新增命令

当前会话自己的状态 / 任务 / 诊断，继续优先用原生命令：

- `/status`
- `/tasks`
- `/doctor`
- `/agents`

`mya` 顶层只补原生没有的能力：

- `mya bots ...`
- `mya wechat ...`
- `mya feishu ...`
- `mya serve`

## 想看更高级的内容

如果你要继续看这些内容：

- 手工编辑 bot 配置
- 多 channel bot
- 定时唤醒
- 后台任务
- runtime 结构

继续看：

- [Channel Runtime Guide](./runtime/connect/README.md)
- [Advanced Usage](./runtime/connect/Usage.md)

## 开发者安装

如果你是要改源码：

```bash
git clone https://github.com/flowxai/mya.git mya
cd mya
bun run setup
bun run build
```

## 开发验证

```bash
bun run build
npm --prefix ./runtime/connect run check
npm --prefix ./runtime/connect test
```
