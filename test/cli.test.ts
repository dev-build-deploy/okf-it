/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { main } from "../src/cli";

import { BUNDLES, SPEC } from "./helpers";

function run(...argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = main(argv, { stdout: t => (out += t), stderr: t => (err += t) });
  return { code, out, err };
}

describe("okf-it check", () => {
  test("a conformant bundle exits 0", () => {
    const r = run("check", path.join(BUNDLES, "acme_retail"), "--now", "2026-07-01T00:00:00Z");
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      "log.md:1:1: note: §9 defines no front matter for log files [log-front-matter]\n0 errors, 0 warnings, 1 note\n"
    );
  });

  test("--no-info and --json", () => {
    const r = run("check", path.join(BUNDLES, "acme_retail"), "--no-info", "--json");
    expect(JSON.parse(r.out)).toEqual({
      conformant: true,
      summary: { errors: 0, warnings: 0, infos: 0 },
      diagnostics: [],
    });
  });

  test("staleness follows --now", () => {
    const r = run("check", path.join(SPEC, "appendix-a"), "--now", "2026-07-01T00:00:00Z");
    expect(r.out).toContain("computations/profit.md:18:1: note: Stale since 2026-06-15T00:00:00Z [stale]");
    expect(run("check", path.join(SPEC, "appendix-a"), "--now", "2026-06-01T00:00:00Z").out).not.toContain("[stale]");
  });

  test("a non-conformant bundle exits 1", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "okf-it-cli-"));
    fs.writeFileSync(path.join(dir, "a.md"), "# no front matter\n");
    const r = run("check", dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("a.md:1:1: error:");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("bad --now", () => {
    expect(run("check", SPEC, "--now", "soon")).toMatchObject({
      code: 2,
      err: "okf-it: --now soon is not a datetime\n",
    });
  });
});

describe("okf-it index", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "okf-it-cli-"));
    fs.mkdirSync(path.join(dir, "tables"));
    fs.writeFileSync(path.join(dir, "tables", "orders.md"), "---\ntype: Table\ndescription: Orders.\n---\n");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("prints every index", () => {
    const r = run("index", dir);
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      "==> index.md <==\n# Subdirectories\n\n* [tables](tables/index.md) - Orders.\n\n==> tables/index.md <==\n# Table\n\n* [Orders](orders.md) - Orders.\n"
    );
  });

  test("--check fails while out of date; --write fixes it; then --check passes", () => {
    expect(run("index", dir, "--check")).toMatchObject({
      code: 1,
      out: "out of date: index.md\nout of date: tables/index.md\n2 of 2 index files out of date\n",
    });
    expect(run("index", dir, "--write")).toMatchObject({
      code: 0,
      out: "wrote: index.md\nwrote: tables/index.md\n2 of 2 index files written\n",
    });
    expect(fs.readFileSync(path.join(dir, "tables", "index.md"), "utf8")).toBe(
      "# Table\n\n* [Orders](orders.md) - Orders.\n"
    );
    expect(run("index", dir, "--check")).toMatchObject({ code: 0, out: "0 of 2 index files out of date\n" });
  });

  test("--json and --okf-version", () => {
    const r = run("index", dir, "--json", "--okf-version", "0.2");
    const json = JSON.parse(r.out);
    expect(json.map((x: { path: string; changed: boolean }) => [x.path, x.changed])).toEqual([
      ["index.md", true],
      ["tables/index.md", true],
    ]);
    expect(json[0].content.startsWith('---\nokf_version: "0.2"\n---\n')).toBe(true);
  });
});

describe("usage", () => {
  test("help and version", () => {
    expect(run("--help")).toMatchObject({ code: 0 });
    expect(run("--help").out).toContain("Usage: okf-it");
    expect(run("-v").out).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  test("errors exit 2", () => {
    expect(run().code).toBe(2);
    expect(run("lint", ".")).toMatchObject({ code: 2, err: expect.stringContaining("unknown command lint") });
    expect(run("check")).toMatchObject({ code: 2, err: "okf-it: check needs a bundle directory\n" });
    expect(run("check", ".", "--bogus")).toMatchObject({
      code: 2,
      err: expect.stringContaining("unknown option --bogus"),
    });
    expect(run("check", ".", "--now")).toMatchObject({ code: 2, err: expect.stringContaining("--now needs a value") });
    expect(run("check", "a", "b")).toMatchObject({ code: 2, err: expect.stringContaining("unexpected argument b") });
    expect(run("check", "/no/such/dir")).toMatchObject({
      code: 2,
      err: expect.stringContaining("cannot read /no/such/dir"),
    });
  });
});
