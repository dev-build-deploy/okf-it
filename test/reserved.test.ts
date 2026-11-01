/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { directoryOf, isReserved, parseIndex, parseLog } from "../src/reserved";

import { fixture } from "./helpers";

const codes = (problems: { code: string }[]): string[] => problems.map(p => p.code);

describe("reserved file names (§3.1)", () => {
  test("index.md and log.md at any level", () => {
    expect(isReserved("index.md")).toBe(true);
    expect(isReserved("a/b/log.md")).toBe(true);
    expect(isReserved("a/indexes.md")).toBe(false);
    expect(isReserved("a/index.md/x.md")).toBe(false);
  });

  test("directoryOf", () => {
    expect(directoryOf("index.md")).toBe("");
    expect(directoryOf("a/b/c.md")).toBe("a/b");
  });
});

describe("parseIndex (§8)", () => {
  test("the spec's example: sections and entries", () => {
    const index = parseIndex(fixture("spec/8-index.md"), "index.md");
    expect(index.problems).toEqual([]);
    expect(index.directory).toBe("");
    expect(index.sections.map(s => [s.heading, s.level, s.entries.length])).toEqual([
      ["Section / Group Heading", 1, 2],
      ["Another Section", 1, 1],
    ]);
    expect(index.entries).toEqual([
      { title: "Title 1", url: "relative-url-1", description: "short description of item 1", line: 3, column: 3 },
      { title: "Title 2", url: "relative-url-2", description: "short description of item 2", line: 4, column: 3 },
      {
        title: "Subdirectory",
        url: "subdir/",
        description: "short description of the subdirectory",
        line: 8,
        column: 3,
      },
    ]);
  });

  test("a sample bundle's index", () => {
    const index = parseIndex(fixture("bundles/acme_retail/metrics/index.md"), "metrics/index.md");
    expect(index.problems).toEqual([]);
    expect(index.directory).toBe("metrics");
    expect(index.entries.map(e => e.title)).toEqual(["Revenue", "Gross Margin", "Gross Margin (legacy, pre-FY2026)"]);
  });

  test("okf_version on the root index (§12)", () => {
    const index = parseIndex('---\nokf_version: "0.2"\n---\n\n# Tables\n\n* [Orders](orders.md) - Orders.\n');
    expect(index.okfVersion).toBe("0.2");
    expect(index.problems).toEqual([]);
    expect(index.entries[0].line).toBe(7);
  });

  test("front matter on a non-root index is not allowed", () => {
    const index = parseIndex('---\nokf_version: "0.2"\n---\n# T\n* [a](a.md)\n', "tables/index.md");
    expect(codes(index.problems)).toEqual(["index-front-matter"]);
    expect(index.okfVersion).toBeUndefined();
  });

  test("extra keys on the root index, invalid or unterminated front matter", () => {
    expect(codes(parseIndex('---\nokf_version: "0.2"\ntitle: x\n---\n# T\n* [a](a.md)\n').problems)).toEqual([
      "index-extra-front-matter",
    ]);
    expect(codes(parseIndex("---\n: : :\n---\n# T\n* [a](a.md)\n").problems)).toContain("index-front-matter-invalid");
    expect(codes(parseIndex("---\nokf_version: 1\n# T\n").problems)).toContain("index-front-matter-invalid");
  });

  test("entries outside a section, malformed items, separators", () => {
    const index = parseIndex(
      [
        "* [early](e.md) - before any heading",
        "# Things",
        "* just text",
        "* [no description](n.md)",
        "* [dash](d.md) – en dash",
        "* [colon](c.md): colon",
        "* [loose](l.md) trailing words",
        "- [Title with \\] bracket](<with space.md>) - escaped",
      ].join("\n")
    );
    expect(index.problems.map(p => [p.code, p.line])).toEqual([
      ["index-entry-outside-section", 1],
      ["index-item-malformed", 3],
      ["index-entry-separator", 7],
    ]);
    expect(index.entries.map(e => [e.title, e.url, e.description])).toEqual([
      ["early", "e.md", "before any heading"],
      ["no description", "n.md", undefined],
      ["dash", "d.md", "en dash"],
      ["colon", "c.md", "colon"],
      ["loose", "l.md", "trailing words"],
      ["Title with ] bracket", "with space.md", "escaped"],
    ]);
  });

  test("empty index and empty sections", () => {
    expect(codes(parseIndex("# Nothing\n").problems)).toEqual(["index-empty"]);
    const index = parseIndex("# Empty\n\n# Full\n* [a](a.md)\n# Parent\n## Child\n* [b](b.md)\n");
    expect(index.problems.map(p => [p.code, p.line])).toEqual([["index-empty-section", 1]]);
  });

  test("prose is allowed around the sections", () => {
    expect(parseIndex("Intro text.\n\n# T\n\nSome words.\n\n* [a](a.md) - A\n").problems).toEqual([]);
  });
});

describe("parseLog (§9)", () => {
  test("the spec's example: date groups, newest first, entry kinds", () => {
    const log = parseLog(fixture("spec/9-log.md"), "log.md");
    expect(log.problems).toEqual([]);
    expect(log.title).toBe("Directory Update Log");
    expect(log.days.map(d => [d.date, d.line, d.entries.map(e => e.kind)])).toEqual([
      ["2026-05-22", 3, ["Update", "Creation"]],
      ["2026-05-15", 7, ["Initialization"]],
    ]);
    expect(log.entries[0].text).toBe(
      "**Update**: Added a BigQuery table reference for [Customer Metrics](/tables/customer-metrics.md)."
    );
    expect(log.scan.links.map(l => l.url)).toEqual(["/tables/customer-metrics.md", "/playbooks/dataplex.md"]);
  });

  test("a sample bundle's log (with front matter, kinds without a colon)", () => {
    const log = parseLog(fixture("bundles/acme_retail/log.md"), "log.md");
    expect(codes(log.problems)).toEqual(["log-front-matter"]);
    expect(log.frontMatter).toEqual({ type: "Log", title: "Acme Retail bundle history" });
    expect(log.title).toBe("Bundle history");
    expect(log.days.map(d => d.date)).toEqual(["2026-07-01", "2026-06-30", "2026-04-15", "2026-02-10"]);
    expect(log.days.map(d => d.entries[0].kind)).toEqual([
      "Verified",
      "Re-generated",
      "Deprecated",
      "Bundle bootstrapped",
    ]);
  });

  test("non-date headings, entries before any date", () => {
    const log = parseLog(
      "# Log\n\n* early entry\n\n## Last week\n\n## 2026-13-01\n\n## 2026-05-22\n* ok\n",
      "a/log.md"
    );
    expect(log.directory).toBe("a");
    expect(log.problems.map(p => [p.code, p.line])).toEqual([
      ["log-date-heading", 5],
      ["log-date-heading", 7],
      ["log-entry-outside-date", 3],
    ]);
  });

  test("order, duplicates and empty dates", () => {
    const log = parseLog("# Log\n## 2026-05-01\n* a\n## 2026-05-22\n* b\n## 2026-05-22\n");
    expect(log.problems.map(p => [p.code, p.line])).toEqual([
      ["log-order", 4],
      ["log-duplicate-date", 6],
      ["log-empty-date", 6],
    ]);
  });

  test("prose entries and a log without a title", () => {
    const log = parseLog("## 2026-05-22\nRebuilt the\nwhole thing.\n\n## 2026-05-01\n- x\n");
    expect(log.title).toBeUndefined();
    expect(log.problems).toEqual([]);
    expect(log.days[0].entries).toEqual([{ text: "Rebuilt the whole thing.", kind: undefined, line: 2 }]);
  });

  test("intro prose before the first date is not an entry", () => {
    const log = parseLog("# Log\n\nWhat changed, newest first.\n\n## 2026-05-22\n* x\n");
    expect(log.problems).toEqual([]);
    expect(log.entries).toHaveLength(1);
  });
});
