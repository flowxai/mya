# mya

`mya` 是一个终端里的 AI 编码助手，基于这份整理后的 Claude Code 分叉构建，并内置 `mya connect` 多渠道桥接能力。

对外只保留一个主入口：

- `mya`
- `mya connect wechat ...`
- `mya connect feishu ...`

内部仍然分成两层：

- 核心 CLI：仓库根目录
- 渠道桥接：[`connect/`](./connect)

## 这份仓库提供什么

- 交互式终端编码助手
- 读写文件、运行命令、代码库导航、任务流处理
- 私有命名空间 `~/.my_agent` / `.my_agent`
- 微信扫码桥接
- 飞书自建应用桥接
- 图片/文件收发到渠道会话

## 快速安装

最新 release 一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/flowxai/mya/main/install.sh | bash
```

从源码仓库安装：

```bash
git clone https://github.com/flowxai/mya.git mya
cd mya
./install.sh
```

安装脚本会：

- 默认安装最新 GitHub release；在源码仓库里运行时则会从源码构建
- 自动准备 `mya` 主体和内置的 `mya connect`
- 如果本机有 Node.js 22+，会一并准备微信/飞书通道运行时
- 把 `mya` 链接到 `~/.local/bin/mya`

升级时直接运行：

```bash
mya update
```

### 依赖要求

- Bun >= 1.3.11
- macOS 或 Linux
- Node.js >= 22
  只在你要使用 `mya connect` 的微信/飞书桥接时必需

如果你后面把这个仓库单独发布到自己的地址，也可以继续保留 `install.sh` 作为远程安装入口；只需要把脚本里的默认仓库 URL 改成你自己的 `mya` 仓库。

## 手动构建

```bash
git clone https://github.com/flowxai/mya.git mya
cd mya

./scripts/bootstrap.sh
bun run build
```

如果你更喜欢走包脚本，也可以：

```bash
bun run setup
bun run build
```

## 运行

```bash
export ANTHROPIC_API_KEY="sk-ant-..."

# 交互模式
./bin/mya

# 单次提问
./bin/mya -p "hello"

# 渠道桥接
./bin/mya connect wechat login
./bin/mya connect wechat start
./bin/mya connect feishu check
./bin/mya connect feishu start
```

安装完成后，直接用系统命令：

```bash
mya
mya connect wechat start
mya connect feishu start
```

## `mya connect`

`mya connect` 是内置在仓库里的渠道桥接层，不是第二个单独产品。

当前支持：

- `wechat`
- `feishu`

详细配置和命令见：

- [`connect/README.md`](./connect/README.md)
- [`connect/Usage.md`](./connect/Usage.md)

## 项目结构

```text
bin/
  mya                  # 统一入口；普通命令转到 ./cli，connect 子命令转到 ./connect

connect/
  src/                 # 微信/飞书渠道桥接
  tests/               # connect 层测试

scripts/
  build.ts             # Bun 构建脚本

src/
  entrypoints/cli.tsx  # 核心 CLI 入口
  commands.ts          # Slash commands
  tools.ts             # 工具注册
  screens/REPL.tsx     # 主交互界面
```

## 开发命令

```bash
# 核心 CLI
bun run setup
bun run build
bun run build:dev
bun run build:dev:full

# bundled connect
npm --prefix ./connect run check
npm --prefix ./connect test
```

如果你是在源码仓库里开发，`bun run setup` 已经会把 `connect` 的依赖一起装好，不需要再单独执行 `npm --prefix ./connect install`。
