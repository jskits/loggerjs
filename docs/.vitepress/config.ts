import { defineConfig } from "vitepress";

const repoUrl = "https://github.com/jskits/loggerjs";
const siteUrl = "https://jskits.github.io/loggerjs/";

const nav = [
  { text: "Guide", link: "/GETTING-STARTED" },
  { text: "Concepts", link: "/CONCEPTS" },
  { text: "Production", link: "/PRODUCTION-RECIPES" },
  { text: "Reference", link: "/reference/" },
  { text: "AI Skill", link: "/AI-SKILL" },
  { text: "LLMs", link: "/llms" },
];

const zhNav = [
  { text: "指南", link: "/zh/GETTING-STARTED" },
  { text: "概念", link: "/zh/CONCEPTS" },
  { text: "生产", link: "/zh/PRODUCTION-RECIPES" },
  { text: "参考", link: "/zh/reference/" },
  { text: "AI Skill", link: "/zh/AI-SKILL" },
  { text: "LLMs", link: "/zh/llms" },
];

const sidebar = [
  {
    text: "Start",
    items: [
      { text: "Overview", link: "/" },
      { text: "Getting Started", link: "/GETTING-STARTED" },
      { text: "Concepts", link: "/CONCEPTS" },
      { text: "Migration", link: "/MIGRATION" },
      { text: "Comparison", link: "/COMPARISON" },
      { text: "AI Skill", link: "/AI-SKILL" },
    ],
  },
  {
    text: "Pipeline",
    items: [
      { text: "Transports", link: "/TRANSPORTS" },
      { text: "Pretty Output", link: "/PRETTY" },
      { text: "Integrations", link: "/INTEGRATIONS" },
      { text: "Processors", link: "/PROCESSORS" },
      { text: "Codecs", link: "/CODECS" },
    ],
  },
  {
    text: "Production",
    items: [
      { text: "Production Recipes", link: "/PRODUCTION-RECIPES" },
      { text: "Operations", link: "/OPERATIONS" },
      { text: "Performance", link: "/PERFORMANCE" },
      { text: "Benchmarks", link: "/BENCHMARKS" },
      { text: "Benchmark Matrix", link: "/BENCHMARK-MATRIX" },
      { text: "API Stability", link: "/API-STABILITY" },
    ],
  },
  {
    text: "Reference",
    items: [
      { text: "Reference Index", link: "/reference/" },
      { text: "Packages", link: "/reference/packages" },
      { text: "API Reports", link: "/reference/api/" },
      { text: "Examples", link: "/examples" },
      { text: "Architecture", link: "/ARCHITECTURE" },
    ],
  },
  {
    text: "Project",
    items: [
      { text: "Contributing", link: "/CONTRIBUTING" },
      { text: "Release", link: "/RELEASE" },
      { text: "Test Inventory", link: "/TEST-INVENTORY" },
      { text: "Baseline", link: "/BASELINE" },
    ],
  },
];

const zhSidebar = [
  {
    text: "开始",
    items: [
      { text: "概览", link: "/zh/" },
      { text: "快速开始", link: "/zh/GETTING-STARTED" },
      { text: "核心概念", link: "/zh/CONCEPTS" },
      { text: "迁移指南", link: "/zh/MIGRATION" },
      { text: "对比", link: "/zh/COMPARISON" },
      { text: "AI Skill", link: "/zh/AI-SKILL" },
    ],
  },
  {
    text: "管线",
    items: [
      { text: "传输", link: "/zh/TRANSPORTS" },
      { text: "友好输出", link: "/zh/PRETTY" },
      { text: "集成", link: "/zh/INTEGRATIONS" },
      { text: "处理器", link: "/zh/PROCESSORS" },
      { text: "编解码", link: "/zh/CODECS" },
    ],
  },
  {
    text: "生产",
    items: [
      { text: "生产配方", link: "/zh/PRODUCTION-RECIPES" },
      { text: "运维", link: "/zh/OPERATIONS" },
      { text: "性能", link: "/zh/PERFORMANCE" },
      { text: "基准", link: "/zh/BENCHMARKS" },
      { text: "基准矩阵", link: "/zh/BENCHMARK-MATRIX" },
      { text: "API 稳定性", link: "/zh/API-STABILITY" },
    ],
  },
  {
    text: "参考",
    items: [
      { text: "参考索引", link: "/zh/reference/" },
      { text: "包", link: "/zh/reference/packages" },
      { text: "API 报告", link: "/zh/reference/api/" },
      { text: "示例", link: "/zh/examples" },
      { text: "架构", link: "/zh/ARCHITECTURE" },
    ],
  },
  {
    text: "项目",
    items: [
      { text: "贡献", link: "/zh/CONTRIBUTING" },
      { text: "发布", link: "/zh/RELEASE" },
      { text: "测试清单", link: "/zh/TEST-INVENTORY" },
      { text: "基线", link: "/zh/BASELINE" },
    ],
  },
];

const editLink = {
  pattern: `${repoUrl}/edit/main/docs/:path`,
  text: "Edit this page on GitHub",
};

const zhEditLink = {
  pattern: `${repoUrl}/edit/main/docs/:path`,
  text: "在 GitHub 上编辑此页",
};

const commonThemeConfig = {
  logo: "/logo.svg",
  siteTitle: "LoggerJS",
  search: {
    provider: "local",
    options: {
      locales: {
        zh: {
          translations: {
            button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
            modal: {
              displayDetails: "显示详细列表",
              resetButtonTitle: "重置搜索",
              backButtonTitle: "关闭搜索",
              noResultsText: "没有找到结果",
              footer: {
                selectText: "选择",
                selectKeyAriaLabel: "回车",
                navigateText: "切换",
                navigateUpKeyAriaLabel: "上方向键",
                navigateDownKeyAriaLabel: "下方向键",
                closeText: "关闭",
                closeKeyAriaLabel: "Esc",
              },
            },
          },
        },
      },
    },
  },
  socialLinks: [{ icon: "github", link: repoUrl }],
};

const enThemeConfig = {
  ...commonThemeConfig,
  nav,
  sidebar,
  editLink,
  footer: {
    message: "Released under the MIT License.",
    copyright: "Copyright JS Kits.",
  },
};

const zhThemeConfig = {
  ...commonThemeConfig,
  nav: zhNav,
  sidebar: zhSidebar,
  editLink: zhEditLink,
  outline: { label: "本页目录" },
  darkModeSwitchLabel: "外观",
  lightModeSwitchTitle: "切换到浅色模式",
  darkModeSwitchTitle: "切换到深色模式",
  sidebarMenuLabel: "菜单",
  returnToTopLabel: "回到顶部",
  langMenuLabel: "切换语言",
  lastUpdatedText: "最后更新",
  docFooter: {
    prev: "上一页",
    next: "下一页",
  },
  footer: {
    message: "基于 MIT License 发布。",
    copyright: "Copyright JS Kits.",
  },
};

export default defineConfig({
  lang: "en-US",
  title: "LoggerJS",
  description:
    "Isomorphic structured logging for JavaScript, from browser collection to Node delivery.",
  base: "/loggerjs/",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", href: "/loggerjs/logo.svg", type: "image/svg+xml" }],
    ["link", { rel: "alternate", hreflang: "en", href: siteUrl }],
    ["link", { rel: "alternate", hreflang: "zh-CN", href: `${siteUrl}zh/` }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "LoggerJS" }],
    [
      "meta",
      {
        property: "og:description",
        content: "One structured logging pipeline for browser, server, workers, and edge runtimes.",
      },
    ],
    ["meta", { property: "og:url", content: siteUrl }],
    ["meta", { name: "twitter:card", content: "summary" }],
  ],
  markdown: {
    toc: { level: [2, 3] },
  },
  themeConfig: enThemeConfig,
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      link: "/",
      themeConfig: enThemeConfig,
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      link: "/zh/",
      description: "面向 JavaScript 的同构结构化日志，从浏览器采集到 Node 投递。",
      themeConfig: zhThemeConfig,
    },
  },
});
