---
title: "AI Skill"
description: "安装并使用 LoggerJS AI skill，让 coding agent 直接完成 LoggerJS 接入。"
---

# AI Skill

LoggerJS 提供可安装的 AI skill，供 coding agent 使用。这个 skill 会指导 agent 选择 LoggerJS 包、按运行时新增 logger 模块、配置生产日志、从现有 logger 迁移，并在目标项目里完成验证。

当你希望 agent 直接把 LoggerJS 接入应用，而不是只阅读文档时，使用这个 skill。

## 安装

从 GitHub 仓库安装：

```bash
npx skills add jskits/loggerjs --skill loggerjs
```

安装到指定 agent：

```bash
npx skills add jskits/loggerjs --skill loggerjs --agent codex
npx skills add jskits/loggerjs --skill loggerjs --agent claude-code
```

不安装，单次使用：

```bash
npx skills use jskits/loggerjs --skill loggerjs
```

从本地 checkout 开发或测试：

```bash
npx skills add . --skill loggerjs
npx skills use . --skill loggerjs
```

## 包含内容

- `skills/loggerjs/SKILL.md`：接入或迁移 LoggerJS 的主流程。
- `skills/loggerjs/references/package-selection.md`：包和运行时选择规则。
- `skills/loggerjs/references/runtime-recipes.md`：Node、浏览器、library、pretty、OpenTelemetry 和 Sentry 配方。
- `skills/loggerjs/references/production-checklist.md`：隐私、可靠性、生命周期、性能和 vendor 投递护栏。
- `skills/loggerjs/references/migration.md`：从 console、pino、winston、loglevel、debug 和现有 wrapper 迁移。
- `skills/loggerjs/references/troubleshooting.md`：常见投递、flush、浏览器、codec 和 TypeScript 问题。
- `skills/loggerjs/scripts/inspect-loggerjs-project.mjs`：只读项目识别脚本，根据目标应用推荐 LoggerJS 包。

## 示例 prompt

```text
Use $loggerjs to add production-ready structured logging to this Node API.
```

```text
Use $loggerjs to migrate this React app from console warnings/errors to LoggerJS browser logging.
```

```text
Use $loggerjs to review this service's existing pino setup and propose the smallest safe LoggerJS migration.
```

## 和 llms.txt 的关系

skill 本身保持短而可执行。需要精确 API 或更完整设计上下文时，它会指向面向 LLM 的文档：

- [llms.txt](/zh/llms.txt)：中文文档地图。
- [llms-full.txt](/zh/llms-full.txt)：适合更大上下文窗口的扩展文档和 skill 上下文。
- [参考](/zh/reference/)：生成的包、API 和示例参考。
