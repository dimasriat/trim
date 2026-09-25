import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Trim",
  description: "Rebalance without a keeper or a dump.",
  base: "/docs/",
  markdown: { math: true },
  themeConfig: {
    nav: [{ text: "Demo", link: "https://trim.dimsky.xyz/" }],
    sidebar: [
      { text: "Overview", link: "/" },
      { text: "The problem, measured", link: "/problem" },
      { text: "The mechanism", link: "/mechanism" },
      { text: "Results", link: "/results" },
      { text: "What this does not answer yet", link: "/limits" },
    ],
  },
});
