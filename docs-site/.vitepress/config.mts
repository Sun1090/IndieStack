import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "IndieStack",
  description: "面向独立开发者的生产级 SaaS 启动模板",

  // 使用 hash 路由，适合静态部署
  base: "/",
  cleanUrls: true,
  appearance: true, // 支持 light/dark/system 切换
  lastUpdated: true,
  ignoreDeadLinks: true,

  // 多语言配置
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      title: "IndieStack",
      description: "面向独立开发者的生产级 SaaS 启动模板",
      themeConfig: {
        nav: nav_zh(),
        sidebar: sidebar_zh(),
        editLink: {
          pattern: "https://github.com/your-username/indiestack/edit/main/docs-site/:path",
          text: "在 GitHub 上编辑此页",
        },
      },
    },
    en: {
      label: "English",
      lang: "en",
      title: "IndieStack",
      description: "A production-ready IndieStack for independent developers",
      themeConfig: {
        nav: nav_en(),
        sidebar: sidebar_en(),
        editLink: {
          pattern: "https://github.com/your-username/indiestack/edit/main/docs-site/:path",
          text: "Edit this page on GitHub",
        },
      },
    },
  },

  // 主题配置
  themeConfig: {
    logo: "/favicon.svg",
    siteTitle: "IndieStack",

    socialLinks: [
      { icon: "github", link: "https://github.com/your-username/indiestack" },
    ],

    footer: {
      message: "基于 MIT 协议开源",
      copyright: `Copyright © ${new Date().getFullYear()} IndieStack`,
    },

    // 搜索（本地搜索）
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: "搜索文档", buttonAriaLabel: "搜索文档" },
              modal: { noResultsText: "未找到结果" },
            },
          },
        },
      },
    },
  },

  // Markdown 配置
  markdown: {
    lineNumbers: true,
  },

  // Sitemap
  sitemap: {
    hostname: "https://indiestack.dev",
  },
});

// ===== 中文导航 =====
function nav_zh() {
  return [
    { text: "首页", link: "/zh-CN/" },
    { text: "快速开始", link: "/zh-CN/quickstart" },
    {
      text: "指南",
      items: [
        { text: "项目架构", link: "/zh-CN/architecture" },
        { text: "Mock 模式", link: "/zh-CN/mock" },
        { text: "认证流程", link: "/zh-CN/auth-flow" },
        { text: "项目结构", link: "/zh-CN/project-structure" },
        { text: "技术栈详解", link: "/zh-CN/tech-stack" },
        { text: "Supabase", link: "/zh-CN/supabase" },
        { text: "组件库", link: "/zh-CN/components" },
        { text: "页面概览", link: "/zh-CN/pages" },
      ],
    },
    {
      text: "运维",
      items: [
        { text: "配置指南", link: "/zh-CN/configuration" },
        { text: "脚本工具", link: "/zh-CN/scripts" },
        { text: "部署方案", link: "/zh-CN/deployment" },
      ],
    },
  ];
}

// ===== 英文导航 =====
function nav_en() {
  return [
    { text: "Home", link: "/en/" },
    { text: "Quick Start", link: "/en/quickstart" },
    {
      text: "Guide",
      items: [
        { text: "Architecture", link: "/en/architecture" },
        { text: "Mock Mode", link: "/en/mock" },
        { text: "Auth Flow", link: "/en/auth-flow" },
        { text: "Project Structure", link: "/en/project-structure" },
        { text: "Tech Stack", link: "/en/tech-stack" },
        { text: "Supabase", link: "/en/supabase" },
        { text: "Components", link: "/en/components" },
        { text: "Pages Overview", link: "/en/pages" },
      ],
    },
    {
      text: "Operations",
      items: [
        { text: "Configuration", link: "/en/configuration" },
        { text: "Scripts", link: "/en/scripts" },
        { text: "Deployment", link: "/en/deployment" },
      ],
    },
  ];
}

// ===== 中文侧边栏 =====
function sidebar_zh() {
  return {
    "/zh-CN/": [
      {
        text: "入门",
        items: [
          { text: "简介", link: "/zh-CN/" },
          { text: "快速开始", link: "/zh-CN/quickstart" },
          { text: "项目架构", link: "/zh-CN/architecture" },
          { text: "项目结构", link: "/zh-CN/project-structure" },
        ],
      },
      {
        text: "核心功能",
        items: [
          { text: "认证流程", link: "/zh-CN/auth-flow" },
          { text: "Supabase 集成", link: "/zh-CN/supabase" },
          { text: "技术栈详解", link: "/zh-CN/tech-stack" },
          { text: "组件库", link: "/zh-CN/components" },
          { text: "Mock 模式", link: "/zh-CN/mock" },
          { text: "页面概览", link: "/zh-CN/pages" },
        ],
      },
      {
        text: "运维部署",
        items: [
          { text: "配置指南", link: "/zh-CN/configuration" },
          { text: "脚本工具", link: "/zh-CN/scripts" },
          { text: "部署方案", link: "/zh-CN/deployment" },
        ],
      },
    ],
  };
}

// ===== 英文侧边栏 =====
function sidebar_en() {
  return {
    "/en/": [
      {
        text: "Getting Started",
        items: [
          { text: "Introduction", link: "/en/" },
          { text: "Quick Start", link: "/en/quickstart" },
          { text: "Architecture", link: "/en/architecture" },
          { text: "Project Structure", link: "/en/project-structure" },
        ],
      },
      {
        text: "Core Features",
        items: [
          { text: "Auth Flow", link: "/en/auth-flow" },
          { text: "Supabase Integration", link: "/en/supabase" },
          { text: "Tech Stack", link: "/en/tech-stack" },
          { text: "Components", link: "/en/components" },
          { text: "Mock Mode", link: "/en/mock" },
          { text: "Pages Overview", link: "/en/pages" },
        ],
      },
      {
        text: "Operations",
        items: [
          { text: "Configuration", link: "/en/configuration" },
          { text: "Scripts", link: "/en/scripts" },
          { text: "Deployment", link: "/en/deployment" },
        ],
      },
    ],
  };
}
