/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { parseConcept } from "../src/concept";
import { splitFrontMatter } from "../src/frontmatter";

import { fixture } from "./helpers";

describe("front matter (§4)", () => {
  test("split keeps every part as written", () => {
    const text = "---\ntype: X\n---\n\n# Body\n";
    const s = splitFrontMatter(text);
    expect(s).toMatchObject({ present: true, closed: true, open: "---\n", yaml: "type: X\n", close: "---\n" });
    expect(s.body).toBe("\n# Body\n");
    expect(s.yamlLine).toBe(2);
    expect(s.bodyLine).toBe(4);
    expect(s.bom + s.open + s.yaml + s.close + s.body).toBe(text);
  });

  test("CRLF, BOM, trailing spaces on delimiters, empty block, no body", () => {
    const s = splitFrontMatter("﻿---  \r\ntype: X\r\n---\r\n");
    expect(s).toMatchObject({ bom: "﻿", closed: true, yaml: "type: X\r\n", body: "", eol: "\r\n" });
    expect(splitFrontMatter("---\n---\nbody")).toMatchObject({ closed: true, yaml: "", body: "body" });
    expect(splitFrontMatter("---\ntype: X\n---")).toMatchObject({ closed: true, close: "---", body: "" });
  });

  test("absent or unterminated", () => {
    expect(splitFrontMatter("# Just markdown\n")).toMatchObject({ present: false, body: "# Just markdown\n" });
    expect(splitFrontMatter("----\ntype: X\n----\n")).toMatchObject({ present: false });
    expect(splitFrontMatter("---\ntype: X\n")).toMatchObject({ present: true, closed: false });
  });
});

describe("parseConcept: problems", () => {
  test("no front matter", () => {
    const c = parseConcept("# Notes\n", "notes");
    expect(c.problems.map(p => p.code)).toEqual(["front-matter-missing"]);
    expect(c.hasFrontMatter).toBe(false);
    expect(c.body).toBe("# Notes\n");
  });

  test("unterminated", () => {
    expect(parseConcept("---\ntype: X\n", "x").problems.map(p => p.code)).toEqual(["front-matter-unterminated"]);
  });

  test("invalid YAML, with the file line", () => {
    const c = parseConcept("---\ntype: X\ntags: [a, b\n---\n", "x");
    expect(c.problems[0].code).toBe("front-matter-invalid");
    expect(c.problems[0].line).toBeGreaterThanOrEqual(3);
    expect(c.frontMatter).toEqual({});
  });

  test("duplicate keys are invalid YAML", () => {
    expect(parseConcept("---\ntype: X\ntype: Y\n---\n", "x").problems[0].code).toBe("front-matter-invalid");
  });

  test("not a mapping", () => {
    const c = parseConcept("---\n- a\n- b\n---\n", "x");
    expect(c.problems).toEqual([expect.objectContaining({ code: "front-matter-not-mapping", line: 2 })]);
  });

  test("an empty block parses to no keys", () => {
    const c = parseConcept("---\n---\n", "x");
    expect(c.problems).toEqual([]);
    expect(c.frontMatter).toEqual({});
    expect(c.type).toBeUndefined();
  });

  test("the id drops .md; the path adds it", () => {
    const c = parseConcept("---\ntype: X\n---\n", "tables/orders.md");
    expect(c.id).toBe("tables/orders");
    expect(c.path).toBe("tables/orders.md");
  });
});

describe("§4.3 a concept bound to a resource", () => {
  const c = parseConcept(fixture("spec/4.3-orders.md"), "tables/orders");

  test("core fields", () => {
    expect(c.problems).toEqual([]);
    expect(c.type).toBe("BigQuery Table");
    expect(c.title).toBe("Customer Orders");
    expect(c.hasTitle).toBe(true);
    expect(c.description).toBe("One row per completed customer order across all channels.");
    expect(c.resource).toBe("https://console.cloud.google.com/bigquery?p=acme&d=sales&t=orders");
    expect(c.tags).toEqual(["sales", "orders", "revenue"]);
  });

  test("generated, with the timestamp kept as written", () => {
    expect(c.generated).toEqual({ by: "reference_agent/gemini-2.5-pro", at: "2026-05-28T14:30:00Z" });
    expect(c.lastChanged).toBe("2026-05-28T14:30:00Z");
  });

  test("defaults of the absent families (§5)", () => {
    expect(c.verified).toEqual([]);
    expect(c.trustTier).toBe("unverified");
    expect(c.status).toBe("stable");
    expect(c.staleAfter).toBeUndefined();
    expect(c.isStale()).toBe(false);
    expect(c.sources).toEqual([]);
    expect(c.isAttestedComputation).toBe(false);
  });

  test("body: headings and links (the table cell link included)", () => {
    expect(c.headings.map(h => [h.text, h.line])).toEqual([
      ["Schema", 10],
      ["Joins", 19],
    ]);
    expect(c.links.map(l => [l.url, l.line])).toEqual([
      ["/tables/customers.md", 15],
      ["/tables/customers.md", 21],
    ]);
    expect(c.body.startsWith("\n# Schema\n")).toBe(true);
  });

  test("lineOf for keys", () => {
    expect(c.lineOf("type")).toBe(2);
    expect(c.lineOf("generated")).toBe(7);
    expect(c.lineOf(["generated", "at"])).toBe(7);
    expect(c.lineOf("nope")).toBeUndefined();
    const line7 = fixture("spec/4.3-orders.md").split("\n")[6];
    expect(c.positionOf(["generated", "at"])).toEqual({ line: 7, column: line7.indexOf("at:") + 1 });
    expect(c.positionOf(["tags", 1])).toEqual({ line: 6, column: 15 });
    expect(c.positionOf(["type", "x"])).toBeUndefined();
    expect(c.lineOf(["tags", 5])).toBeUndefined();
  });
});

describe("§4.4 a concept not bound to a resource", () => {
  const c = parseConcept(fixture("spec/4.4-playbook.md"), "playbooks/freshness");

  test("quoted title, no resource, human author", () => {
    expect(c.type).toBe("Playbook");
    expect(c.title).toBe("Incident response: data freshness alert");
    expect(c.resource).toBeUndefined();
    expect(c.generated?.by).toBe("human:ahormati");
    expect(c.links.map(l => l.url)).toEqual(["/tables/orders.md", "https://example.com/dash"]);
  });
});

describe("§10.2 an Attested Computation", () => {
  const c = parseConcept(fixture("spec/10.2-revenue.md"), "computations/revenue");

  test("contract fields", () => {
    expect(c.isAttestedComputation).toBe(true);
    expect(c.runtime).toBe("bigquery");
    expect(c.parameters).toEqual([
      { name: "year", type: "integer", required: true, raw: { name: "year", type: "integer", required: true } },
    ]);
    expect(c.executor).toMatchObject({
      resource: "references/skills/run-on-bq.md",
      receipt: ["job_id", "executed_sql", "result"],
    });
    expect(c.attester).toMatchObject({ resource: "references/attesters/revenue.py" });
    expect(c.computationPath).toBeUndefined();
  });

  test("the inline computation is the indented block under # Computation (§10.3)", () => {
    expect(c.computation).toEqual({
      kind: "inline",
      code: "SELECT SUM(amount) AS revenue\nFROM finance.recognized_revenue\nWHERE fiscal_year = @year\n",
      language: "",
      line: 25,
    });
  });

  test("trust: a bare verified mapping is one human event (§5.2, §5.3)", () => {
    expect(c.verified).toEqual([{ by: "human:ahormati", at: "2026-06-25T09:00:00Z" }]);
    expect(c.trustTier).toBe("human-reviewed");
    expect(c.lastVerified).toBe("2026-06-25T09:00:00Z");
  });

  test("lifecycle (§5.4, §5.5): stale on and after the instant", () => {
    expect(c.status).toBe("stable");
    expect(c.staleAfter).toBe("2026-09-23T00:00:00Z");
    expect(c.isStale(new Date("2026-09-22T23:59:59Z"))).toBe(false);
    expect(c.isStale(new Date("2026-09-23T00:00:00Z"))).toBe(true);
    expect(c.isStale(new Date("2027-01-01T00:00:00Z"))).toBe(true);
  });

  test("per-claim attribution joins footnotes to sources (§5.1)", () => {
    expect(c.attributions).toEqual([
      expect.objectContaining({ label: "rev-policy", source: expect.objectContaining({ id: "rev-policy" }) }),
    ]);
    expect(c.source("rev-policy")?.title).toBe("Revenue recognition policy");
    expect(c.source("nope")).toBeUndefined();
  });
});

describe("§10.4 a concept that uses a computation", () => {
  test("links to the computation with a relative path", () => {
    const c = parseConcept(fixture("spec/10.4-metric.md"), "metrics/revenue");
    expect(c.type).toBe("Metric");
    expect(c.links.map(l => l.url)).toEqual(["../computations/revenue.md"]);
    expect(c.computation).toBeUndefined();
  });
});

describe("Appendix A", () => {
  const revenue = parseConcept(fixture("spec/appendix-a/computations/revenue.md"), "computations/revenue");
  const profit = parseConcept(fixture("spec/appendix-a/computations/profit.md"), "computations/profit");
  const statement = parseConcept(fixture("spec/appendix-a/metrics/income-statement.md"), "metrics/income-statement");
  const now = new Date("2026-07-01T00:00:00Z");

  test("revenue: human-reviewed and fresh; profit: machine-confirmed and stale", () => {
    expect([revenue.trustTier, revenue.isStale(now)]).toEqual(["human-reviewed", false]);
    expect([profit.trustTier, profit.isStale(now)]).toEqual(["machine-confirmed", true]);
  });

  test("source credibility signals and the shared usage window (§5.1)", () => {
    const dash = revenue.source("exec-rev-dash");
    expect(dash).toMatchObject({
      resource: "dashboards/exec-revenue",
      author: "team:finance-fpa",
      usageCount: 5000,
      lastModified: "2026-06-18T00:00:00Z",
      usageWindow: { from: "2026-06-01T00:00:00Z", to: "2026-06-30T00:00:00Z" },
    });
    expect(revenue.usageWindow).toEqual({ from: "2026-06-01T00:00:00Z", to: "2026-06-30T00:00:00Z" });
    expect(revenue.attributions.map(a => [a.label, a.source?.id])).toEqual([
      ["rev-policy", "rev-policy"],
      ["exec-rev-dash", "exec-rev-dash"],
    ]);
  });

  test("profit: dbt with two parameters, a templated computation", () => {
    expect(profit.runtime).toBe("dbt");
    expect(profit.parameters.map(p => [p.name, p.type, p.required])).toEqual([
      ["year", "integer", true],
      ["segment", "string", true],
    ]);
    expect(profit.computation?.code).toContain("{{ ref('fct_income_statement') }}");
    expect(profit.executor?.receipt).toEqual(["run_id", "compiled_sql", "result"]);
  });

  test("the income statement narrates and links both computations", () => {
    expect(statement.links.map(l => l.url)).toEqual(["../computations/revenue.md", "../computations/profit.md"]);
    expect(statement.trustTier).toBe("human-reviewed");
    expect(statement.isStale(now)).toBe(false);
  });

  test("the v0.1 form: legacy timestamp and # Citations (§13.1)", () => {
    const v01 = parseConcept(fixture("spec/a-v0.1-income-statement.md"), "metrics/income-statement");
    expect(v01.generated).toBeUndefined();
    expect(v01.lastChanged).toBe("2026-05-28T22:53:05+00:00");
    expect(v01.legacyCitations).toEqual([
      "https://wiki.acme/finance/fpa-handbook",
      "https://wiki.acme/finance/revenue-recognition",
      "https://wiki.acme/finance/cost-allocation",
    ]);
    expect(v01.trustTier).toBe("unverified");
  });
});

describe("access: fallbacks and odd shapes", () => {
  test("title from the file name when absent or empty (§4.1)", () => {
    expect(parseConcept("---\ntype: X\n---\n", "tables/posts_answers").title).toBe("Posts answers");
    expect(parseConcept("---\ntype: X\ntitle: ''\n---\n", "a/b").hasTitle).toBe(false);
  });

  test("non-string type", () => {
    expect(parseConcept("---\ntype: 3\n---\n", "x").type).toBeUndefined();
    expect(parseConcept("---\ntype: '  '\n---\n", "x").type).toBeUndefined();
  });

  test("unknown keys are kept and listed (§4.1)", () => {
    const c = parseConcept("---\ntype: X\nowner: data-team\nx-custom: { a: 1 }\n---\n", "x");
    expect(c.extensionKeys).toEqual(["owner", "x-custom"]);
    expect(c.get("x-custom")).toEqual({ a: 1 });
  });

  test("unknown status values are returned as written", () => {
    expect(parseConcept("---\ntype: X\nstatus: retired\n---\n", "x").status).toBe("retired");
    expect(parseConcept("---\ntype: X\nstatus: deprecated\n---\n", "x").isDeprecated).toBe(true);
  });

  test("a date-only stale_after is never stale (no instant)", () => {
    expect(parseConcept("---\ntype: X\nstale_after: 2020-01-01\n---\n", "x").isStale()).toBe(false);
  });

  test("lastVerified picks the latest event", () => {
    const c = parseConcept(
      "---\ntype: X\nverified:\n  - { by: human:a, at: 2026-06-25T09:00:00Z }\n  - { by: process:n, at: 2026-06-26T02:00:00Z }\n  - { by: process:n, at: nope }\n---\n",
      "x"
    );
    expect(c.lastVerified).toBe("2026-06-26T02:00:00Z");
    expect(c.trustTier).toBe("human-reviewed");
  });

  test("a computation file instead of a body block (§10.3)", () => {
    const c = parseConcept(
      "---\ntype: Attested Computation\nruntime: bigquery\ncomputation: references/computations/lib/revenue.sql\n---\n",
      "c"
    );
    expect(c.computation).toEqual({ kind: "file", path: "references/computations/lib/revenue.sql" });
  });

  test("set, delete and body edits are live", () => {
    const c = parseConcept("---\ntype: X\n---\nold\n", "x");
    c.set("title", "New").delete("type");
    c.body = "new [l](l.md)\n";
    expect(c.frontMatter).toEqual({ title: "New" });
    expect(c.links.map(l => l.url)).toEqual(["l.md"]);
    c.frontMatter = { type: "Y" };
    expect(c.type).toBe("Y");
  });

  test("code blocks under a heading stop at the next heading of that level", () => {
    const c = parseConcept("---\ntype: X\n---\n# Computation\n## Detail\n```sql\nA\n```\n# Other\n```\nB\n```\n", "x");
    expect(c.computationBlocks.map(b => b.code)).toEqual(["A\n"]);
    expect(c.blocksUnder("Missing")).toEqual([]);
    expect(c.lineCount).toBe(12);
  });
});
