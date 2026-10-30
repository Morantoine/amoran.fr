# amoran.fr

Personal website, built with [Eleventy](https://www.11ty.dev/) and deployed to GitHub Pages
on every push to `main`.

- `/` home page: `src/index.njk`
- `/aboutme/` about, research and CV: `src/aboutme/index.html`
- `/blog/` blog: posts live in `src/blog/posts/`

## Writing a post

Add a Markdown file to `src/blog/posts/`, named `YYYY-MM-DD-short-title.md`. The date in the
name is the post date and the rest becomes the address (`/blog/short-title/`).

```markdown
---
title: My post title
description: One sentence shown to search engines and link previews.
math: true   # only if the post uses LaTeX ($...$ and $$...$$)
---

Text in Markdown.
```

Commit and push; the site rebuilds in about a minute.

## Running it locally

```bash
npm install
npm start
```

Then open http://localhost:8080.
