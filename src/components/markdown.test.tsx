import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, markdownUrl } from "./markdown";

const html = (md: string, base = "https://github.com/o/r/pull/7") => renderToStaticMarkup(<Markdown base={base}>{md}</Markdown>);

describe("markdown sanitising", () => {
  test("raw HTML is dropped, never rendered", () => {
    const out = html('Hello <script>alert(1)</script> <img src=x onerror="alert(2)"> <b onclick="x()">bold</b>\n\n<iframe src="https://evil.example"></iframe>\n\n<!-- template comment -->');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("<b");
    expect(out).not.toContain("template comment");
    expect(out).toContain("Hello");
  });

  test("dangerous URLs are removed", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox(1)"]) {
      const out = html(`[click](${href})`);
      expect(out).not.toContain("javascript:");
      expect(out.toLowerCase()).not.toContain(href.slice(0, 8).toLowerCase());
      expect(out).toContain("click");
    }
  });

  test("links open on the forge in a new tab; relative ones resolve against the forge", () => {
    const out = html("[docs](https://example.com/a) [issue](/o/r/issues/3) [anchor](#top)");
    expect(out).toContain('href="https://example.com/a" target="_blank" rel="noreferrer noopener nofollow"');
    expect(out).toContain('href="https://github.com/o/r/issues/3"');
    expect(out).toContain('href="#top"');
    expect(markdownUrl("/x")).toBe("");
    expect(markdownUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
  });

  test("images become links instead of loading", () => {
    const out = html("![screenshot](https://example.com/s.png)");
    expect(out).not.toContain("<img");
    expect(out).toContain('<a href="https://example.com/s.png"');
    expect(out).toContain("screenshot");
  });

  test("GFM: code blocks, tables and task lists", () => {
    const out = html("```ts\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~");
    expect(out).toContain("<pre><code");
    expect(out).toContain('<div class="md-table"><table>');
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("disabled");
    expect(out).toContain("<del>old</del>");
  });
});
