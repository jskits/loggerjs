import { defineConfig } from "vitepress";

const repoUrl = "https://github.com/jskits/loggerjs";
const siteUrl = "https://jskits.github.io/loggerjs/";

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
  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "LoggerJS",
    search: {
      provider: "local",
    },
    nav: [
      { text: "Guide", link: "/GETTING-STARTED" },
      { text: "Concepts", link: "/CONCEPTS" },
      { text: "Production", link: "/PRODUCTION-RECIPES" },
      { text: "Reference", link: "/reference/" },
      { text: "LLMs", link: "/llms" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Overview", link: "/" },
          { text: "Getting Started", link: "/GETTING-STARTED" },
          { text: "Concepts", link: "/CONCEPTS" },
          { text: "Migration", link: "/MIGRATION" },
          { text: "Comparison", link: "/COMPARISON" },
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
    ],
    socialLinks: [{ icon: "github", link: repoUrl }],
    editLink: {
      pattern: `${repoUrl}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright JS Kits.",
    },
  },
});
