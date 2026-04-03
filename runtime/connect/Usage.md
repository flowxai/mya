# Advanced Usage

这份文档专门讲三件事：

- 怎么把 bot 从终端 bot 升级成 channel bot
- 怎么给 bot 配多个 channel
- 怎么给 bot 配 schedule 和长任务

## 1. 从终端 bot 开始

先创建一个最小 bot：

```bash
mya bots add review-bot
```

进入会话后先做 bot onboarding：

```text
/whoru
```

这一步会帮你补 bot 的身份、职责和风格。

## 2. 把 bot 接到飞书

主产品路径：

```bash
mya feishu login review-bot
mya serve
```

`mya feishu login review-bot` 会把这一个 bot 专属的：

- `appId`
- `appSecret`

写回它自己的 `profile.json`。

如果你只是想排障，仍然可以额外用：

```bash
mya feishu check
```

## 3. 把 bot 接到微信

主产品路径：

```bash
mya wechat login ops-bot
mya serve
```

微信和飞书不一样：

- 微信全局只能绑定一个 bot
- `mya wechat login ops-bot` 会把当前微信入口切换到 `ops-bot`

如果你要看已经保存的微信账号，仍然可以用：

```bash
mya wechat accounts
```

## 4. 一个 bot 挂多个 channel

同一个 bot 可以同时挂微信和飞书：

```json
{
  "profileId": "ops-bot",
  "name": "Ops Bot",
  "defaultWorkspaceRoot": "/workspace/ops",
  "workspaceAllowlist": ["/workspace/ops"],
  "channels": [
    {
      "type": "wechat",
      "accountId": "ops-main",
      "defaultWorkspaceRoot": "/workspace/ops"
    },
    {
      "type": "feishu",
      "appId": "cli_ops_app",
      "appSecret": "replace-me",
      "defaultWorkspaceRoot": "/workspace/ops"
    }
  ]
}
```

## 5. 多个 bot

多个 bot 的典型做法是：

- `review-bot`
- `ops-bot`
- `pm-bot`

它们各自都有一份：

```text
~/.mya/connect/hub/profiles/<bot-id>/profile.json
```

你不需要额外启动多个进程；一个 `mya serve` 就会统一托管所有带 channel 的 bot。

查看现有 bot：

```bash
mya bots
```

移除 bot：

```bash
mya bots remove pm-bot
```

## 6. 定时唤醒

给 bot 增加 `wakePolicy.schedules`：

```json
{
  "profileId": "review-bot",
  "wakePolicy": {
    "schedules": [
      {
        "id": "daily-review",
        "cron": "0 9 * * *",
        "prompt": "检查昨天以来的新 PR，总结风险和建议。"
      }
    ]
  }
}
```

`mya serve` 会自动读取这些 schedule，并在命中时派发后台任务。

## 7. 事件唤醒

如果你不想用 cron，也可以让 bot 读取外部事件文件。

常见思路是：

- 外部系统把事件写到某个文件
- `wakePolicy.event_file` 指向这个文件
- `mya serve` 周期性读取并转成任务

如果你现在只是想先跑通，优先用 `schedules`，比 event file 更简单。

## 8. 长任务和恢复

后台调度出的任务会进 task registry。

普通用户日常可以忽略它；如果要做 operator 排障，再用兼容入口：

```bash
mya connect hub tasks list
mya connect hub tasks resume <taskId>
```

而单会话里的恢复，仍然优先用原生 `--resume` 和 `/tasks`。

## 9. 渠道里的状态和停止

在微信或飞书里，优先用这些系统命令：

- `/mya status`
  看 bot 当前工作状态，而不是聊天历史
- `/mya message`
  看最近摘要
- `/mya stop`
  立即停止当前 turn

如果需要后台排障，再回到主机侧使用：

```bash
mya serve status
mya serve logs
```

## 10. 附件落盘逻辑

微信 / 飞书的图片和文件会先落到当前工作区：

```text
.mya/inbox/<profile-id>/<channel>/<conversation-id>/
```

然后再作为本地文件路径喂给 `mya`。

这意味着：

- `mya` 只面对本地文件
- bot 间附件天然按 `profile-id` 隔离

## 11. 什么时候不需要这些高级配置

如果你只是：

- 在终端里用 `mya`
- 偶尔起一个 bot
- 不需要自动唤醒
- 不需要多 channel

那你完全可以只记：

```bash
mya
mya bots add <name>
/whoru
```

剩下这些 runtime 细节都可以先忽略。
