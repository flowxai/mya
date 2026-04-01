```bash
cd /absolute/path/to/repo
npm --prefix ./connect install
cp ./connect/.env.example ./connect/.env
```

如果你通过 `./bin/mya` 或安装后的 `mya` 运行，一般不需要再改主二进制路径。默认就是：

```text
MYA_CONNECT_WECHAT_MYA_COMMAND=mya
MYA_CONNECT_FEISHU_MYA_COMMAND=mya
```

微信：

```bash
./bin/mya connect wechat migrate
./bin/mya connect wechat login
./bin/mya connect wechat start
```

私聊里直接发图片或文件即可；群里则带 `/mya ...` 再发附件。

飞书：

```bash
./bin/mya connect feishu check
./bin/mya connect feishu start
```

飞书私聊可直接发图片或文件；群聊需要 `@mya` 或 `/mya ...` 再发送附件。
