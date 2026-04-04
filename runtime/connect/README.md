# Channel Runtime Guide

这份文档面向高级用户和 operator。

日常使用优先看仓库根目录的 [README](../../README.md)。大多数人只需要：

- `mya bots add <name>`
- `mya bots remove <name>`
- `mya wechat login [bot]`
- `mya feishu login [bot]`
- `mya serve`

这里主要讲内部运行层怎么组织 bot、channel、schedule。

## 运行模型

`mya` 里现在有两类 bot：

1. 终端 bot  
通过 `mya bots add <name>` 创建，`channels: []`，只在终端里工作。

2. 渠道 bot  
在 bot profile 里配置了 `wechat` 或 `feishu` channel，由 `mya serve` 托管。

`mya serve` 负责：

- 拉起所有可运行的 channel bot
- 写 pid / status / heartbeat
- 跑 scheduler
- 派发长任务
- 维护 audit / task registry

## Bot 配置文件

bot 的底层定义仍然是一份 profile：

```text
~/.mya/connect/hub/profiles/<bot-id>/profile.json
```

但产品上应把它理解成 bot，而不是“profile 系统”。

最常见目录：

- `profiles/<bot-id>/profile.json`
- `profiles/<bot-id>/BOT.md`
- `profiles/<bot-id>/channels/*.json`
- `tasks/registry.json`
- `runtime-status.json`
- `policies.json`
- `audit.log`

## 最小终端 bot

`mya bots add review-bot` 会生成类似这样的配置：

```json
{
  "profileId": "review-bot",
  "name": "review-bot",
  "channels": [],
  "defaultWorkspaceRoot": "/absolute/path/to/repo",
  "workspaceAllowlist": ["/absolute/path/to/repo"],
  "permissionMode": "default",
  "memoryPolicy": {
    "inheritanceMode": "profile",
    "scope": "bot"
  },
  "identity": {
    "status": "bootstrap",
    "role": "",
    "purpose": "",
    "style": ""
  }
}
```

新 bot 进入会话后，输入 `/whoru`，它会开始补全身份。
当 role / purpose / style 这些信息足够明确时，agent 会把它们回写到 `profile.json` 和 `BOT.md`，而不是只继续追问。

如果你想显式写回，也可以直接在 bot 会话里输入：

```text
/whoru set role="reviewer" purpose="Review risky PRs" style="brief and direct"
```

同时会自动生成：

```text
~/.mya/connect/hub/profiles/<bot-id>/BOT.md
```

这份文件就是 bot 专属的长期指令文件，作用类似这个 bot 自己的专属说明文件。适合写：

- 角色和职责
- 长期工作风格
- 默认边界和注意事项
- 固定流程偏好

## 最小渠道 bot

bot 的模型配置本质上就是：

- `baseUrl`
- `apiKey`
- `defaultModel`

只要 `baseUrl` 背后的服务支持 `POST /v1/messages`，这个 bot 就能接入。

一个最小飞书 bot：

```json
{
  "profileId": "review-bot",
  "name": "Review Bot",
  "defaultModel": "your-model",
  "baseUrl": "https://your-endpoint",
  "apiKey": "sk-...",
  "permissionMode": "plan",
  "defaultWorkspaceRoot": "/absolute/path/to/repo",
  "workspaceAllowlist": ["/absolute/path/to/repo"],
  "channels": [
    {
      "type": "feishu",
      "appId": "cli_review_app",
      "appSecret": "replace-me",
      "defaultWorkspaceRoot": "/absolute/path/to/repo"
    }
  ]
}
```

一个最小微信 bot：

```json
{
  "profileId": "ops-bot",
  "name": "Ops Bot",
  "defaultModel": "your-model",
  "baseUrl": "https://your-endpoint",
  "apiKey": "sk-...",
  "permissionMode": "plan",
  "defaultWorkspaceRoot": "/absolute/path/to/repo",
  "workspaceAllowlist": ["/absolute/path/to/repo"],
  "channels": [
    {
      "type": "wechat",
      "accountId": "ops-main",
      "defaultWorkspaceRoot": "/absolute/path/to/repo"
    }
  ]
}
```

## 微信和飞书怎么接到 bot 上

主产品路径是：

```bash
mya wechat login [bot]
mya feishu login [bot]
mya serve
```

规则：

- 不写 `[bot]` 时默认使用 `default`
- 微信全局只能绑定一个 bot
- 飞书不同 bot 可以各自绑定不同 `appId/appSecret`
- `mya serve` 会一次托管所有已经绑定好的 bot

底层仍然会把这些绑定写进各自 bot 的 `profile.json` 里，只是普通用户不需要手改。

## `mya bots`

`mya bots` 在交互终端里会打开一个 bot 列表，让你直接上下选择并进入对应 bot：

- `↑ / ↓` 选择
- `Enter` 进入
- `q / Esc` 退出

在非交互环境下，它会退化成纯列表输出，方便脚本使用。

## `mya serve`

### 启动

```bash
mya serve
```

### 行为说明

- 只会托管配置了 channel 的 bot
- 纯终端 bot 不会被 `serve` 拉起
- supervisor 在后台运行，不是前台长跑
- 状态以 `runtime-status.json` + heartbeat 为准

### 排障命令

如果要排障，仍然可以用：

```bash
mya serve status
mya serve restart
mya serve logs
mya serve stop
```

## 渠道里的系统命令

微信和飞书里这些命令不会发给 bot，而是由运行时直接处理：

- `/mya status`
  返回 bot 工作状态面板，重点看当前是否正在运行、有没有卡住、最近做到哪一步
- `/mya message`
  返回最近会话摘要
- `/mya stop`
  立即停止当前 turn，语义接近终端里的 `Esc`
- `/mya approve`
  通过当前等待中的权限请求
- `/mya reject`
  拒绝当前等待中的权限请求

`/mya status` 现在显示的是工作状态，不是聊天历史。面板里的 `BACKGROUND` 只统计后台调度任务，不包含眼前这条前台 turn。

## 定时唤醒

bot 可以通过 `wakePolicy` 自动醒来。

创建步骤：

1. 打开这个 bot 的 `profile.json`
2. 在 `wakePolicy.schedules` 中新增一条规则
3. 常用字段：
   `cron`、`prompt` 或 `command`、`workspaceRoot`、`taskType`、`metadata`
4. cron 按本地时间匹配
5. 保存后执行 `mya serve restart`
6. 任务完成后，结果会主动推送回这个 bot 最近活跃的微信或飞书会话

示例：

```json
{
  "profileId": "mail-bot",
  "wakePolicy": {
    "schedules": [
      {
        "id": "daily-mail-report",
        "cron": "0 9 * * *",
        "command": "cd /absolute/workspace/path/mail_service && python3 on_wake.py",
        "workspaceRoot": "/absolute/workspace/path",
        "taskType": "scheduled_job",
        "metadata": {
          "source": "mail-report"
        }
      }
    ]
  }
}
```

如果这是邮件类定时任务，建议把汇报标准固定成：

1. 先说明扫描范围和筛选结果
2. 按重要程度逐封说明重点邮件
3. 每封邮件至少交代：发件人、主题、时间、为什么重要、截止时间或时间要求、需要采取的动作
4. 如果正文里有关键细节、附件、链接、课程安排、缴费、作业或会议要求，要明确写出来
5. 如果没有重点邮件，也要说明为什么无需处理

`mya serve` 会读取这些规则并把它们派发成后台任务。
任务完成后，如果这个 bot 最近在微信或飞书里有活跃会话，摘要会主动推送回对应渠道。

## 隔离逻辑

现在隔离边界是 bot，而不是单纯 workspace。

审批记忆 / session / memory / inbox 至少按这些维度组合隔离：

- `profileId`
- `channel`
- `accountId`
- `senderId`
- `workspaceRoot`

这意味着同一个 repo 上不同 bot、不同人不会互相继承审批放权。

## 高级恢复

任务恢复仍然保留高级入口，但不再是主命令面的一部分。

兼容用法：

```bash
mya connect hub tasks list
mya connect hub tasks resume <taskId>
```

如果你只是普通使用者，可以忽略这层，继续优先使用原生 `/tasks` 和 `--resume`。
