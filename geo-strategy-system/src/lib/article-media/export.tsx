import { marked, Renderer } from "marked"

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function safeExportUrl(value: string, allowMailto = false): string | null {
  const url = String(value || "").trim()
  if (!url) return null
  if (/^(?:\.\.?\/|\/|#)/.test(url)) return url
  if (/^https?:\/\//i.test(url)) return url
  if (allowMailto && /^mailto:/i.test(url)) return url
  return null
}

export function renderStandaloneArticleHtml(input: {
  title: string
  markdown: string
}): string {
  const renderer = new Renderer()
  renderer.html = token => escapeHtml(token.raw)
  renderer.link = function link({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens)
    const safeHref = safeExportUrl(href, true)
    if (!safeHref) return label
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ""
    return `<a href="${escapeHtml(safeHref)}"${titleAttribute}>${label}</a>`
  }
  renderer.image = function image({ href, title, text, tokens }) {
    const safeSrc = safeExportUrl(href)
    if (!safeSrc) return escapeHtml(text || "")
    const alt = tokens
      ? this.parser.parseInline(tokens, this.parser.textRenderer)
      : escapeHtml(text || "")
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ""
    return `<img src="${escapeHtml(safeSrc)}" alt="${alt}"${titleAttribute}>`
  }
  const cleanMarkdown = String(input.markdown || "").replace(
    /<!--\s*shitu-article-media:[^>]+-->\s*/g,
    "",
  )
  const body = marked.parse(cleanMarkdown, {
    async: false,
    gfm: true,
    breaks: false,
    renderer,
  }) as string
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.title || "文章")}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f8ff; color: #22324a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    article { width: min(860px, calc(100% - 32px)); margin: 28px auto; padding: 42px 52px; background: #fff; border: 1px solid #d9e8fb; box-shadow: 0 16px 48px rgba(18, 88, 170, .1); }
    h1 { margin: 0 0 28px; color: #071a38; font-size: 32px; line-height: 1.35; }
    h2 { margin: 34px 0 14px; color: #0d4f9e; font-size: 24px; }
    h3 { margin: 28px 0 12px; color: #155fa8; font-size: 20px; }
    p, li { font-size: 16px; line-height: 1.95; }
    img { display: block; max-width: 100%; height: auto; margin: 26px auto 8px; border-radius: 6px; }
    blockquote { margin: 22px 0; padding: 14px 18px; border-left: 4px solid #1677ff; background: #eef6ff; }
    table { width: 100%; margin: 24px 0; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 10px 12px; border: 1px solid #cfe0f5; text-align: left; }
    th { background: #eaf4ff; color: #0d4f9e; }
    pre { overflow-x: auto; padding: 16px; background: #071a38; color: #e7f3ff; }
    a { color: #0958d9; word-break: break-all; }
    @media (max-width: 640px) { article { width: 100%; margin: 0; padding: 24px 18px; border: 0; } h1 { font-size: 26px; } }
  </style>
</head>
<body>
  <article>${body}</article>
</body>
</html>`
}
