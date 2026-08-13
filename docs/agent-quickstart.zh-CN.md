# Agent-first 快速开始

[English](agent-quickstart.md) | [简体中文](agent-quickstart.zh-CN.md)

这是使用 RelayPact 的推荐方式：协调 Agent 负责准备有明确边界的任务
和私有资料，人类批准关键权限并保留最终控制权。

插件提供委派约束、隔离、证据和验收机制；执行来自用户现有 Codex CLI 中的独立
`codex exec` 进程，不需要安装第二套 Codex 或单独的 executor package。

需要精确命令和 JSON 字段时，请查阅
[手工配置与 CLI 参考](manual-configuration.md)。

## 人类通常需要提供什么

通常只需要提供：

- 目标 Git 仓库；
- 工程目标；
- 不可妥协的路径、测试、风险限制或停止条件；
- 对关键范围和路线选择的批准；
- 确认所需的 host 管理凭据已经可用；
- 对最终验收和后续 patch 应用的单独决定。

不要把 provider 凭据粘贴到提示词中，也不要要求 executor 自行寻找秘密或扩大权限。

## 让协调 Agent 完成安装

插件尚未安装时，把下面的提示词交给 Codex：

```text
请在 v0.1.1 发布后，把 https://github.com/echopath-labs/relaypact 的
版本化 release tag 克隆到目标仓库之外的本地工具目录。该 tag 只是受信任官方仓库
中的版本选择器，不是独立的密码学保证。必须要求 clone 成功退出，并验证 HEAD 与
annotated v0.1.1 tag peel 后得到的 commit 完全一致。浅克隆 annotated tag 时可能
输出 warning；不能只凭 warning 文本判断成功或失败。如果我另行提供了从可信渠道获得的完整
commit SHA，必须在安装前精确匹配。读取 README 和最近的 AGENTS.md，
验证 Codex CLI 不低于 0.147.0 且 `codex exec` 可用，通过 local marketplace
安装根 Agent Plugin，然后运行安装后 Skill 的 `support` 和 `doctor`。向我报告
CLI 版本、`codex exec`、plugin 与 Skill discovery、Codex-to-Codex readiness
及剩余配置。所有临时状态必须位于目标仓库之外。不要读取凭据、连接 provider、
启动 executor，也不要 commit、push、tag、发布或部署。
```

Agent 应执行等价的底层命令：

```bash
set -e
git clone --branch v0.1.1 --depth 1 \
  https://github.com/echopath-labs/relaypact.git
checkout_commit="$(git -C relaypact rev-parse HEAD)"
release_commit="$(git -C relaypact rev-parse 'v0.1.1^{}')"
test "$checkout_commit" = "$release_commit"
codex plugin marketplace add /absolute/path/to/relaypact --json
codex plugin add relaypact@relaypact-local --json
codex plugin list --marketplace relaypact-local --json
```

安装后新建一个 Codex 任务，使打包的 Skill 出现在新任务的 Skill 列表中。

## 从任务意图开始委派

在新任务中使用：

```text
请使用 $relaypact 委派一个有明确边界的工程任务。

目标仓库：<绝对路径>
目标：<明确的预期结果>
重要限制：<路径、测试、风险限制或无>

先检查支持状态和目标仓库最近的 Agent 指令。启动 executor 前，请先展示：
1. coordinating host 与 executor 的身份；
2. 建议的可读、可写和禁止路径；
3. 验证命令与超时时间；
4. 选中的 Codex worker profile，以及它属于 native、direct-provider 还是
   optional-router；
5. 位于仓库之外的私有 envelope/profile/state/archive 路径；
6. 所有需要人类授权的问题。

请替我准备不含凭据的 envelope 和 profile 元数据。不得在任何文件中存储秘密
或个人代理值。不得静默扩大上下文、替换 execution harness，或 fallback 到其他
模型/provider。Worker 完成后，独立审查实际 diff、范围证据、验证结果和剩余风险。
没有单独授权时，不要 accept、应用 patch、commit、push、tag、发布或部署。
```

## Agent 应经过的检查点

### 1. 支持状态与仓库 preflight

Agent 解析已安装的 Skill-local wrapper，并执行 `support` 与 `doctor`；这些步骤
不会加载 Pi、provider 或 worker。它应区分静态支持状态与本机 readiness，再找到
目标 Git root，读取最近的 `AGENTS.md` 或同类指令，并拒绝没有被明确确认的脏工作树。

### 2. 范围与上下文建议

Agent 必须区分：

- `readablePaths`：executor 可以读取的上下文；
- `allowedPaths`：executor 可以修改的文件；
- `forbiddenPaths`：明确禁止的路径；
- host validation：执行完成后由 host 以参数数组方式独立运行的验证。

只读文件应放入 `readablePaths`、从 `allowedPaths` 中省略，并且不能同时被
`forbiddenPaths` 匹配。可读权限不等于可写权限。执行开始后如果需要改变上下文，必须创建新任务身份，
不能在 correction 中静默扩大范围。

### 3. 路线选择

首个公开预览路线始终保留 Codex harness：

- **Native Codex profile**：使用经过选择的最小 Codex 配置投影，以及选定 CLI
  profile 已具备的 host 管理 Codex 认证；
- **Direct Responses provider**：使用兼容的 `/v1` Responses endpoint 与命名的
  凭据环境变量；
- **Optional loopback router**：使用显式配置的本地路线与健康检查。

Pi、OpenCode CLI、OpenCodex、其他 provider 或模型永远不会成为自动 fallback。
可选的 OpenCode Go / GPT-5.6 Luna 测试 profile 见
[provider 指南](opencode-go-luna.md)。

### 4. 私有资料准备

Agent 在目标仓库之外、由 host 批准的私有目录中创建 envelope、profile、task
state 和 review archive。Profile 只记录凭据环境变量的名称，绝不能记录凭据值。
State 和 archive root 必须是预先存在的真实目录；支持时应使用 `0700` 权限。

### 5. 执行与审查

Executor 在脱敏 task capsule 中运行。它返回的 structured result 只是自我报告。
Coordinating host 还必须独立检查：

- 实际 changed paths 和 candidate patch；
- source 与 capsule baseline 是否一致；
- ignored、index-hidden、Git-control 与 filesystem 证据；
- scope breach；
- host-controlled validation；
- 凭据证据安全；
- 剩余风险和 lifecycle identity。

Agent 应先解释这些证据，再给出决策选项。

Review metrics 会将 `relaypactPromptBytes`、
`relaypactResultSchemaBytes`、`relaypactDeclaredInputBytes`、选中上下文字节与
provider 报告的 token 分开记录。RelayPact 字节数只覆盖它实际提供的 prompt 和
生成的 result schema，不是 token、额度、费用、隐藏 harness 输入或额外开销估算。

### 6. 终态决策

- `accept`：当前证据具备资格，host 同意候选结果；
- `reject`：候选结果不可接受；
- `abandon`：关闭任务但不接受结果。

每个终态决策都会重新构建权威证据，并保存到私有 archive。即使 `accept` 也不会
把 patch 应用到源码仓库。Patch 应用、commit、push、tag、GitHub Release、包发布
和部署始终是单独动作。

验收后可使用一个单独提示词：

```text
本次委派已经 accept。请重新读取归档的 candidate patch，确认其 evidence identity
与已验收记录一致，并说明准备应用的全部文件，然后等待我的单独授权。现在不要应用
patch、commit 或 push。
```

独立 executor 会产生自己的模型请求，可能额外消耗额度或费用。私有 archive 可能
包含源码 patch 和审查证据，保存周期和删除策略由用户决定。

## Correction 还是新任务

只有当修复仍处于原来的 scope、context identity、路线和风险边界内时，才使用
same-session correction。如果可读权限、可写路径、provider 路线、harness 或关键
需求发生变化，应创建新任务。

## 失败处理

| 失败 | Agent 应如何处理 |
| --- | --- |
| 凭据不可用 | 在 worker 启动前停止，只询问命名的 host 凭据能否提供。 |
| Provider 或模型不兼容 | Fail closed；重新核对 provider 官方文档，必要时创建新的已批准路线。 |
| Stream disconnected | 区分 transport health 与任务大小，不要盲目增加 retry 或替换 harness。 |
| Context gap | 报告缺少的仓库相对上下文；权限获批后创建新的有界任务。 |
| Scope breach | 将证据标记为不具备资格，并保存恢复证据。 |
| Validation failure | 不得 accept；在原权限内 correction，或创建新任务。 |
| Stale review | 重新构建证据，不能强制使用过期状态完成终态决策。 |

威胁边界见 [SECURITY.md](../SECURITY.md)，精确恢复命令见
[手工配置参考](manual-configuration.md)。

## 这个流程不会自动做什么

RelayPact 不会替用户决定产品需求、提供凭据、批准更大权限、应用 patch、
commit、push、tag、发布 Release、发布包或部署。这些始终是明确的 host 或人类动作。

本软件使用 [Apache License 2.0](../LICENSE)（`Apache-2.0`）。
