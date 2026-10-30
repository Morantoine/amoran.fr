import { feedPlugin } from "@11ty/eleventy-plugin-rss";
import syntaxHighlight from "@11ty/eleventy-plugin-syntaxhighlight";
import markdownItKatex from "@vscode/markdown-it-katex";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/style.css");
  eleventyConfig.addPassthroughCopy("src/cv.pdf");
  eleventyConfig.addPassthroughCopy("src/CNAME");
  // Math in blog posts: $inline$ and $$display$$, rendered at build time
  eleventyConfig.addPassthroughCopy({
    "node_modules/katex/dist/katex.min.css": "katex/katex.min.css",
    "node_modules/katex/dist/fonts": "katex/fonts",
  });
  eleventyConfig.amendLibrary("md", (md) => md.use(markdownItKatex.default ?? markdownItKatex));

  eleventyConfig.addPlugin(syntaxHighlight);

  eleventyConfig.addPlugin(feedPlugin, {
    type: "atom",
    outputPath: "/blog/feed.xml",
    collection: { name: "posts", limit: 20 },
    metadata: {
      language: "en",
      title: "Antoine Moran — Blog",
      subtitle: "Notes and write-ups by Antoine Moran.",
      base: "https://amoran.fr/",
      author: { name: "Antoine Moran" },
    },
  });

  eleventyConfig.addFilter("readableDate", (date) =>
    date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
  );
  eleventyConfig.addFilter("isoDate", (date) => date.toISOString().slice(0, 10));

  return {
    dir: { input: "src", output: "_site" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
