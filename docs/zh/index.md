---
layout: home

hero:
  name: LoggerJS
  text: 面向 JavaScript 的同构结构化日志
  tagline: 从浏览器采集到服务端投递的一条管线，组合式处理，并用可复现基准约束性能表述。
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
    details: 同一 logger 模型运行在浏览器、Node.js、workers 和 edge runtimes。
  - title: 自动采集
    details: 按需捕获 console、错误、网络失败、路由、process 事件、HTTP framework、队列和数据库边界。
  - title: 可靠投递
    details: transport 拥有 codec，并可组合 batching、retry、backoff、offline replay、crash-path flush 和 beacon delivery。
  - title: 组合式处理
    details: middleware 和 processor 在投递前完成 enrich、redact、sample、dedupe、fingerprint、route 和 buffer。
  - title: 可度量热路径
    details: benchmark 和 CI gate 覆盖 disabled levels、lean NDJSON、prepared encoders、batching、browser delivery 和 size budgets。
  - title: 对库友好的默认值
    details: library logger 在宿主应用配置前保持静默，依赖可以记录日志但不强制输出。
---

## LoggerJS 管线

<div class="loggerjs-pipeline">
  <span><strong>采集</strong>手写日志，加上浏览器和 Node integration。</span>
  <span><strong>塑形</strong>middleware 保持 raw record 低成本且可组合。</span>
  <span><strong>处理</strong>需要更丰富行为时，processor 再投影 event。</span>
  <span><strong>投递</strong>transport 选择 codec、batching、retry 和目的地。</span>
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
    <p>先看 Node 或浏览器 quick start，再按运行时补 processor 和 transport。</p>
  </div>
  <div class="loggerjs-home-panel">
    <h2>生产上线</h2>
    <p>生产配方和运维指南覆盖隐私、离线队列、崩溃路径和 vendor 投递。</p>
  </div>
  <div class="loggerjs-home-panel">
    <h2>API 查询</h2>
    <p>生成的包和 API 页面用于确认 exports、subpaths 和公共声明。</p>
  </div>
</div>

## 文档地图

- [快速开始](/zh/GETTING-STARTED) 覆盖安装、第一个 logger、级别、lazy message、context 和 typed events。
- [核心概念](/zh/CONCEPTS) 解释 records、events、middleware、processors、transports、codecs、integrations 和 routing。
- [传输](/zh/TRANSPORTS)、[集成](/zh/INTEGRATIONS)、[处理器](/zh/PROCESSORS) 和 [编解码](/zh/CODECS) 是主要实现参考。
- [生产配方](/zh/PRODUCTION-RECIPES)、[运维](/zh/OPERATIONS) 和 [性能](/zh/PERFORMANCE) 帮助做上线选择。
- [基准](/zh/BENCHMARKS)、[基准矩阵](/zh/BENCHMARK-MATRIX) 和 [对比](/zh/COMPARISON) 把性能与定位绑定到仓库证据。
- [包](/zh/reference/packages)、[API 报告](/zh/reference/api/) 和 [示例](/zh/examples) 由当前仓库生成。
