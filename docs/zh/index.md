---
layout: home

hero:
  name: LoggerJS
  text: 更快、更强的同构日志库
  tagline: 采集、处理、投递。一条高速管线。
  image:
    src: /logo.svg
    alt: LoggerJS logo
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/GETTING-STARTED
    - theme: alt
      text: 查看包
      link: /zh/reference/packages
    - theme: alt
      text: API 参考
      link: /zh/reference/api/

features:
  - title: 浏览器和服务端
    details: 同一套 logger 模型运行在浏览器、Node.js、worker 和 edge 运行时中。
  - title: 自动采集
    details: 按需开启的 integration 可以捕获 console 调用、错误、网络失败、路由、进程事件、HTTP 框架、队列和数据库调用。
  - title: 可靠投递
    details: 由 transport 决定 codec，并可组合批量、重试、退避、离线重放、崩溃时 flush 和 Beacon 投递。
  - title: 组合式处理
    details: middleware 和 processor 在投递前完成补充字段、脱敏、采样、去重、指纹、路由和缓冲。
  - title: 可度量热路径
    details: 基准测试和 CI 门禁覆盖禁用级别、lean NDJSON、prepared 编码器、批量、浏览器投递和体积预算。
  - title: 对库友好的默认值
    details: 库中的 logger 在宿主应用完成配置前保持静默，依赖包可以记录日志，而不会强制产生输出。
---

> [!NOTE]
> 各指南均为完整中文版。自动生成的参考页中，包名、导出子路径、TypeScript 声明和源码链接保留英文原文，方便与发布产物对照。

## LoggerJS 管线

<div class="loggerjs-pipeline">
  <span><strong>采集</strong>手动记录的日志，以及浏览器和 Node 的 integration。</span>
  <span><strong>整理</strong>middleware 直接处理原始 record，成本低且可组合。</span>
  <span><strong>处理</strong>需要更丰富的行为时，才把 record 投影为 event 交给 processor。</span>
  <span><strong>投递</strong>transport 决定 codec、批量、重试和目的地。</span>
</div>

```ts
import { createLogger, stdoutTransport } from "@loggerjs/node";
import { redactProcessor } from "@loggerjs/processors";

const logger = createLogger({
  category: ["api"],
  level: "info",
  processors: [redactProcessor({ keys: ["password", /token/i] })],
  transports: [stdoutTransport()],
});

logger.info("order created", { orderId: "ord_123" });
await logger.flush();
```

## 从哪里开始

<div class="loggerjs-home-grid">
  <div class="loggerjs-home-panel">
    <h2>新项目</h2>
    <p>从 Node 或浏览器的快速开始入手，再按运行时添加 processor 和 transport。</p>
  </div>
  <div class="loggerjs-home-panel">
    <h2>生产上线</h2>
    <p>生产配方和运维指南介绍隐私、离线队列、崩溃路径和厂商投递。</p>
  </div>
  <div class="loggerjs-home-panel">
    <h2>API 查询</h2>
    <p>通过自动生成的包和 API 页面查询导出、子路径和公开声明。</p>
  </div>
</div>

## 文档地图

- [快速开始](/zh/GETTING-STARTED) 介绍安装、第一个 logger、级别、延迟消息、context 和类型化事件。
- [核心概念](/zh/CONCEPTS) 解释 record、event、middleware、processor、transport、codec、integration 和路由。
- [传输](/zh/TRANSPORTS)、[集成](/zh/INTEGRATIONS)、[处理器](/zh/PROCESSORS) 和 [编解码](/zh/CODECS) 是主要的功能参考。
- [生产配方](/zh/PRODUCTION-RECIPES)、[运维](/zh/OPERATIONS) 和 [性能](/zh/PERFORMANCE) 帮助做上线决策。
- [基准](/zh/BENCHMARKS)、[基准矩阵](/zh/BENCHMARK-MATRIX) 和 [对比](/zh/COMPARISON) 让性能数据和定位说明都有仓库内的证据支撑。
- [包](/zh/reference/packages)、[API 报告](/zh/reference/api/) 和 [示例](/zh/examples) 根据当前仓库自动生成。
- [AI Skill](/zh/AI-SKILL)、[llms.txt](/zh/llms.txt) 和 [llms-full.txt](/zh/llms-full.txt) 帮助编程 agent 直接使用 LoggerJS。
