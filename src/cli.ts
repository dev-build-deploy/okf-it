/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "fs";
import * as path from "path";

import { readBundle } from "./bundle";
import { checkBundle, formatDiagnostics, isConformant } from "./check";
import { generateIndexes } from "./generate";

/** Where the CLI writes (injectable for tests). */
export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const USAGE = `Usage: okf-it <command> <bundle-dir> [options]

Commands:
  check <dir>    Check a bundle against OKF v0.2; exits 1 when it is not conformant
  index <dir>    Generate the index.md of every directory (printed; --write to save)

Options:
  --json                 Machine-readable output
  --now <datetime>       check: judge staleness at this instant (default: now)
  --no-info              check: leave out notes
  --write                index: write the index files that changed
  --check                index: exit 1 when an index file is missing or out of date
  --okf-version <v>      index: set okf_version on the root index
  -h, --help             Show this help
  -v, --version          Show the version
`;

interface Args {
  command?: string;
  dir?: string;
  flags: Set<string>;
  values: Map<string, string>;
}

function parseArgs(argv: string[]): Args | string {
  const args: Args = { flags: new Set(), values: new Map() };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--now" || a === "--okf-version") {
      const v = argv[++i];
      if (v === undefined) return `${a} needs a value`;
      args.values.set(a, v);
    } else if (["--json", "--no-info", "--write", "--check", "-h", "--help", "-v", "--version"].includes(a)) {
      args.flags.add(a);
    } else if (a.startsWith("-")) {
      return `unknown option ${a}`;
    } else {
      positional.push(a);
    }
  }
  [args.command, args.dir] = positional;
  if (positional.length > 2) return `unexpected argument ${positional[2]}`;
  return args;
}

function version(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")) as { version: string };
    return pkg.version;
  } catch (_e) {
    return "unknown";
  }
}

/** Runs the CLI; returns the exit code (0 ok, 1 findings, 2 usage or I/O error). */
export function main(argv: string[], io: CliIO): number {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    io.stderr(`okf-it: ${parsed}\n\n${USAGE}`);
    return 2;
  }
  const { command, dir, flags, values } = parsed;
  if (flags.has("-h") || flags.has("--help")) {
    io.stdout(USAGE);
    return 0;
  }
  if (flags.has("-v") || flags.has("--version")) {
    io.stdout(`${version()}\n`);
    return 0;
  }
  if (command !== "check" && command !== "index") {
    io.stderr(command ? `okf-it: unknown command ${command}\n\n${USAGE}` : USAGE);
    return 2;
  }
  if (!dir) {
    io.stderr(`okf-it: ${command} needs a bundle directory\n`);
    return 2;
  }
  let bundle;
  try {
    bundle = readBundle(dir);
  } catch (e) {
    io.stderr(`okf-it: cannot read ${dir}: ${(e as Error).message}\n`);
    return 2;
  }
  const json = flags.has("--json");

  if (command === "check") {
    let now: Date | undefined;
    const raw = values.get("--now");
    if (raw !== undefined) {
      now = new Date(raw);
      if (isNaN(now.getTime())) {
        io.stderr(`okf-it: --now ${raw} is not a datetime\n`);
        return 2;
      }
    }
    const diagnostics = checkBundle(bundle, { now, skipInfo: flags.has("--no-info") });
    io.stdout(formatDiagnostics(diagnostics, json ? "json" : "text"));
    return isConformant(diagnostics) ? 0 : 1;
  }

  const generated = generateIndexes(bundle, { okfVersion: values.get("--okf-version") });
  const root = bundle.root ?? path.resolve(dir);
  const results = [...generated.entries()].map(([file, content]) => {
    const full = path.join(root, file);
    const current = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : undefined;
    return { path: file, content, changed: current !== content };
  });
  if (flags.has("--write")) {
    for (const r of results.filter(x => x.changed)) fs.writeFileSync(path.join(root, r.path), r.content);
  }
  if (json) {
    io.stdout(JSON.stringify(results, null, 2) + "\n");
  } else if (flags.has("--write") || flags.has("--check")) {
    const changed = results.filter(r => r.changed);
    const verb = flags.has("--write") ? "wrote" : "out of date";
    for (const r of changed) io.stdout(`${verb}: ${r.path}\n`);
    io.stdout(
      `${changed.length} of ${results.length} index files ${flags.has("--write") ? "written" : "out of date"}\n`
    );
  } else {
    io.stdout(results.map(r => `==> ${r.path} <==\n${r.content}`).join("\n"));
  }
  return flags.has("--check") && !flags.has("--write") && results.some(r => r.changed) ? 1 : 0;
}
