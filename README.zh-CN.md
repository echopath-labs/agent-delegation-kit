# RelayPact

[English](README.md) | [简体中文](README.zh-CN.md)

RelayPact 让协调 Agent 能够把边界明确的工程任务委派给独立执行
Agent，同时保留对范围、证据、风险判断和最终验收的控制。

首个公开预览路线是 **Codex → Codex**：Codex 负责协调和审查，另一个可区分
的 Codex Agent Instance 负责执行；在兼容的模型与 provider 路线中继续保留
Codex harness。

RelayPact 提供委派流程、范围约束、执行隔离、证据收集和验收生命周期；
真正执行任务的是用户机器上现有 Codex CLI 提供的独立 `codex exec` 进程。用户
不需要安装第二套 Codex，也不需要单独安装 executor package。仅安装 Codex
Desktop 不能证明 shell 已能调用兼容 CLI，因此安装时会同时验证
`codex --version` 和 `codex exec --help`。

不需要额外安装 executor。

> 英文 `README.md` 是规范性内容的默认版本；如中英文出现冲突，以英文版本为准。

## 为什么需要它

多 Agent 开发最容易在交接处失效：上下文不完整、写入权限含糊、把执行成功误当
成验收通过，或无法独立核对结果。RelayPact 将这个过程结构化为：

- 明确可读、可写和禁止路径的 task envelope；
- 脱敏的任务 capsule 与可区分的执行 Agent 身份；
- 由 host 独立观测的 Git、文件系统、验证与越界证据；
- 感知凭据的结果与 patch 处理；
- 执行结束后由 host 或人类明确验收。

执行器完成任务永远不等于最终验收通过。

## 当前状态

版本 **0.1.0** 是受控、由人类审查的 Public Preview 候选版本，不适合无人值守
或生产关键任务。

| Adapter | Execution harness | 状态 | Root Skill |
| --- | --- | --- | --- |
| `codex-codex` | Codex | `public-preview` | active |
| `codex-pi` | Pi | `experimental` | inactive |

如有冲突，以 [`support-matrix.json`](support-matrix.json) 为准。默认的
Codex-to-Codex 路线不要求安装 Pi、OpenCode CLI、OpenCodex，不绑定第三方
provider 或特定模型。

当前已验证的发布环境包括：

- Node.js 20 或更高版本；
- Git；
- Codex CLI 0.147.0 或更高版本；
- macOS 本地验证；仅当完全一致的发布候选通过公开 GitHub Actions workflow 后，
  才确认该版本的 Ubuntu 验证结果。

暂不声明支持 Windows。

## Agent-first 快速开始

推荐让 Codex 安装和使用插件，再由安装后的 Skill 准备私有配置。你只需要说明
目标并批准关键权限，不需要手工编写任务 JSON。

### 1. 让 Codex 安装并验证插件

把下面的提示词交给一个协调 Codex：

```text
请在 v0.1.0 发布后，把 https://github.com/echopath-labs/relaypact 的
版本化 release tag 克隆到目标仓库之外的本地工具目录。该 tag 只是受信任官方仓库
中的版本选择器，不是独立的密码学保证。如果我另行提供了从可信渠道获得的完整
commit SHA，必须在安装前精确匹配。验证 Codex CLI 版本不低于 0.147.0
并确认 `codex exec` 可用，通过仓库自带的 local marketplace 安装根 Agent
Plugin，再执行安装后 Skill-local 的 `support` 和 `doctor` 命令。向我报告
Codex CLI 版本、`codex exec` 可用性、plugin 与 Skill discovery、
Codex-to-Codex readiness 和剩余配置。不要读取或复制凭据，不要配置 provider、
启动 executor、commit 或发布任何内容。
```

安装完成后，新建一个 Codex 任务，让新安装的 Skill 生效。

### 2. 让安装后的 Skill 执行委派

```text
请使用 $relaypact 委派下面这个有明确边界的工程任务。

目标仓库：<绝对路径>
目标：<需要完成的改动>

开始前先检查支持状态，并读取目标仓库最近的 Agent 指令。先向我展示建议的
可读路径、可写路径、禁止路径、验证命令、worker 路线，以及私有 state/archive
目录，再开始执行。所有 envelope 或 profile 元数据只能写入目标仓库之外的私有
目录，绝不能把凭据写入这些文件。如果权限、路线、验证或最终验收存在关键歧义，
先停下来由我决定。没有单独授权时，不要应用 patch、commit、push、tag、发布
或部署。
```

随后 Agent 应当：

1. 检查路线支持和仓库指令；
2. 提出最小任务范围与验证边界；
3. 准备不含凭据的私有任务资料；
4. 关键选择明确后才启动独立 Codex executor；
5. 审查实际 diff、范围证据、验证结果与剩余风险；
6. 给出明确的 `accept`、`reject` 或 `abandon` 选择，但不会自动应用 patch。

完整流程见[中文版 Agent-first 教程](docs/agent-quickstart.zh-CN.md)。调试或自动化
开发者可以使用[手工配置与 CLI 参考](docs/manual-configuration.md)。

## 底层安装命令

如果 Agent 需要精确命令，应使用：

```bash
git clone --branch v0.1.0 --depth 1 \
  https://github.com/echopath-labs/relaypact.git
codex plugin marketplace add /absolute/path/to/relaypact --json
codex plugin add relaypact@relaypact-local --json
codex plugin list --marketplace relaypact-local --json
```

安装后，Skill-local `support` 报告静态路线合同，`doctor` 在不读取认证、不连接
provider、不启动 worker 的前提下检查本机 runtime 与 plugin readiness。独立
`codex exec` 会产生独立模型请求，可能额外消耗额度或费用。

项目使用 Agent Plugins 1.0 根目录 `plugin.json`，有意不提供
`.codex-plugin/plugin.json`，也不包含 MCP server。

## Route、harness 与 provider

Execution harness 负责 Agent loop、工具、上下文、权限和结果行为；模型、provider、
代理、router 或协议 bridge 是独立的路线配置。

- 独立 `codex exec` 使用兼容外部 provider 时，仍然属于 Codex harness。
- OpenCode CLI worker 即使使用相同模型，也属于 OpenCode harness。
- 路线失败时会 fail closed，不会静默替换为 Pi、OpenCode、其他 provider 或模型。

可选的 OpenCode Go / GPT-5.6 Luna 测试路线保留 Codex harness，而且不要求
OpenCodex。它只代表兼容性证据，不代表可用性保证。详见
[OpenCode Go / GPT-5.6 Luna](docs/opencode-go-luna.md)。

## 安全边界

- 凭据只保留在 host 管理的环境变量或用户配置中，不能进入 task envelope 或
  提交到仓库的示例。
- Executor 只能获得任务范围内的上下文与明确授权。
- Host validation 与独立观测的仓库证据共同决定是否具备验收资格。
- 已验收证据保存在私有 archive 中；工具不会把候选 patch 自动复制到源码仓库。
- Commit、push、tag、GitHub Release、包发布和部署始终是单独的动作。
- 本预览版不是操作系统级安全沙箱。处理不受信任的代码或凭据前请阅读
  [SECURITY.md](SECURITY.md)。

## 文档

- [Agent-first 教程](docs/agent-quickstart.zh-CN.md)
- [Agent-first tutorial — English](docs/agent-quickstart.md)
- [手工配置与 CLI 参考](docs/manual-configuration.md)
- [端到端示例](examples/README.md)
- [Codex-to-Codex adapter 参考](packages/adapter-codex-codex/README.md)
- [OpenCode Go / Luna provider 路线](docs/opencode-go-luna.md)
- [安全策略与威胁边界](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [发布清单](RELEASING.md)

## 开发验证

运行全部离线确定性检查：

```bash
npm run check
```

只验证首个公开预览路线：

```bash
npm run check:codex-codex
```

真实 Codex、Pi、router 和 provider smoke 都需要显式开启，可能消耗本地资源或
账户额度，不属于默认确定性测试。

## 开源协议

RelayPact 使用 [Apache License 2.0](LICENSE)（`Apache-2.0`），归属信息见
[NOTICE](NOTICE)。
