/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "fs";
import * as path from "path";

import { createBundle, readBundle } from "../src/bundle";
import {
  Diagnostic,
  RULES,
  checkBundle,
  checkConcept,
  formatDiagnostics,
  isConformant,
  sortDiagnostics,
  summarize,
} from "../src/check";
import { parseConcept } from "../src/concept";

import { BUNDLES, SPEC, fixture } from "./helpers";

const NOW = new Date("2026-07-01T00:00:00Z");

/** The codes of a concept's diagnostics, info left out unless asked. */
function codesOf(text: string, withInfo = false): string[] {
  return checkConcept(parseConcept(text, "x"), { now: NOW, skipInfo: !withInfo }).map(d => d.code);
}

function bundleCodes(files: Record<string, string>, otherFiles: string[] = []): [string, string, number?][] {
  return checkBundle(createBundle(files, { otherFiles }), { now: NOW, skipInfo: true }).map(d => [
    d.code,
    d.file,
    d.line,
  ]);
}

const ok = (fm: string, body = ""): string => `---\ntype: Metric\ntitle: T\ndescription: D.\n${fm}---\n${body}`;

describe("§11 conformance: errors", () => {
  test("1. every concept has parseable front matter", () => {
    expect(codesOf("# No front matter\n")).toEqual(["front-matter-missing"]);
    expect(codesOf("---\ntype: X\n")).toEqual(["front-matter-unterminated"]);
    expect(codesOf("---\ntype: [X\n---\n")).toContain("front-matter-invalid");
    expect(codesOf("---\njust a string\n---\n")).toEqual(["front-matter-not-mapping"]);
  });

  test("2. every front matter has a non-empty type", () => {
    expect(codesOf("---\ntitle: T\n---\n")).toEqual(["type-missing"]);
    expect(codesOf("---\ntype:\n---\n")).toEqual(["type-missing"]);
    expect(codesOf("---\ntype: ''\n---\n")).toEqual(["type-invalid"]);
    expect(codesOf("---\ntype: [a]\n---\n")).toEqual(["type-invalid"]);
    expect(codesOf("---\ntype: 7\n---\n")).toEqual(["type-invalid"]);
  });

  test("a concept carrying just type is fully conformant (§4.1)", () => {
    const d = checkConcept(parseConcept("---\ntype: Reference\n---\n", "x"), { now: NOW });
    expect(isConformant(d)).toBe(true);
    expect(d.map(x => x.severity)).toEqual(["info", "info"]);
  });

  test("3. reserved files follow §8 and §9", () => {
    expect(
      bundleCodes({
        "index.md": "* [a](a.md) - outside\n# T\n* not a link\n",
        "sub/index.md": "---\nokf_version: '0.2'\n---\n# T\n* [b](b.md) - B\n",
        "sub/b.md": ok(""),
        "a.md": ok(""),
        "log.md": "# Log\n* early\n## Yesterday\n",
      })
    ).toEqual([
      ["index-entry-outside-section", "index.md", 1],
      ["index-empty-section", "index.md", 2],
      ["index-item-malformed", "index.md", 3],
      ["log-entry-outside-date", "log.md", 2],
      ["log-date-heading", "log.md", 3],
      ["index-front-matter", "sub/index.md", 1],
    ]);
  });

  test("errors carry the line of the problem", () => {
    const [d] = checkConcept(parseConcept("---\ntype: X\ntags: [a\n---\n", "x"));
    expect(d).toMatchObject({ severity: "error", code: "front-matter-invalid", file: "x.md", spec: "§11" });
    expect(d.line).toBeGreaterThanOrEqual(3);
  });
});

describe("positions", () => {
  test("front matter diagnostics carry the line and column of the value", () => {
    const [d] = checkConcept(parseConcept(ok("verified: [human:a]\n"), "x"), { now: NOW });
    expect(d).toMatchObject({ code: "verified-invalid", line: 5, column: 12 });
  });
});

describe("§11: what consumers must accept is never an error", () => {
  test("unknown types, unknown keys, missing optional families", () => {
    const d = checkConcept(parseConcept("---\ntype: Totally New Kind\nx-owner: me\nlevel: 3\n---\n", "x"));
    expect(isConformant(d)).toBe(true);
    expect(d.filter(x => x.severity !== "info")).toEqual([]);
  });

  test("broken links and missing index files are warnings at most", () => {
    const d = checkBundle(createBundle({ "a/b.md": ok("", "[gone](/nowhere.md)\n") }), { now: NOW });
    expect(isConformant(d)).toBe(true);
    expect(d.filter(x => x.severity !== "info").map(x => x.code)).toEqual(["link-broken"]);
  });

  test("the spec's examples are conformant and warning-free", () => {
    for (const file of ["4.3-orders.md", "4.4-playbook.md", "10.2-revenue.md", "10.4-metric.md"]) {
      const d = checkConcept(parseConcept(fixture(`spec/${file}`), file), { now: NOW });
      expect([file, d.filter(x => x.severity !== "info")]).toEqual([file, []]);
    }
  });

  test("Appendix A: conformant; the v0.1 form is noted, profit is stale", () => {
    const d = checkBundle(readBundle(path.join(SPEC, "appendix-a")), { now: NOW });
    expect(isConformant(d)).toBe(true);
    expect(d.map(x => [x.severity, x.code, x.file])).toEqual([
      ["warning", "path-broken", "computations/profit.md"],
      ["warning", "path-broken", "computations/profit.md"],
      ["info", "stale", "computations/profit.md"],
      ["warning", "path-broken", "computations/revenue.md"],
      ["warning", "path-broken", "computations/revenue.md"],
    ]);
    const v01 = checkConcept(parseConcept(fixture("spec/a-v0.1-income-statement.md"), "m"), { now: NOW });
    expect(v01.map(x => x.code)).toEqual(["legacy-timestamp", "legacy-citations"]);
  });

  test.each(["acme_retail", "ga4", "crypto_bitcoin"])("the %s sample bundle is conformant and warning-free", name => {
    const d = checkBundle(readBundle(path.join(BUNDLES, name)), { now: NOW });
    expect(isConformant(d)).toBe(true);
    expect(d.filter(x => x.severity === "warning")).toEqual([]);
  });
});

describe("soft guidance: warnings", () => {
  test("text fields and tags (§4.1)", () => {
    expect(codesOf("---\ntype: X\ntitle: [a]\ndescription: 3\nresource: { a: 1 }\ntags: a\n---\n")).toEqual([
      "field-not-string",
      "field-not-string",
      "field-not-string",
      "tags-invalid",
    ]);
    expect(codesOf("---\ntype: X\ntags: [a, 1]\n---\n")).toEqual(["tags-invalid"]);
  });

  test("timestamps need an explicit UTC offset (§5)", () => {
    expect(
      codesOf(
        ok(
          "generated: { by: human:a, at: 2026-06-20 }\nstale_after: 2026-12-31\nverified: { by: human:a, at: 2026-06-25T09:00:00 }\n"
        )
      )
    ).toEqual(["timestamp-invalid", "timestamp-invalid", "timestamp-invalid"]);
  });

  test("sources (§5.1)", () => {
    const text = ok(
      [
        "sources:",
        "  - id: a",
        "    resource: https://x",
        "    usage_count: -1",
        "    last_modified: yesterday",
        "  - id: a",
        "    title: no resource",
        "    usage_window: { from: 2026-06-30T00:00:00Z, to: 2026-06-01T00:00:00Z }",
        "  - just a string",
        "usage_window: [a]",
        "",
      ].join("\n"),
      "Claim.[^a] Other.[^b]\n\n[^a]: A\n[^b]: B\n"
    );
    expect(checkConcept(parseConcept(text, "x"), { now: NOW }).map(d => [d.code, d.line])).toEqual([
      ["usage-count-invalid", 8],
      ["timestamp-invalid", 9],
      ["source-id-duplicate", 10],
      ["source-resource-missing", 10],
      ["usage-window-invalid", 12],
      ["sources-invalid", 13],
      ["usage-window-invalid", 14],
      ["attribution-unknown", 16],
    ]);
    expect(codesOf(ok("sources: nope\n"))).toEqual(["sources-invalid"]);
  });

  test("footnotes are only joined when there are sources", () => {
    expect(codesOf(ok("", "A plain footnote.[^1]\n\n[^1]: Note.\n"))).toEqual([]);
  });

  test("generated and verified (§5.2) and actors (§7)", () => {
    expect(codesOf(ok("generated: human:a\n"))).toEqual(["generated-invalid"]);
    expect(codesOf(ok("generated: { at: 2026-06-20T22:53:05Z }\n"))).toEqual(["generated-invalid"]);
    expect(codesOf(ok("generated: { by: somebody, at: 2026-06-20T22:53:05Z }\n"))).toEqual(["actor-invalid"]);
    expect(codesOf(ok("verified: [human:a, { by: human:a }, { by: team:x, at: 2026-06-20T22:53:05Z }]\n"))).toEqual([
      "verified-invalid",
      "verified-invalid",
      "actor-invalid",
    ]);
  });

  test("sources[].author may use other prefixes (the spec's own team: authors)", () => {
    expect(codesOf(ok("sources:\n  - { resource: https://x, author: team:finance }\n"))).toEqual([]);
  });

  test("status (§5.4)", () => {
    expect(codesOf(ok("status: retired\n"))).toEqual(["status-unknown"]);
    expect(codesOf(ok("status: deprecated\n"))).toEqual([]);
  });

  test("attested computations (§10)", () => {
    const ac = (fm: string, body = "# Computation\n\n```sql\nSELECT 1\n```\n"): string =>
      `---\ntype: Attested Computation\ntitle: T\ndescription: D.\n${fm}---\n${body}`;
    expect(codesOf(ac("runtime: bigquery\n"))).toEqual([]);
    expect(codesOf(ac(""))).toEqual(["runtime-missing"]);
    expect(codesOf(ac("runtime: bigquery\n", "# Computation\n\nProse only.\n"))).toEqual(["computation-missing"]);
    expect(codesOf(ac("runtime: bigquery\ncomputation: lib/a.sql\n"))).toEqual(["computation-ambiguous"]);
    expect(codesOf(ac("runtime: bigquery\n", "# Computation\n```\nA\n```\n```\nB\n```\n"))).toEqual([
      "computation-ambiguous",
    ]);
    expect(codesOf(ac("runtime: dbt\ncomputation: lib/a.sql\n", ""))).toEqual([]);
    expect(
      codesOf(
        ac(
          "runtime: x\nparameters:\n  - { name: year }\n  - { name: y, type: int, required: maybe }\n  - str\nexecutor: run.md\nattester: { code: a.py }\n"
        )
      )
    ).toEqual([
      "parameters-invalid",
      "parameters-invalid",
      "parameters-invalid",
      "executor-invalid",
      "attester-invalid",
    ]);
    expect(codesOf(ac("runtime: x\nparameters: year\nexecutor: { resource: r.md, receipt: job_id }\n"))).toEqual([
      "parameters-invalid",
      "executor-invalid",
    ]);
  });

  test("links and path fields (§6)", () => {
    expect(
      bundleCodes(
        {
          "m/a.md": ok(
            "resource: /m/gone.md\nsources:\n  - resource: dashboards/exec\n  - resource: ../m/nope.csv\n  - resource: all queries in X\n",
            "[x](b.md) [y](../../out.md) [ok](/m/c.md) ![img](i.png)\n"
          ),
          "m/c.md": ok("computation: lib/x.sql\nexecutor: { resource: run.py }\n"),
        },
        ["run.py"]
      )
    ).toEqual([
      ["path-broken", "m/a.md", 5],
      ["path-broken", "m/a.md", 8],
      ["link-broken", "m/a.md", 11],
      ["link-outside", "m/a.md", 11],
      ["path-broken", "m/c.md", 5],
    ]);
  });

  test("index files (§8, §12)", () => {
    expect(
      bundleCodes({
        "index.md": "---\nokf_version: '9.9'\nextra: 1\n---\n# T\n* [a](a.md) words\n* [g](gone.md) - G\n# Empty\n",
        "a.md": ok(""),
        "s/index.md": "# Nothing here\n",
      })
    ).toEqual([
      ["index-extra-front-matter", "index.md", 1],
      ["okf-version-unknown", "index.md", 2],
      ["index-entry-separator", "index.md", 6],
      ["index-entry-broken", "index.md", 7],
      ["index-empty-section", "index.md", 8],
      ["index-empty", "s/index.md", 1],
    ]);
  });

  test("log files (§9)", () => {
    expect(bundleCodes({ "log.md": "# Log\n## 2026-01-01\n* a\n## 2026-02-01\n* b\n## 2026-02-01\n" })).toEqual([
      ["log-order", "log.md", 4],
      ["log-duplicate-date", "log.md", 6],
      ["log-empty-date", "log.md", 6],
    ]);
  });
});

describe("recommendations and observations: info", () => {
  test("title and description (§4.1)", () => {
    const d = checkConcept(parseConcept("---\ntype: X\n---\n", "tables/posts_answers"));
    expect(d.map(x => [x.code, x.message])).toEqual([
      ["description-missing", "No `description`"],
      ["title-missing", 'No `title`; consumers derive "Posts answers"'],
    ]);
  });

  test("stale (§5.5), judged against options.now", () => {
    const text = ok("stale_after: 2026-09-23T00:00:00Z\n");
    expect(codesOf(text, true)).toEqual([]);
    expect(checkConcept(parseConcept(text, "x"), { now: new Date("2026-09-23T00:00:00Z") }).map(d => d.code)).toEqual([
      "stale",
    ]);
  });

  test("index entries without descriptions; concepts missing from their index; log front matter", () => {
    const d = checkBundle(
      createBundle({
        "index.md": "# T\n* [a](a.md)\n",
        "a.md": ok(""),
        "b.md": ok(""),
        "log.md": "---\ntype: Log\n---\n# Log\n## 2026-01-01\n* x\n",
      }),
      { now: NOW }
    );
    expect(d.map(x => [x.severity, x.code, x.file])).toEqual([
      ["info", "index-missing-concept", "index.md"],
      ["info", "index-entry-no-description", "index.md"],
      ["info", "log-front-matter", "log.md"],
    ]);
  });
});

describe("output", () => {
  const diagnostics: Diagnostic[] = [
    {
      severity: "warning",
      code: "link-broken",
      message: "Link to x.md has no target",
      file: "b.md",
      line: 3,
      column: 5,
      spec: "§6.1",
    },
    { severity: "error", code: "type-missing", message: "No type", file: "a.md", line: 1, column: 1, spec: "§11" },
    { severity: "info", code: "stale", message: "Stale", file: "a.md", spec: "§5.5" },
  ];

  test("sorting: file, line, column, severity", () => {
    expect(sortDiagnostics(diagnostics).map(d => d.code)).toEqual(["stale", "type-missing", "link-broken"]);
  });

  test("text format", () => {
    expect(formatDiagnostics(sortDiagnostics(diagnostics))).toBe(
      [
        "a.md: note: Stale [stale]",
        "a.md:1:1: error: No type [type-missing]",
        "b.md:3:5: warning: Link to x.md has no target [link-broken]",
        "1 error, 1 warning, 1 note",
        "",
      ].join("\n")
    );
    expect(formatDiagnostics([])).toBe("0 errors, 0 warnings, 0 notes\n");
  });

  test("json format", () => {
    const json = JSON.parse(formatDiagnostics(diagnostics, "json"));
    expect(json.conformant).toBe(false);
    expect(json.summary).toEqual({ errors: 1, warnings: 1, infos: 1 });
    expect(json.diagnostics).toHaveLength(3);
    expect(summarize([])).toEqual({ errors: 0, warnings: 0, infos: 0 });
  });

  test("every rule has a severity, a spec section and a summary", () => {
    for (const [code, rule] of Object.entries(RULES)) {
      expect([code, ["error", "warning", "info"].includes(rule.severity)]).toEqual([code, true]);
      expect(rule.spec).toMatch(/^§\d+(\.\d+)?$/);
      expect(rule.summary.length).toBeGreaterThan(5);
    }
  });

  test("docs/rules.md lists every rule with its severity and spec section", () => {
    const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "rules.md"), "utf8");
    for (const [code, rule] of Object.entries(RULES)) {
      expect(doc).toContain(`| \`${code}\` | ${rule.spec} | ${rule.summary} |`);
    }
  });

  test("deterministic: the same bundle gives the same output", () => {
    const run = (): string =>
      formatDiagnostics(checkBundle(readBundle(path.join(BUNDLES, "acme_retail")), { now: NOW }), "json");
    expect(run()).toBe(run());
  });
});
