/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { scanMarkdown, splitLines } from "../src/markdown";

describe("splitLines", () => {
  test("accepts LF and CRLF, no phantom last line", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\r\nb")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
  });
});

describe("scanMarkdown: links", () => {
  test("inline links with line and column", () => {
    const scan = scanMarkdown("See the [customers table](/tables/customers.md) for the join key.\n");
    expect(scan.links).toEqual([
      { text: "customers table", url: "/tables/customers.md", title: undefined, line: 1, column: 9, image: false },
    ]);
  });

  test("titles, angle brackets, parentheses and escapes in destinations", () => {
    const scan = scanMarkdown(
      ['[a](x.md "Title")', "[b](<with space.md>)", "[c](wiki/Foo_(bar).md)", "[d](a\\_b.md)", "[e]( spaced.md )"].join(
        "\n"
      )
    );
    expect(scan.links.map(l => [l.text, l.url, l.title])).toEqual([
      ["a", "x.md", "Title"],
      ["b", "with space.md", undefined],
      ["c", "wiki/Foo_(bar).md", undefined],
      ["d", "a_b.md", undefined],
      ["e", "spaced.md", undefined],
    ]);
  });

  test("link text may hold code spans and brackets", () => {
    const scan = scanMarkdown(
      "The current one is [`metrics/gross-margin.md`](./gross-margin.md), see [a [nested] b](n.md)."
    );
    expect(scan.links.map(l => [l.text, l.url])).toEqual([
      ["`metrics/gross-margin.md`", "./gross-margin.md"],
      ["a [nested] b", "n.md"],
    ]);
  });

  test("images are flagged", () => {
    const scan = scanMarkdown("![diagram](img/d.png) and [x](y.md)");
    expect(scan.links.map(l => [l.url, l.image, l.column])).toEqual([
      ["img/d.png", true, 1],
      ["y.md", false, 27],
    ]);
  });

  test("reference links: full, collapsed and shortcut, definitions after use", () => {
    const scan = scanMarkdown(
      ["[one][1], [two][], [three].", "", '[1]: one.md "One"', "[two]: <two.md>", "[THREE]: three.md"].join("\n")
    );
    expect(scan.links.map(l => [l.text, l.url, l.reference, l.title])).toEqual([
      ["one", "one.md", "1", "One"],
      ["two", "two.md", "two", undefined],
      ["three", "three.md", "three", undefined],
    ]);
  });

  test("brackets without a definition are not links", () => {
    expect(scanMarkdown("an [aside] here, [x] [y]").links).toEqual([]);
  });

  test("autolinks", () => {
    const scan = scanMarkdown("Mail <mailto:a@example.com> or <https://example.com/x>.");
    expect(scan.links.map(l => [l.url, l.autolink])).toEqual([
      ["mailto:a@example.com", true],
      ["https://example.com/x", true],
    ]);
  });

  test("code spans, fenced and indented code and comments hide links", () => {
    const text = [
      "Inline `[no](no.md)` but [yes](yes.md).",
      "",
      "```md",
      "[no](fenced.md)",
      "```",
      "",
      "    [no](indented.md)",
      "",
      "~~~~",
      "```",
      "[no](tilde.md)",
      "~~~~",
      "<!-- [no](comment.md) -->",
      "<!--",
      "[no](multiline.md)",
      "-->",
      "Escaped \\[no](escaped.md) and `` [no](double.md) `` and [yes2](yes2.md)",
    ].join("\n");
    expect(scanMarkdown(text).links.map(l => l.url)).toEqual(["yes.md", "yes2.md"]);
  });

  test("line offset shifts every line number", () => {
    const scan = scanMarkdown("# H\n\n[a](b.md)\n", 7);
    expect(scan.headings[0].line).toBe(8);
    expect(scan.links[0].line).toBe(10);
  });

  test("links in headings, list items, continuation lines and footnote definitions", () => {
    const text = ["# About [x](x.md)", "", "* item [y](y.md)", "  more [z](z.md)", "", "[^n]: see [w](w.md)"].join(
      "\n"
    );
    expect(scanMarkdown(text).links.map(l => [l.url, l.line])).toEqual([
      ["x.md", 1],
      ["y.md", 3],
      ["z.md", 4],
      ["w.md", 6],
    ]);
  });
});

describe("scanMarkdown: structure", () => {
  test("ATX and setext headings", () => {
    const scan = scanMarkdown(
      ["# One #", "Two", "===", "", "Three", "---", "## Four", "#nope", "####### seven"].join("\n")
    );
    expect(scan.headings.map(h => [h.level, h.text, h.line])).toEqual([
      [1, "One", 1],
      [1, "Two", 2],
      [2, "Three", 5],
      [2, "Four", 7],
    ]);
  });

  test("a thematic break is not a heading", () => {
    expect(scanMarkdown("text\n\n---\n").headings).toEqual([]);
  });

  test("fenced code blocks with info, heading and lines", () => {
    const scan = scanMarkdown(["# Computation", "", "```sql", "SELECT 1", "```"].join("\n"));
    expect(scan.codeBlocks).toEqual([
      { fenced: true, info: "sql", code: "SELECT 1\n", line: 3, endLine: 5, heading: 0 },
    ]);
  });

  test("indented code blocks keep inner blank lines", () => {
    const scan = scanMarkdown(["# Computation", "", "    SELECT 1", "", "    FROM t", "", "Text"].join("\n"));
    expect(scan.codeBlocks).toEqual([
      { fenced: false, info: "", code: "SELECT 1\n\nFROM t\n", line: 3, endLine: 5, heading: 0 },
    ]);
  });

  test("an unclosed fence runs to the end", () => {
    const scan = scanMarkdown("```\ncode\n");
    expect(scan.codeBlocks[0]).toMatchObject({ code: "code\n", line: 1, endLine: 2 });
  });

  test("indented list continuations are not code", () => {
    const scan = scanMarkdown(["1. step", "", "    more of step [l](l.md)"].join("\n"));
    expect(scan.codeBlocks).toEqual([]);
    expect(scan.links.map(l => l.url)).toEqual(["l.md"]);
  });

  test("footnote references and definitions", () => {
    const scan = scanMarkdown(
      ["Sharded daily.[^ga4-schema] And[^b].", "", "[^ga4-schema]: GA4 BigQuery Export schema"].join("\n")
    );
    expect(scan.footnoteReferences.map(f => [f.label, f.line, f.column])).toEqual([
      ["ga4-schema", 1, 15],
      ["b", 1, 32],
    ]);
    expect(scan.footnoteDefinitions).toEqual([
      { label: "ga4-schema", text: "GA4 BigQuery Export schema", line: 3, column: 1 },
    ]);
  });

  test("list items and paragraphs, with their headings", () => {
    const scan = scanMarkdown(
      ["Intro", "line two", "", "# A", "* one", "- two", "+ three", "1. four", "2) five", "", "Para"].join("\n")
    );
    expect(scan.listItems.map(i => [i.marker, i.text, i.heading])).toEqual([
      ["*", "one", 0],
      ["-", "two", 0],
      ["+", "three", 0],
      ["1.", "four", 0],
      ["2)", "five", 0],
    ]);
    expect(scan.paragraphs).toEqual([
      { text: "Intro line two", line: 1, heading: -1 },
      { text: "Para", line: 11, heading: 0 },
    ]);
  });
});
