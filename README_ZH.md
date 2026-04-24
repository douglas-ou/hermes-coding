# hermes-coding

[English](README.md) | [中文](README_ZH.md)

**描述你要构建什么，得到可运行、有测试、已提交的代码。**

hermes-coding 是一个 AI 编程工具，通过引导式的 4 阶段循环将自然语言需求转化为生产就绪的代码：澄清 → 分解 → 实现 → 交付。

[![npm version](https://img.shields.io/npm/v/hermes-coding.svg)](https://www.npmjs.com/package/hermes-coding)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## 快速开始

```bash
# 1. 安装 CLI
npm install -g hermes-coding

# 2. 在项目中初始化
cd your-project
hermes-coding init

# 3. 启动 Claude Code，开始一个会话
/hermes-coding "通过邮件添加密码重置功能"
```

当工作流进入实现阶段后，在终端中运行循环：

```bash
hermes-coding loop
```

就这些。hermes-coding 会处理剩余的一切——任务、测试、git 提交和拉取请求。

---

## 工作原理

```
澄清  →  分解  →  实现  →  交付
```

| 阶段 | 发生了什么 |
|------|-----------|
| **澄清** | 结构化问答梳理需求，生成 PRD |
| **分解** | 将 PRD 拆分为带依赖关系的原子任务（每个 < 30 分钟） |
| **实现** | `hermes-coding loop` 逐个运行任务，先写测试，失败时自动修复 |
| **交付** | 质量门控（lint、类型检查、测试），然后创建 git 提交 + 拉取请求 |

每个任务都在**全新的代理上下文**中运行，保持实现聚焦并避免上下文偏移。

---

## 命令

### 在 Claude Code 中

| 命令 | 描述 |
|------|------|
| `/hermes-coding "<需求>"` | 开始新的开发会话 |
| `/hermes-coding resume` | 恢复进行中的会话 |
| `/hermes-coding status` | 显示当前阶段和任务进度 |
| `/hermes-coding cancel` | 放弃当前会话 |

### 在终端中

```bash
hermes-coding loop              # 运行实现循环（Claude Code 交接后使用）
hermes-coding state get         # 以 JSON 格式显示当前状态
hermes-coding tasks list        # 列出所有任务及其状态
hermes-coding tasks next        # 显示下一个可执行的任务
hermes-coding tasks get <id> --prompt  # 获取任务详情作为实现者提示词
hermes-coding progress append   # 将学习记录追加到项目或任务进度文件
hermes-coding init              # 复制技能 + 创建 pre-commit 钩子
hermes-coding detect            # 检测项目语言和框架
hermes-coding update            # 更新到最新版本
```

---

## 安装

### 前置要求

- [Claude Code](https://claude.ai/code)（最新版本）
- Node.js >= 18
- npm >= 9
- 一个 git 仓库

### 步骤

**1. 全局安装 CLI**

```bash
npm install -g hermes-coding
```

**2. 初始化项目**

每个项目执行一次，将技能复制到 `.claude/skills/` 并设置 pre-commit 钩子：

```bash
cd your-project
hermes-coding init
```

**3. 启动 Claude Code，运行第一个会话**

```bash
/hermes-coding "构建用户管理 REST API"
```

---

## 核心功能

**默认测试驱动** — 每个任务在实现前先写失败的测试。任何任务开始前必须通过基线测试。

**自愈能力** — 失败的任务会自动通过网络搜索调查并打补丁。基线测试在每个任务前通过内置的 baseline-fixer 技能自动修复。

**语言自动检测** — 从项目文件中检测技术栈，自动配置验证命令。

**自动更新** — 每次命令执行时检查新版本（缓存 24 小时）。运行 `hermes-coding update` 手动升级。

**状态持久化** — 所有状态保存在 `.hermes-coding/` ，会话在重启和上下文重置后依然可以恢复。

---

## 工作区结构

第一个会话完成后：

```
your-project/
└── .hermes-coding/
    ├── state.json          # 阶段 + 任务状态（由 CLI 管理）
    ├── prd.md              # 生成的产品需求文档
    ├── progress.txt        # 跨任务学习日志
    ├── context/            # 提取的上下文（决策、计划等）
    ├── tasks/
    │   ├── index.json      # 任务索引
    │   ├── auth/
    │   │   ├── login.md
    │   │   └── logout.md
    │   └── setup/
    │       └── scaffold.md
    ├── drafts/             # 阶段 2 草稿文件（持久化前）
    └── e2e-evidence/       # E2E 任务的截图证据
```

推荐添加到 `.gitignore`：

```
.hermes-coding/state.json
.hermes-coding/debug.log
.hermes-coding/drafts/
```

将任务定义和 PRD 保留在版本控制中：

```
!.hermes-coding/prd.md
!.hermes-coding/tasks/**/*.md
```

---

## 故障排除

**技能未加载**
```bash
hermes-coding init   # 重新将技能复制到 .claude/skills/
/clear
```

**找不到 CLI**
```bash
npm list -g hermes-coding      # 验证安装
npm install -g hermes-coding   # 如缺失则重新安装
```

**会话卡住**
```bash
hermes-coding state get        # 查看当前所处阶段
hermes-coding tasks list       # 查看任务状态
hermes-coding state clear      # 重置（最后手段）
```

**Node.js 版本不匹配**
```bash
node --version   # 必须 >= 18
npm --version    # 必须 >= 9
```

---

## 贡献

- **Bug 报告** — [GitHub Issues](https://github.com/douglas-ou/hermes-coding/issues)
- **功能请求** — [GitHub Discussions](https://github.com/douglas-ou/hermes-coding/discussions)
- **PR** — Fork 仓库，创建功能分支，添加测试，使用语义化提交

---

## 灵感来源与致谢

- [superpowers](https://github.com/obra/superpowers) — Claude Code 的技能和代理工作流
- [ralph](https://github.com/snarktank/ralph) — 基于规格驱动的自主 AI 编程代理
- [ralph-dev](https://github.com/mylukin/ralph-dev) — Ralph 的 Claude Code 插件，支持循环驱动实现

---

## 许可证

MIT — 详见 [LICENSE](LICENSE)。
