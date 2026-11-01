/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { createBundle, readBundle } from "../src/bundle";
import { normalizePath, relativePath, resolveTarget } from "../src/paths";

import { BUNDLES, SPEC, fixture } from "./helpers";

describe("paths (§6)", () => {
  const index = {
    files: new Set(["tables/orders.md", "tables/customers.md", "tables/index.md", "log.md", "references/check.py"]),
    directories: new Set(["", "tables", "references"]),
  };

  test("normalizePath", () => {
    expect(normalizePath("a/./b/../c")).toBe("a/c");
    expect(normalizePath("/a//b/")).toBe("a/b");
    expect(normalizePath("../a")).toBeUndefined();
  });

  test("bundle-absolute and relative links (§6.1)", () => {
    expect(resolveTarget("playbooks/x.md", "/tables/customers.md", index)).toEqual({
      kind: "concept",
      path: "tables/customers.md",
      conceptId: "tables/customers",
      fragment: undefined,
      exists: true,
      base: "root",
    });
    expect(resolveTarget("tables/orders.md", "./customers.md#keys", index)).toMatchObject({
      kind: "concept",
      conceptId: "tables/customers",
      fragment: "keys",
      exists: true,
      base: "file",
    });
    expect(resolveTarget("tables/orders.md", "../tables/customers.md", index)).toMatchObject({ exists: true });
    expect(resolveTarget("tables/orders.md", "missing.md", index)).toMatchObject({
      kind: "concept",
      conceptId: "tables/missing",
      exists: false,
    });
  });

  test("kinds: external, anchor, reserved files, directories, other files, outside", () => {
    const k = (url: string, from = "tables/orders.md"): unknown => resolveTarget(from, url, index).kind;
    expect(k("https://example.com/x.md")).toBe("external");
    expect(k("mailto:a@example.com")).toBe("external");
    expect(k("//cdn.example.com/x")).toBe("external");
    expect(k("#schema")).toBe("anchor");
    expect(k("")).toBe("anchor");
    expect(k("index.md")).toBe("index");
    expect(k("/log.md")).toBe("log");
    expect(k("../tables/")).toBe("directory");
    expect(k("../references")).toBe("directory");
    expect(k("/references/check.py")).toBe("file");
    expect(k("../../x.md")).toBe("outside");
    expect(k("/../x.md")).toBe("outside");
  });

  test("percent-encoding and queries", () => {
    expect(resolveTarget("a.md", "tables/orders.md?plain=1", index)).toMatchObject({ exists: true });
    expect(resolveTarget("a.md", "tables%2Forders.md", index)).toMatchObject({ exists: true });
    expect(resolveTarget("a.md", "tables/%E0%A4%A.md", index)).toMatchObject({ exists: false });
  });

  test("root fallback for bare relative paths (§6.2)", () => {
    expect(resolveTarget("tables/orders.md", "references/check.py", index)).toMatchObject({ exists: false });
    expect(resolveTarget("tables/orders.md", "references/check.py", index, true)).toMatchObject({
      kind: "file",
      path: "references/check.py",
      exists: true,
      base: "root",
    });
    // An explicit ./ or ../ never falls back.
    expect(resolveTarget("tables/orders.md", "./references/check.py", index, true)).toMatchObject({ exists: false });
    // Nothing at either place: the file-relative reading is reported.
    expect(resolveTarget("tables/orders.md", "nope/x.py", index, true)).toMatchObject({
      path: "tables/nope/x.py",
      base: "file",
    });
  });

  test("relativePath", () => {
    expect(relativePath("", "tables/orders.md")).toBe("tables/orders.md");
    expect(relativePath("tables", "tables/orders.md")).toBe("orders.md");
    expect(relativePath("metrics", "computations/revenue.md")).toBe("../computations/revenue.md");
    expect(relativePath("a/b", "a/c/d.md")).toBe("../c/d.md");
  });
});

describe("readBundle (§3)", () => {
  const bundle = readBundle(path.join(BUNDLES, "acme_retail"));

  test("concepts, index files, log files and other files", () => {
    expect([...bundle.concepts.keys()]).toEqual([
      "computations/gross-margin-period",
      "computations/revenue-ytd",
      "metrics/gross-margin",
      "metrics/gross-margin-legacy",
      "metrics/revenue",
      "policies/margin-standard",
      "policies/revenue-recognition",
      "skills/run-on-bq",
      "tables/orders",
    ]);
    expect([...bundle.indexes.keys()]).toEqual([
      "",
      "attesters",
      "computations",
      "metrics",
      "policies",
      "skills",
      "tables",
    ]);
    expect([...bundle.logs.keys()]).toEqual([""]);
    expect(bundle.files).toContain("attesters/sql_equality.py");
    expect(bundle.directories).toEqual(["", "attesters", "computations", "metrics", "policies", "skills", "tables"]);
    expect(bundle.root).toBe(path.join(BUNDLES, "acme_retail"));
  });

  test("bodies are exactly as written", () => {
    const c = bundle.concept("tables/orders.md");
    const text = fixture("bundles/acme_retail/tables/orders.md");
    expect(c?.text).toBe(text);
    expect(text.endsWith(c?.body ?? "\0")).toBe(true);
  });

  test("lookups by id: with or without .md and a leading slash", () => {
    expect(bundle.concept("/metrics/revenue.md")?.title).toBe(bundle.concept("metrics/revenue")?.title);
    expect(bundle.concept("nope")).toBeUndefined();
  });

  test("outgoing links, resolved", () => {
    const out = bundle.outgoing("metrics/gross-margin-legacy");
    expect(out.map(l => [l.link.url, l.kind, l.conceptId, l.exists])).toEqual([
      ["./gross-margin.md", "concept", "metrics/gross-margin", true],
    ]);
    expect(out[0]).toMatchObject({ from: "metrics/gross-margin-legacy.md", fromKind: "concept" });
    expect(bundle.outgoing("nope")).toEqual([]);
  });

  test("backlinks, from concepts and optionally from index and log files", () => {
    const from = (id: string, includeReserved = false): string[] =>
      bundle.backlinks(id, { includeReserved }).map(l => l.from);
    expect(from("metrics/gross-margin")).toEqual(
      expect.arrayContaining(["metrics/gross-margin-legacy.md", "policies/margin-standard.md"])
    );
    expect(from("metrics/gross-margin")).not.toContain("metrics/index.md");
    expect(from("metrics/gross-margin", true)).toContain("metrics/index.md");
  });

  test("the sample bundle has no broken links", () => {
    expect(bundle.brokenLinks()).toEqual([]);
    expect(bundle.brokenLinks({ includeReserved: true })).toEqual([]);
  });

  test("path-valued fields (§6.2), bare paths resolved from the root as the samples write them", () => {
    const fields = bundle.pathFields("computations/revenue-ytd");
    expect(fields.map(f => [f.field, f.kind, f.path, f.exists, f.base])).toEqual([
      ["sources[0].resource", "concept", "policies/revenue-recognition.md", true, "root"],
      ["sources[1].resource", "concept", "tables/orders.md", true, "root"],
      ["executor.resource", "concept", "skills/run-on-bq.md", true, "root"],
      ["attester.resource", "file", "attesters/sql_equality.py", true, "root"],
    ]);
    expect(bundle.pathFields("nope")).toEqual([]);
  });

  test("tags and types across the bundle", () => {
    expect(bundle.tags.get("finance")).toEqual(
      expect.arrayContaining(["computations/revenue-ytd", "metrics/revenue", "metrics/gross-margin"])
    );
    expect([...bundle.tags.keys()]).toEqual([...bundle.tags.keys()].sort());
    expect(bundle.types.get("Attested Computation")).toEqual([
      "computations/gross-margin-period",
      "computations/revenue-ytd",
    ]);
    expect(bundle.byType("Metric").map(c => c.id)).toHaveLength(3);
    expect(bundle.byTag("deprecated").map(c => c.id)).toEqual(["metrics/gross-margin-legacy"]);
  });

  test("the directory tree", () => {
    const tree = bundle.tree();
    expect(tree.path).toBe("");
    expect(tree.index?.path).toBe("index.md");
    expect(tree.log?.path).toBe("log.md");
    expect(tree.concepts).toEqual([]);
    expect(tree.directories.map(d => d.name)).toEqual([
      "attesters",
      "computations",
      "metrics",
      "policies",
      "skills",
      "tables",
    ]);
    const attesters = tree.directories[0];
    expect(attesters.files).toEqual(["attesters/sql_equality.py"]);
    expect(tree.directories[2].concepts).toEqual([
      "metrics/gross-margin",
      "metrics/gross-margin-legacy",
      "metrics/revenue",
    ]);
  });

  test("the bundle has no okf_version", () => {
    expect(bundle.okfVersion).toBeUndefined();
  });
});

describe("the other sample bundles", () => {
  test.each(["ga4", "crypto_bitcoin"])("%s reads with no broken links", name => {
    const bundle = readBundle(path.join(BUNDLES, name));
    expect(bundle.concepts.size).toBeGreaterThan(5);
    expect(bundle.brokenLinks({ includeReserved: true })).toEqual([]);
    for (const c of bundle.concepts.values()) {
      expect(c.problems).toEqual([]);
      expect(c.type).toBeDefined();
    }
  });

  test("ga4: block-style generated with a quoted timestamp", () => {
    const events = readBundle(path.join(BUNDLES, "ga4")).concept("tables/events_");
    expect(events?.generated).toEqual({ by: "reference_agent/gemini-3.5-flash", at: "2026-07-10T21:15:20+00:00" });
    expect(events?.description).toBe(
      "Google Analytics 4 event-level daily sharded export tables containing user interaction logs."
    );
    expect(events?.attributions.every(a => a.source !== undefined)).toBe(true);
  });
});

describe("Appendix A as a bundle", () => {
  const bundle = readBundle(path.join(SPEC, "appendix-a"));

  test("the narrative concept links both computations; they link back", () => {
    expect(bundle.outgoing("metrics/income-statement").map(l => [l.conceptId, l.exists])).toEqual([
      ["computations/revenue", true],
      ["computations/profit", true],
    ]);
    expect(bundle.backlinks("computations/profit").map(l => l.fromConcept)).toEqual(["metrics/income-statement"]);
  });

  test("references/ are not part of the example: path fields resolve but do not exist", () => {
    const fields = bundle.pathFields("computations/revenue");
    expect(fields.map(f => [f.field, f.kind, f.exists])).toEqual([
      ["sources[0].resource", "external", true],
      ["sources[1].resource", "file", false],
      ["executor.resource", "concept", false],
      ["attester.resource", "file", false],
    ]);
  });
});

describe("createBundle", () => {
  test("from texts in memory, with other files and Windows separators", () => {
    const bundle = createBundle(
      {
        "a.md": "---\ntype: X\n---\n[b](sub/b.md) [c](c.md) ![img](pic.png) [up](../x.md) [d](/sub/)\n",
        "sub\\b.md": "---\ntype: X\ntags: [t, t]\n---\n[a](../a.md)\n",
        "/index.md": "# X\n* [a](a.md) - A\n* [gone](gone.md) - Gone\n",
      },
      { otherFiles: ["pic.png"] }
    );
    expect([...bundle.concepts.keys()]).toEqual(["a", "sub/b"]);
    expect(bundle.files).toEqual(["a.md", "index.md", "pic.png", "sub/b.md"]);
    expect(bundle.directories).toEqual(["", "sub"]);
    expect(bundle.brokenLinks().map(l => [l.link.url, l.kind])).toEqual([
      ["c.md", "concept"],
      ["../x.md", "outside"],
    ]);
    expect(bundle.brokenLinks({ includeReserved: true }).map(l => l.link.url)).toContain("gone.md");
    expect(bundle.outgoing("a").find(l => l.link.url === "/sub/")).toMatchObject({ kind: "directory", exists: true });
    expect(bundle.tags.get("t")).toEqual(["sub/b"]);
    expect(bundle.subdirectories("")).toEqual(["sub"]);
  });

  test("a concept does not backlink itself", () => {
    const bundle = createBundle({
      "a.md": "---\ntype: X\n---\n[me](a.md) [b](b.md)\n",
      "b.md": "---\ntype: X\n---\n[a](a.md)\n",
    });
    expect(bundle.backlinks("a").map(l => l.from)).toEqual(["b.md"]);
  });

  test("accepts a Map", () => {
    expect(createBundle(new Map([["x.md", "---\ntype: X\n---\n"]])).concepts.size).toBe(1);
  });
});

describe("readBundle on disk", () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "okf-it-"));
    fs.mkdirSync(path.join(dir, "notes"));
    fs.mkdirSync(path.join(dir, ".git"));
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "notes", "a.md"), "---\ntype: Note\n---\n");
    fs.writeFileSync(path.join(dir, ".git", "x.md"), "nope");
    fs.writeFileSync(path.join(dir, "node_modules", "y.md"), "nope");
    fs.writeFileSync(path.join(dir, ".hidden.md"), "nope");
    fs.writeFileSync(path.join(dir, "README.MD"), "---\ntype: Readme\n---\n");
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("skips hidden entries and node_modules; .md is case-insensitive", () => {
    const bundle = readBundle(dir);
    expect([...bundle.concepts.keys()]).toEqual(["README", "notes/a"]);
  });

  test("a custom ignore", () => {
    const bundle = readBundle(dir, { ignore: p => p === "notes" });
    expect([...bundle.concepts.keys()]).toContain(".hidden");
    expect([...bundle.concepts.keys()]).not.toContain("notes/a");
  });

  test("not a directory", () => {
    expect(() => readBundle(path.join(dir, "README.MD"))).toThrow("not a directory");
  });
});
