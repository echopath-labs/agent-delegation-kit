# RelayPact

[English](README.md) | [简体中文](README.zh-CN.md)

RelayPact 让一个 Codex Agent Instance 把边界明确的工程任务委派给独立 Codex
executor，同时由协调 Codex 保留范围、证据审查、风险判断和最终验收权。

首个且唯一 active Public Preview 路线是 **Codex → Codex**。RelayPact 提供流程、
隔离、证据和验收约束；真正执行任务的是用户现有 Codex CLI 中的独立
`codex exec` 进程。不需要安装第二套 Codex 或单独的 executor package。

**不需要额外安装 executor。**

> 英文 `README.md` 是规范性默认版本；如中英文冲突，以英文为准。

## 发布状态

- Public source 版本：**0.1.1 release candidate**（`v0.1.1` 尚未发布，tag
  目前不存在）。
- 最新已发布版本：**v0.1.0**。
- 支持状态：`codex-codex` 是 `public-preview`；`codex-pi` 保持
  `experimental`、inactive。

以 [`support-matrix.json`](support-matrix.json) 为准。Pi、OpenCode CLI、
OpenCodex、第三方 provider 或特定模型都不是 Codex-to-Codex 的前置条件或
fallback。

这是由人类审查的预览版，不适合无人值守或生产关键任务。已验证前置条件包括
Node.js 20 或更高版本、Git、Codex CLI 0.147.0 或更高版本，并且
`codex --version` 与 `codex exec --help` 都可用。macOS 已完成本地验证；只有当
某个版本的精确候选通过公开 CI 后才声明该版本通过 Ubuntu 验证。暂不声明支持
Windows。

## 用 0.1.1 source candidate 在五分钟内开始

在 `v0.1.1` 发布前，用这个路径 dogfood 当前源码。`main` checkout 可变，因此
它仅是 **development-only** 安装，不是可复现 release 安装。

把下面的提示词交给一个协调 Codex：

```text
请从 main 分支克隆 https://github.com/echopath-labs/relaypact 到目标仓库之外的
本地工具目录。这是尚未发布的 0.1.1 development-source 安装，不是版本化 release。
记录精确 checkout commit，并确认 package.json 和 plugin.json 都报告 0.1.1。
读取 README.md 与最近的 AGENTS.md。验证 Node.js 20 或更高版本、Git、
Codex CLI 0.147.0 或更高版本和 `codex exec --help`。通过 local marketplace
安装根 Agent Plugin，不启动 worker，然后运行安装后 Skill-local 的 `support`
和 `doctor`。报告精确 checkout commit、版本、Plugin 与 Skill discovery、
Codex-to-Codex readiness 和剩余配置。不要读取凭据，也不要配置、调用、accept、
apply、commit、push、tag、publish、release 或 deploy 任何内容。
```

等价的 source 命令是：

```bash
git clone --branch main --depth 1 \
  https://github.com/echopath-labs/relaypact.git relaypact-0.1.1-source
cd relaypact-0.1.1-source
git rev-parse HEAD
node -e 'const p=require("./package.json"),q=require("./plugin.json"); if(p.version!=="0.1.1"||q.version!==p.version) process.exit(1)'
codex plugin marketplace add "$PWD" --json
codex plugin add relaypact@relaypact-local --json
codex plugin list --marketplace relaypact-local --json
```

安装后新建 Codex 任务，再继续阅读[5 分钟开始使用](docs/agent-quickstart.zh-CN.md)。
其中包含一个调用 `$relaypact` 的真实、有边界、只创建一个可审查文档文件的
首次委派。

## 安装最新已发布版本

目前唯一已发布版本是 `v0.1.0`：

```bash
git clone --branch v0.1.0 --depth 1 \
  https://github.com/echopath-labs/relaypact.git relaypact-v0.1.0
checkout_commit="$(git -C relaypact-v0.1.0 rev-parse HEAD)"
release_commit="$(git -C relaypact-v0.1.0 rev-parse 'v0.1.0^{}')"
test "$checkout_commit" = "$release_commit"
cd relaypact-v0.1.0
codex plugin marketplace add "$PWD" --json
codex plugin add relaypact@relaypact-local --json
codex plugin list --marketplace relaypact-local --json
```

官方仓库 tag 只是版本选择器，**不是独立的密码学保证**。只有通过另一个可信渠道
获得完整 commit SHA 时才做独立精确比对。不要把不存在的 `v0.1.1` tag 替换进
这条命令；[RELEASING.md](RELEASING.md) 定义了 release-time closeout。

## 一分钟理解生命周期

`completed` != `accept` != `apply`：

1. `completed` 是 executor 结果和候选证据，仍需独立 host 审查。
2. `accept` 是 host 或人类审查实际 patch、范围、验证、凭据安全和剩余风险后做出
   的明确终态决定；patch 此时仍未应用。
3. `apply` 是之后单独授权的源码修改，执行前还要重新核对 accepted archive 和
   当前 source base。

Commit、push、tag、GitHub Release、包发布和部署还是更进一步的独立动作。
RelayPact 永远不会从一个授权推断另一个授权。

## 安全与可观测性

- 凭据只保留在 host 管理的配置或环境授权中，不能进入 task envelope、示例或
  公开文档。
- Executor 只能获得声明的上下文和写权限。只读路径可读、不可写，也不能被禁止。
- 路线或上下文失败时 fail closed，绝不会静默 fallback 到 Pi、其他 harness、
  provider 或模型。
- Host review 会把 `relaypactPromptBytes`、`relaypactResultSchemaBytes`、
  `relaypactDeclaredInputBytes`、选中上下文字节与 provider token 分开记录；这些
  字段不是 token、额度、费用或隐藏 harness 开销估算。
- 独立 executor 会产生独立模型请求，可能额外消耗额度或费用。
- 本项目不是操作系统级安全沙箱。处理不受信任代码或凭据前请阅读
  [SECURITY.md](SECURITY.md)。

## 安装生命周期与文档

- [5 分钟开始使用](docs/agent-quickstart.zh-CN.md)
- [5-minute getting started](docs/agent-quickstart.md)
- [安装、版本验证、升级、卸载、排障与 CLI 参考](docs/manual-configuration.md)
- [Codex-to-Codex adapter 参考](packages/adapter-codex-codex/README.md)
- [示例](examples/README.md)
- [发布清单](RELEASING.md)
- [贡献指南](CONTRIBUTING.md)
- [NOTICE](NOTICE) 与 [Apache License 2.0](LICENSE)（`Apache-2.0`）

## 开发验证

```bash
npm run check:codex-codex
npm run check
```

默认测试是离线确定性测试。真实 Codex、Pi、router 和 provider smoke 必须显式
启用，并可能消耗本地资源或账户额度。
