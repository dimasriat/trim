import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Trim",
  description: "Rebalance without a keeper or a dump.",
  base: "/docs/",
  markdown: { math: true },
  themeConfig: {
    sidebar: [
      { text: "Overview", link: "/" },
      { text: "The problem, measured", link: "/problem" },
      { text: "How it works, in two minutes", link: "/how-it-works" },
      { text: "The mechanism", link: "/mechanism" },
      { text: "Results", link: "/results" },
      { text: "What this does not answer yet", link: "/limits" },
      { text: "Research data", link: "/data" },
    ],
  },
});
