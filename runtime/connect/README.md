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

这份文件就是 bot 专属的长期指令文件，作用类似这个 bot 自己的 `CLAUDE.md`。适合写：

- 角色和职责
- 长期工作风格
- 默认边界和注意事项
- 固定流程偏好

## 最小渠道 bot

一个最小飞书 bot：

```json
{
  "profileId": "review-bot",
  "name": "Review Bot",
  "defaultModel": "sonnet",
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

`mya bots` 现在只做一件事：列出现有 bot。

它会显示：

- bot id
- workspace
- identity 状态
- channel 列表

例如：

```text
- review-bot
  workspace: /path/to/repo
  identity: bootstrap
  channels: terminal-only
```

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

## 定时唤醒

bot 可以通过 `wakePolicy` 自动醒来。

示例：

```json
{
  "profileId": "review-bot",
  "wakePolicy": {
    "schedules": [
      {
        "id": "review-prs",
        "cron": "0 9 * * *",
        "prompt": "检查新的 PR，列出主要风险和建议。"
      }
    ]
  }
}
```

`mya serve` 会读取这些规则并把它们派发成后台任务。

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
