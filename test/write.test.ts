/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as path from "path";

import { createBundle, readBundle } from "../src/bundle";
import { parseConcept } from "../src/concept";
import { generateIndex, generateIndexes } from "../src/generate";
import { parseIndex } from "../src/reserved";
import { writeConcept } from "../src/write";

import { BUNDLES, FIXTURES, filesUnder, fixture } from "./helpers";

describe("writeConcept: unchanged input is byte-identical", () => {
  const concepts = filesUnder(FIXTURES).filter(f => f.endsWith(".md") && !/(^|\/)(index|log)\.md$/.test(f));

  test("there are fixtures", () => expect(concepts.length).toBeGreaterThan(30));

  test.each(concepts)("%s", file => {
    const text = fixture(file);
    expect(writeConcept(parseConcept(text, file))).toBe(text);
  });

  test("odd inputs too: CRLF, BOM, comments, no body, no front matter, invalid YAML", () => {
    for (const text of [
      "﻿---\r\ntype: X\r\n# comment\r\n---\r\nbody\r\n",
      "---\ntype: X\n---",
      "# no front matter\n",
      "---\ntype: [X\n---\n",
      "---\ntype: X\n",
      "",
    ]) {
      expect(writeConcept(parseConcept(text, "x"))).toBe(text);
    }
  });

  test("reading values does not count as a change", () => {
    const text = fixture("spec/appendix-a/computations/revenue.md");
    const c = parseConcept(text, "x");
    void [c.sources, c.verified, c.trustTier, c.parameters, c.computation, c.links, c.frontMatter];
    c.set("status", "stable");
    expect(writeConcept(c)).toBe(text);
  });
});

describe("writeConcept: changes", () => {
  const text = [
    "---",
    "# A leading comment",
    "type: Metric",
    "title: Revenue   # inline comment",
    "description: Recognized revenue",
    "  for a fiscal year.",
    "x-owner: finance  # an unknown key",
    "tags: [finance, revenue]",
    "generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }",
    "",
    "# before sources",
    "sources:",
    "- id: a",
    "  resource: https://example.com/a",
    "status: stable",
    "---",
    "",
    "# Definition",
    "",
  ].join("\n");

  test("a changed key is re-rendered in place; everything else is copied", () => {
    const c = parseConcept(text, "x");
    c.set("title", "Recognized revenue");
    expect(writeConcept(c)).toBe(text.replace("title: Revenue   # inline comment", "title: Recognized revenue"));
  });

  test("a flow-style value stays in flow style", () => {
    const c = parseConcept(text, "x");
    c.set("generated", { by: "human:ahormati", at: "2026-07-01T09:00:00Z" });
    c.set("tags", [...c.tags, "kpi"]);
    const out = writeConcept(c);
    expect(out).toContain("generated: { by: human:ahormati, at: 2026-07-01T09:00:00Z }\n");
    expect(out).toContain("tags: [finance, revenue, kpi]\n");
    expect(parseConcept(out, "x").generated).toEqual({ by: "human:ahormati", at: "2026-07-01T09:00:00Z" });
  });

  test("mutating the live front matter is a change", () => {
    const c = parseConcept(text, "x");
    (c.frontMatter.sources as Record<string, unknown>[])[0].title = "Source A";
    const out = writeConcept(c);
    expect(out).toContain(
      "# before sources\nsources:\n  - id: a\n    resource: https://example.com/a\n    title: Source A\nstatus: stable\n"
    );
    expect(out.startsWith(text.slice(0, text.indexOf("# before sources")))).toBe(true);
  });

  test("new keys are appended; deleted keys dropped; key order kept", () => {
    const c = parseConcept(text, "x");
    c.set("verified", { by: "human:ahormati", at: new Date("2026-06-25T09:00:00Z") });
    c.delete("x-owner");
    const out = writeConcept(c);
    expect(out).not.toContain("x-owner");
    expect(out).toContain("status: stable\nverified:\n  by: human:ahormati\n  at: 2026-06-25T09:00:00Z\n---\n");
    expect(Object.keys(parseConcept(out, "x").frontMatter)).toEqual([
      "type",
      "title",
      "description",
      "tags",
      "generated",
      "sources",
      "status",
      "verified",
    ]);
  });

  test("a multi-line value is replaced whole", () => {
    const c = parseConcept(text, "x");
    c.set("description", "Short.");
    expect(writeConcept(c)).toContain("title: Revenue   # inline comment\ndescription: Short.\nx-owner: finance");
  });

  test("setting undefined deletes", () => {
    const c = parseConcept(text, "x");
    c.set("status", undefined);
    expect(writeConcept(c)).toContain("  resource: https://example.com/a\n---\n");
  });

  test("the body can be replaced alone", () => {
    const c = parseConcept(text, "x");
    c.body = "\n# New body\n";
    expect(writeConcept(c)).toBe(text.slice(0, text.lastIndexOf("---\n") + 4) + "\n# New body\n");
  });

  test("values that need quoting are quoted", () => {
    const c = parseConcept("---\ntype: X\n---\n", "x");
    c.set("title", "Incident response: data freshness alert");
    c.set("okf", "0.2");
    const out = writeConcept(c);
    expect(parseConcept(out, "x").frontMatter).toEqual({
      type: "X",
      title: "Incident response: data freshness alert",
      okf: "0.2",
    });
  });

  test("CRLF files stay CRLF", () => {
    const c = parseConcept("---\r\ntype: X\r\ntags: [a]\r\n---\r\nbody\r\n", "x");
    c.set("tags", ["a", "b"]);
    c.set("status", "draft");
    expect(writeConcept(c)).toBe("---\r\ntype: X\r\ntags: [a, b]\r\nstatus: draft\r\n---\r\nbody\r\n");
  });

  test("an empty front matter block gets its first keys", () => {
    const c = parseConcept("---\n---\nbody\n", "x");
    c.set("type", "Note");
    expect(writeConcept(c)).toBe("---\ntype: Note\n---\nbody\n");
  });

  test("a file without front matter gets one", () => {
    const c = parseConcept("# Notes\n", "x");
    c.set("type", "Note").set("tags", ["a"]);
    expect(writeConcept(c)).toBe("---\ntype: Note\ntags:\n  - a\n---\n# Notes\n");
  });

  test("a body change on an unparseable file keeps its front matter text", () => {
    const c = parseConcept("---\ntype: [X\n---\nold\n", "x");
    c.body = "new\n";
    expect(writeConcept(c)).toBe("---\ntype: [X\n---\nnew\n");
  });

  test("front matter changes on an unparseable file throw", () => {
    const c = parseConcept("---\ntype: [X\n---\n", "x");
    c.set("type", "Y");
    expect(() => writeConcept(c)).toThrow("did not parse");
  });

  test("the spec's Appendix A: re-verify the stale computation", () => {
    const original = fixture("spec/appendix-a/computations/profit.md");
    const c = parseConcept(original, "computations/profit");
    c.set("verified", [...c.verified, { by: "human:ahormati", at: "2026-07-02T10:00:00Z" }]);
    c.set("stale_after", "2026-12-31T00:00:00Z");
    const out = writeConcept(c);
    const again = parseConcept(out, "computations/profit");
    expect(again.trustTier).toBe("human-reviewed");
    expect(again.isStale(new Date("2026-07-03T00:00:00Z"))).toBe(false);
    // Only the two changed values differ; the flow-style verified stays flow style.
    expect(out).toBe(
      original
        .replace(
          "verified: { by: process:finance-nightly, at: 2026-06-12T08:00:00Z }",
          "verified: [ { by: process:finance-nightly, at: 2026-06-12T08:00:00Z }, { by: human:ahormati, at: 2026-07-02T10:00:00Z } ]"
        )
        .replace("stale_after: 2026-06-15T00:00:00Z", "stale_after: 2026-12-31T00:00:00Z")
    );
  });
});

describe("generateIndex (§8)", () => {
  const acme = readBundle(path.join(BUNDLES, "acme_retail"));

  test("a directory: one section per type, entries by title, descriptions from front matter", () => {
    expect(generateIndex(acme, "metrics")).toBe(
      [
        "# Metric",
        "",
        "* [Gross Margin](gross-margin.md) - Gross margin for a period, per Acme's FY2026 Cost Allocation Standard (product cost + inbound fulfillment + outbound shipping + payment fees).",
        "* [Gross Margin (legacy, pre-FY2026)](gross-margin-legacy.md) - Retired gross-margin definition that included only product cost. Preserved for historical query reproducibility. Do not use for new analyses.",
        "* [Revenue](revenue.md) - Recognized revenue for a period, per Acme's FY2026 revenue-recognition policy. Backed by an Attested Computation.",
        "",
      ].join("\n")
    );
  });

  test("the root: subdirectories keep their curated descriptions", () => {
    expect(generateIndex(acme)).toBe(
      [
        "# Subdirectories",
        "",
        "* [attesters](attesters/index.md) - Deterministic verification code for computation receipts.",
        "* [computations](computations/index.md) - Sanctioned SQL as Attested Computations for each metric.",
        "* [metrics](metrics/index.md) - Business definitions of Acme Retail's headline numbers.",
        "* [policies](policies/index.md) - Source-of-truth Finance policy documents.",
        "* [skills](skills/index.md) - Executor instructions for running Attested Computations.",
        "* [tables](tables/index.md) - BigQuery tables the bundle grounds against.",
        "",
      ].join("\n")
    );
  });

  test("curated entries for other files are kept", () => {
    expect(generateIndex(acme, "attesters")).toBe(fixture("bundles/acme_retail/attesters/index.md"));
  });

  test.each(["acme_retail", "ga4", "crypto_bitcoin"])(
    "%s: generated indexes parse cleanly and list what the sample's indexes list",
    name => {
      const bundle = readBundle(path.join(BUNDLES, name));
      const generated = generateIndexes(bundle);
      expect([...generated.keys()].sort()).toEqual([...bundle.indexes.values()].map(i => i.path).sort());
      for (const [file, text] of generated) {
        const index = parseIndex(text, file);
        expect([file, index.problems]).toEqual([file, []]);
        const targets = (i: typeof index): string[] =>
          i.entries.map(e => bundle.resolve(file, e.url).path ?? "").sort();
        const sample = bundle.indexes.get(index.directory);
        expect([file, targets(index)]).toEqual([file, sample ? targets(sample) : []]);
      }
    }
  );

  test("every directory, deterministic, sorted by path", () => {
    const all = generateIndexes(acme);
    expect([...all.keys()]).toEqual([
      "index.md",
      "attesters/index.md",
      "computations/index.md",
      "metrics/index.md",
      "policies/index.md",
      "skills/index.md",
      "tables/index.md",
    ]);
    expect(generateIndexes(acme)).toEqual(all);
  });

  test("a fresh bundle: untyped concepts, derived subdirectory descriptions, escaping", () => {
    const bundle = createBundle({
      "a.md": "---\ntype: Metric\ntitle: 'Zeta [beta]'\ndescription: Multi\n  line.\n---\n",
      "b.md": "---\ntitle: No type\n---\n",
      "notes and more.md": "---\ntype: Note\n---\n",
      "one/only.md": "---\ntype: Reference\ndescription: The only thing here.\n---\n",
      "two/x.md": "---\ntype: Reference\ndescription: X.\n---\n",
      "two/y.md": "---\ntype: Reference\n---\n",
      "empty/data.csv": "",
    });
    expect(generateIndex(bundle)).toBe(
      [
        "# Metric",
        "",
        "* [Zeta \\[beta\\]](a.md) - Multi line.",
        "",
        "# Note",
        "",
        "* [Notes and more](<notes and more.md>)",
        "",
        "# Other",
        "",
        "* [No type](b.md)",
        "",
        "# Subdirectories",
        "",
        "* [one](one/index.md) - The only thing here.",
        "* [two](two/index.md)",
        "",
      ].join("\n")
    );
    expect(generateIndex(bundle, "empty")).toBeUndefined();
    expect(generateIndex(bundle, "/two/")).toContain("* [X](x.md) - X.");
    const titled = generateIndex(bundle, "", { subdirectoriesHeading: "Folders", untypedHeading: "Misc" });
    expect(titled).toContain("# Folders");
    expect(titled).toContain("# Misc");
  });

  test("okf_version: kept from the root index, or set (§12)", () => {
    const files = { "index.md": '---\nokf_version: "0.2"\n---\n\n# Old\n', "a.md": "---\ntype: X\n---\n" };
    expect(generateIndex(createBundle(files))).toBe('---\nokf_version: "0.2"\n---\n\n# X\n\n* [A](a.md)\n');
    expect(generateIndex(createBundle({ "a.md": "---\ntype: X\n---\n" }), "", { okfVersion: "0.2" })).toBe(
      '---\nokf_version: "0.2"\n---\n\n# X\n\n* [A](a.md)\n'
    );
    expect(generateIndex(createBundle(files), "", { okfVersion: "0.3" })).toContain('okf_version: "0.3"');
  });

  test("a concept without a description keeps the index's curated one", () => {
    const bundle = createBundle({
      "index.md": "# X\n\n* [A](a.md) - Curated words.\n",
      "a.md": "---\ntype: X\n---\n",
    });
    expect(generateIndex(bundle)).toBe("# X\n\n* [A](a.md) - Curated words.\n");
  });
});
