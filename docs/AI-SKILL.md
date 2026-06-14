---
title: "AI Skill"
description: "Install and use the LoggerJS AI skill with coding agents."
---

# AI Skill

LoggerJS ships an installable AI skill for coding agents. The skill teaches an agent how to choose LoggerJS packages, add runtime-specific logger modules, configure production logging, migrate from existing loggers, and validate the change in the target project.

Use it when you want an agent to add LoggerJS to an application instead of only reading the docs.

## Install

Install the skill from the GitHub repository:

```bash
npx skills add jskits/loggerjs --skill loggerjs
```

Install it for a specific agent:

```bash
npx skills add jskits/loggerjs --skill loggerjs --agent codex
npx skills add jskits/loggerjs --skill loggerjs --agent claude-code
```

Use it once without installing:

```bash
npx skills use jskits/loggerjs --skill loggerjs
```

For local development from a checkout:

```bash
npx skills add . --skill loggerjs
npx skills use . --skill loggerjs
```

## What The Skill Includes

- `skills/loggerjs/SKILL.md`: the main workflow for adding or migrating LoggerJS.
- `skills/loggerjs/references/package-selection.md`: package and runtime selection rules.
- `skills/loggerjs/references/runtime-recipes.md`: Node, browser, library, pretty, OpenTelemetry, and Sentry recipes.
- `skills/loggerjs/references/production-checklist.md`: privacy, reliability, lifecycle, performance, and vendor-delivery guardrails.
- `skills/loggerjs/references/migration.md`: migration from console, pino, winston, loglevel, debug, and wrappers.
- `skills/loggerjs/references/troubleshooting.md`: common delivery, flush, browser, codec, and TypeScript issues.
- `skills/loggerjs/scripts/inspect-loggerjs-project.mjs`: a read-only project inspector that recommends LoggerJS packages from the target app.

## Example Prompts

```text
Use $loggerjs to add production-ready structured logging to this Node API.
```

```text
Use $loggerjs to migrate this React app from console warnings/errors to LoggerJS browser logging.
```

```text
Use $loggerjs to review this service's existing pino setup and propose the smallest safe LoggerJS migration.
```

## How It Uses llms.txt

The skill is intentionally short. It points agents to the LLM-friendly docs when exact API or broader design context is needed:

- [llms.txt](/llms.txt): concise documentation map.
- [llms-full.txt](/llms-full.txt): expanded docs and skill context for larger context windows.
- [Reference](/reference/): generated package, API, and example reference.
