# mya connect

`mya connect` 是 `mya` 内置的多渠道桥接层，不是单独面向用户安装的第二个产品。

当前支持：

- `wechat`：微信扫码桥接
- `feishu`：飞书自建应用机器人桥接

链路形态：

- `微信 App -> mya connect wechat -> 本地 mya`
- `飞书 App -> mya connect feishu -> 本地 mya`

## 在仓库内开发

这个目录作为 `mya` 仓库内的 bundled connector 子工程存在。正常使用时，直接从仓库根目录运行：

```bash
./bin/mya connect wechat login
./bin/mya connect wechat start
./bin/mya connect feishu check
./bin/mya connect feishu start
```

如果你在开发这个子工程本身，再在这里安装依赖：

```bash
npm install
```

## 命令

```bash
mya connect wechat migrate
mya connect wechat login
mya connect wechat start
mya connect wechat accounts

mya connect feishu check
mya connect feishu start
```

## 配置

先复制模板：

```bash
cp connect/.env.example connect/.env
```

默认通过系统里的 `mya` 命令回调主 CLI，所以通常不需要修改：

- `MYA_CONNECT_WECHAT_MYA_COMMAND`
- `MYA_CONNECT_FEISHU_MYA_COMMAND`

### 微信

最关键的环境变量：

- `MYA_CONNECT_WECHAT_DEFAULT_WORKSPACE`
- `MYA_CONNECT_WECHAT_PERMISSION_MODE`
- `MYA_CONNECT_WECHAT_ACCOUNT_ID`

默认状态目录：

```text
~/.mya-connect/wechat/
```

默认行为：

- 首次执行 `mya connect wechat ...` 时，会自动尝试把旧版 `~/.mya-wechat` 状态导入到 `~/.mya-connect/wechat`
- 如果你想手动检查或重复执行迁移，可以运行 `mya connect wechat migrate`
- 同一个微信号重复扫码登录时，旧账号记录会保留
- 如果本地保存了多个微信账号，而你没有设置 `MYA_CONNECT_WECHAT_ACCOUNT_ID`，会默认使用最近一次登录的账号

微信附件行为：

- 私聊里直接发图片或文件，会自动保存到当前项目的 `.my_agent/inbox/wechat/...`
- 群聊里只有带 `/mya ...` 的消息才会把附件带进当前 turn
- `/mya send <相对文件路径>` 会把项目内本地图片或文件回传到微信

### 飞书

最关键的环境变量：

- `MYA_CONNECT_FEISHU_APP_ID`
- `MYA_CONNECT_FEISHU_APP_SECRET`
- `MYA_CONNECT_FEISHU_DEFAULT_WORKSPACE`
- `MYA_CONNECT_FEISHU_PERMISSION_MODE`

默认状态目录：

```text
~/.mya-connect/feishu/
```

飞书当前推荐形态：

- 企业自建应用
- 开启机器人能力
- 开启事件订阅
- 使用长连接接收事件
- 订阅 `im.message.receive_v1`

飞书附件行为：

- 私聊图片/文件自动保存到 `.my_agent/inbox/feishu/...` 并进入当前 turn
- 群聊附件需要 `@mya` 或 `/mya ...` 才会进入当前 turn
- `/mya send <相对文件路径>` 把当前项目目录内的本地图片或文件回传到飞书聊天

## 设计取向

- 对外只暴露一个安装入口：`mya`
- 通道入口统一挂在 `mya connect`
- 内部继续按 channel 分开：`wechat`、`feishu`
- 这部分组织方式借鉴了 `openclaw`，但底层执行仍然直接回到本地 `mya`
