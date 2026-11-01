/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Bundle } from "./bundle";
import { ATTESTED_COMPUTATION, Concept } from "./concept";
import { isRecord, isTimestamp, parseActor, parseTimestamp } from "./fields";
import { ParseProblem } from "./frontmatter";
import { IndexFile, LogFile } from "./reserved";

/**
 * `error`: the bundle is not conformant (§11: unparseable front matter, a missing or empty `type`, a reserved file
 * that does not follow §8/§9). `warning`: soft guidance (§5–§10 SHOULDs, broken links). `info`: a recommendation or
 * an observation (a missing `description`, a v0.1 field, a stale concept).
 */
export type Severity = "error" | "warning" | "info";

/** A finding of {@link checkBundle}. */
export interface Diagnostic {
  severity: Severity;
  /** A stable identifier (`type-missing`, `link-broken`, ...). */
  code: string;
  message: string;
  /** The bundle path of the file. */
  file: string;
  /** 1-based line, when known. */
  line?: number;
  /** 1-based column, when known. */
  column?: number;
  /** The spec section the rule comes from (`§11`, `§5.2`). */
  spec: string;
}

/** Options for {@link checkBundle}. */
export interface CheckOptions {
  /** The instant staleness is judged against (§5.5); default: now. */
  now?: Date;
  /** Leave out `info` diagnostics. */
  skipInfo?: boolean;
}

/** Every diagnostic code, with its severity and spec section. */
export const RULES: Readonly<Record<string, { severity: Severity; spec: string; summary: string }>> = {
  // §11 conformance: errors
  "front-matter-missing": { severity: "error", spec: "§11", summary: "A concept has no front matter block" },
  "front-matter-unterminated": { severity: "error", spec: "§11", summary: "The front matter has no closing `---`" },
  "front-matter-invalid": { severity: "error", spec: "§11", summary: "The front matter is not valid YAML" },
  "front-matter-not-mapping": { severity: "error", spec: "§11", summary: "The front matter is not a mapping" },
  "type-missing": { severity: "error", spec: "§11", summary: "A concept has no `type`" },
  "type-invalid": { severity: "error", spec: "§11", summary: "`type` is empty or not a string" },
  "index-front-matter": { severity: "error", spec: "§8", summary: "A non-root index has front matter" },
  "index-front-matter-invalid": { severity: "error", spec: "§8", summary: "The root index front matter is invalid" },
  "index-entry-outside-section": { severity: "error", spec: "§8", summary: "An index entry is not under a heading" },
  "index-item-malformed": { severity: "error", spec: "§8", summary: "An index list item is not a link entry" },
  "log-date-heading": { severity: "error", spec: "§9", summary: "A log heading is not a `YYYY-MM-DD` date" },
  "log-entry-outside-date": { severity: "error", spec: "§9", summary: "A log entry is not under a date heading" },
  // soft guidance: warnings
  "index-extra-front-matter": { severity: "warning", spec: "§8", summary: "Root index front matter has extra keys" },
  "index-entry-separator": { severity: "warning", spec: "§8", summary: "An entry's description lacks ` - `" },
  "index-empty": { severity: "warning", spec: "§8", summary: "An index lists nothing" },
  "index-empty-section": { severity: "warning", spec: "§8", summary: "An index section lists nothing" },
  "index-entry-broken": { severity: "warning", spec: "§8", summary: "An index entry points at nothing" },
  "okf-version-unknown": { severity: "warning", spec: "§12", summary: "`okf_version` is not one this library knows" },
  "log-order": { severity: "warning", spec: "§9", summary: "Log dates are not newest first" },
  "log-duplicate-date": { severity: "warning", spec: "§9", summary: "A log date appears twice" },
  "log-empty-date": { severity: "warning", spec: "§9", summary: "A log date has no entries" },
  "field-not-string": { severity: "warning", spec: "§4.1", summary: "A text field is not a string" },
  "tags-invalid": { severity: "warning", spec: "§4.1", summary: "`tags` is not a list of strings" },
  "timestamp-invalid": { severity: "warning", spec: "§5", summary: "A timestamp lacks an explicit UTC offset" },
  "sources-invalid": { severity: "warning", spec: "§5.1", summary: "`sources` or an entry has the wrong shape" },
  "source-resource-missing": { severity: "warning", spec: "§5.1", summary: "A `sources` entry has no `resource`" },
  "source-id-duplicate": { severity: "warning", spec: "§5.1", summary: "Two `sources` entries share an `id`" },
  "usage-count-invalid": { severity: "warning", spec: "§5.1", summary: "`usage_count` is not a count" },
  "usage-window-invalid": { severity: "warning", spec: "§5.1", summary: "`usage_window` is not `{ from, to }`" },
  "attribution-unknown": { severity: "warning", spec: "§5.1", summary: "A footnote names no `sources` id" },
  "generated-invalid": { severity: "warning", spec: "§5.2", summary: "`generated` is not `{ by, at }`" },
  "verified-invalid": { severity: "warning", spec: "§5.2", summary: "A `verified` event is not `{ by, at }`" },
  "actor-invalid": { severity: "warning", spec: "§7", summary: "An actor does not follow the convention" },
  "status-unknown": { severity: "warning", spec: "§5.4", summary: "`status` is not draft, stable or deprecated" },
  "runtime-missing": { severity: "warning", spec: "§10.2", summary: "An Attested Computation has no `runtime`" },
  "parameters-invalid": {
    severity: "warning",
    spec: "§10.2",
    summary: "A parameter is not `{ name, type, required }`",
  },
  "executor-invalid": { severity: "warning", spec: "§10.2", summary: "`executor` has the wrong shape" },
  "attester-invalid": { severity: "warning", spec: "§10.2", summary: "`attester` has the wrong shape" },
  "computation-missing": { severity: "warning", spec: "§10.3", summary: "No `computation` and no code block" },
  "computation-ambiguous": { severity: "warning", spec: "§10.3", summary: "More than one computation" },
  "link-broken": { severity: "warning", spec: "§6.1", summary: "A link's target is not in the bundle" },
  "link-outside": { severity: "warning", spec: "§6.1", summary: "A link climbs out of the bundle" },
  "path-broken": { severity: "warning", spec: "§6.2", summary: "A path-valued field names a missing file" },
  // recommendations and observations: info
  "title-missing": { severity: "info", spec: "§4.1", summary: "No `title` (derived from the file name)" },
  "description-missing": { severity: "info", spec: "§4.1", summary: "No `description`" },
  "index-entry-no-description": { severity: "info", spec: "§8", summary: "An index entry has no description" },
  "index-missing-concept": { severity: "info", spec: "§8", summary: "A concept is not listed in its index" },
  "log-front-matter": { severity: "info", spec: "§9", summary: "A log file has front matter" },
  "legacy-timestamp": { severity: "info", spec: "§13.1", summary: "v0.1 `timestamp` instead of `generated.at`" },
  "legacy-citations": { severity: "info", spec: "§13.1", summary: "v0.1 `# Citations` instead of `sources`" },
  stale: { severity: "info", spec: "§5.5", summary: "The concept is past its `stale_after`" },
};

type Position = { line: number; column: number };

const STATUSES = ["draft", "stable", "deprecated"];
const KNOWN_VERSIONS = ["0.1", "0.2"];

class Collector {
  readonly out: Diagnostic[] = [];
  constructor(private readonly options: CheckOptions) {}

  add(code: string, file: string, message: string, at?: number | Position, column?: number): void {
    const rule = RULES[code];
    if (!rule) throw new Error(`unknown diagnostic code ${code}`);
    if (rule.severity === "info" && this.options.skipInfo) return;
    const line = typeof at === "object" ? at.line : at;
    const col = typeof at === "object" ? at.column : column;
    this.out.push({ severity: rule.severity, code, message, file, line, column: col, spec: rule.spec });
  }

  problems(file: string, problems: readonly ParseProblem[]): void {
    for (const p of problems) this.add(p.code, file, p.message, p.line, p.column);
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "a mapping" : `${typeof value} ${JSON.stringify(value)}`;
}

function checkTimestamp(c: Collector, concept: Concept, keyPath: (string | number)[], value: unknown): void {
  if (value === undefined || value === null) return;
  if (!isTimestamp(value)) {
    c.add(
      "timestamp-invalid",
      concept.path,
      `\`${keyPath.join(".")}\` must be an ISO 8601 datetime with an explicit UTC offset (2026-06-30T14:00:00Z), found ${describe(value)}`,
      concept.positionOf(keyPath)
    );
  }
}

function checkActor(c: Collector, concept: Concept, keyPath: (string | number)[], value: unknown): void {
  if (typeof value !== "string") return;
  if (parseActor(value).kind === "unknown") {
    c.add(
      "actor-invalid",
      concept.path,
      `\`${keyPath.join(".")}\` "${value}" is not an actor: use \`<producer>/<version>\`, \`human:<id>\` or \`process:<id>\``,
      concept.positionOf(keyPath)
    );
  }
}

/** Checks one concept on its own (§4, §5, §7, §10, §11): everything that needs no other file. */
export function checkConcept(concept: Concept, options: CheckOptions = {}): Diagnostic[] {
  const c = new Collector(options);
  checkConceptInto(c, concept, options);
  return sortDiagnostics(c.out);
}

function checkConceptInto(c: Collector, concept: Concept, options: CheckOptions): void {
  const file = concept.path;
  c.problems(file, concept.problems);
  if (concept.problems.length > 0) return;
  const fm = concept.frontMatter;
  const line = (k: string | (string | number)[]): Position | undefined => concept.positionOf(k);

  // §11.2 type
  if (!("type" in fm) || fm.type === null || fm.type === undefined) {
    c.add("type-missing", file, "A concept must have a non-empty `type`", 1, 1);
  } else if (typeof fm.type !== "string" || fm.type.trim() === "") {
    c.add("type-invalid", file, `\`type\` must be a non-empty string, found ${describe(fm.type)}`, line("type"));
  }

  // §4.1 recommended
  for (const key of ["title", "description", "resource"]) {
    if (key in fm && fm[key] !== null && typeof fm[key] !== "string") {
      c.add("field-not-string", file, `\`${key}\` should be a string, found ${describe(fm[key])}`, line(key));
    }
  }
  if (!concept.hasTitle) c.add("title-missing", file, `No \`title\`; consumers derive "${concept.title}"`, 1, 1);
  if (concept.description === undefined) c.add("description-missing", file, "No `description`", 1, 1);
  if ("tags" in fm && fm.tags !== null) {
    if (!Array.isArray(fm.tags) || fm.tags.some(t => typeof t !== "string" || t.trim() === "")) {
      c.add("tags-invalid", file, "`tags` should be a list of short strings", line("tags"));
    }
  }

  // §5.1 sources
  if ("sources" in fm && fm.sources !== null) {
    if (!Array.isArray(fm.sources)) {
      c.add("sources-invalid", file, `\`sources\` should be a list, found ${describe(fm.sources)}`, line("sources"));
    } else {
      const ids = new Map<string, number>();
      fm.sources.forEach((s, i) => {
        if (!isRecord(s)) {
          c.add("sources-invalid", file, `\`sources[${i}]\` should be a mapping`, line(["sources", i]));
          return;
        }
        if (typeof s.resource !== "string" || s.resource.trim() === "") {
          c.add("source-resource-missing", file, `\`sources[${i}]\` needs a \`resource\``, line(["sources", i]));
        }
        if (s.id !== undefined) {
          const id = String(s.id);
          if (ids.has(id)) {
            c.add("source-id-duplicate", file, `Source id "${id}" is used twice`, line(["sources", i, "id"]));
          }
          ids.set(id, i);
        }
        if (s.usage_count !== undefined) {
          const n = s.usage_count;
          if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
            c.add(
              "usage-count-invalid",
              file,
              `\`sources[${i}].usage_count\` should be a non-negative integer, found ${describe(n)}`,
              line(["sources", i, "usage_count"])
            );
          }
        }
        checkTimestamp(c, concept, ["sources", i, "last_modified"], s.last_modified);
        if (s.usage_window !== undefined) checkWindow(c, concept, ["sources", i, "usage_window"], s.usage_window);
      });
    }
  }
  if (fm.usage_window !== undefined) checkWindow(c, concept, ["usage_window"], fm.usage_window);
  if (Array.isArray(fm.sources) && fm.sources.length > 0) {
    for (const a of concept.attributions) {
      if (!a.source) {
        c.add(
          "attribution-unknown",
          file,
          `Footnote [^${a.label}] names no \`sources\` id; attribution joins on \`sources[].id\``,
          a.line,
          a.column
        );
      }
    }
  }

  // §5.2 generated / verified
  if ("generated" in fm && fm.generated !== null) {
    if (!isRecord(fm.generated)) {
      c.add("generated-invalid", file, "`generated` should be `{ by, at }`", line("generated"));
    } else {
      if (typeof fm.generated.by !== "string" || fm.generated.by.trim() === "") {
        c.add("generated-invalid", file, "`generated.by` is required within `generated`", line("generated"));
      }
      checkActor(c, concept, ["generated", "by"], fm.generated.by);
      checkTimestamp(c, concept, ["generated", "at"], fm.generated.at);
    }
  }
  if ("verified" in fm && fm.verified !== null) {
    const list = Array.isArray(fm.verified) ? fm.verified : [fm.verified];
    const bare = !Array.isArray(fm.verified);
    list.forEach((v, i) => {
      const keyPath = bare ? ["verified"] : ["verified", i];
      if (!isRecord(v)) {
        c.add("verified-invalid", file, "A `verified` event should be `{ by, at }`", line(keyPath));
        return;
      }
      if (typeof v.by !== "string" || typeof v.at !== "string") {
        c.add("verified-invalid", file, "A `verified` event needs both `by` and `at`", line(keyPath));
      }
      checkActor(c, concept, [...keyPath, "by"], v.by);
      checkTimestamp(c, concept, [...keyPath, "at"], v.at);
    });
  }

  // §5.4 / §5.5 lifecycle
  if ("status" in fm && fm.status !== null && !STATUSES.includes(String(fm.status))) {
    c.add(
      "status-unknown",
      file,
      `\`status\` should be draft, stable or deprecated, found ${describe(fm.status)}`,
      line("status")
    );
  }
  if ("stale_after" in fm && fm.stale_after !== null) {
    checkTimestamp(c, concept, ["stale_after"], fm.stale_after);
    const at = parseTimestamp(fm.stale_after);
    const now = options.now ?? new Date();
    if (at && now.getTime() >= at.getTime()) {
      c.add("stale", file, `Stale since ${String(fm.stale_after)}`, line("stale_after"));
    }
  }

  // §13.1 legacy
  if ("timestamp" in fm && !("generated" in fm)) {
    c.add("legacy-timestamp", file, "`timestamp` is v0.1; v0.2 records `generated: { by, at }`", line("timestamp"));
  }
  const citations = concept.headings.find(h => h.text.toLowerCase() === "citations");
  if (citations) {
    c.add(
      "legacy-citations",
      file,
      "A `# Citations` list is v0.1; v0.2 records provenance in `sources`",
      citations.line,
      1
    );
  }

  // §10 attested computations
  if (concept.type === ATTESTED_COMPUTATION) checkComputation(c, concept);
}

function checkWindow(c: Collector, concept: Concept, keyPath: (string | number)[], value: unknown): void {
  if (!isRecord(value)) {
    c.add(
      "usage-window-invalid",
      concept.path,
      `\`${keyPath.join(".")}\` should be \`{ from, to }\``,
      concept.positionOf(keyPath)
    );
    return;
  }
  checkTimestamp(c, concept, [...keyPath, "from"], value.from);
  checkTimestamp(c, concept, [...keyPath, "to"], value.to);
  const from = parseTimestamp(value.from);
  const to = parseTimestamp(value.to);
  if (from && to && from.getTime() > to.getTime()) {
    c.add(
      "usage-window-invalid",
      concept.path,
      `\`${keyPath.join(".")}\` ends before it starts`,
      concept.positionOf(keyPath)
    );
  }
}

function checkComputation(c: Collector, concept: Concept): void {
  const fm = concept.frontMatter;
  const file = concept.path;
  const line = (k: string | (string | number)[]): Position | undefined => concept.positionOf(k);
  if (typeof fm.runtime !== "string" || fm.runtime.trim() === "") {
    c.add("runtime-missing", file, "An Attested Computation requires `runtime` (§10.2)", line("runtime") ?? 1);
  }
  if ("parameters" in fm && fm.parameters !== null) {
    if (!Array.isArray(fm.parameters)) {
      c.add(
        "parameters-invalid",
        file,
        "`parameters` should be a list of `{ name, type, required }`",
        line("parameters")
      );
    } else {
      fm.parameters.forEach((p, i) => {
        if (!isRecord(p) || typeof p.name !== "string" || typeof p.type !== "string") {
          c.add(
            "parameters-invalid",
            file,
            `\`parameters[${i}]\` needs a \`name\` and a \`type\``,
            line(["parameters", i])
          );
        } else if (p.required !== undefined && typeof p.required !== "boolean") {
          c.add(
            "parameters-invalid",
            file,
            `\`parameters[${i}].required\` should be true or false`,
            line(["parameters", i])
          );
        }
      });
    }
  }
  if ("executor" in fm && fm.executor !== null) {
    const e = fm.executor;
    if (!isRecord(e) || typeof e.resource !== "string") {
      c.add("executor-invalid", file, "`executor` should be `{ resource, receipt }`", line("executor"));
    } else if (e.receipt !== undefined && (!Array.isArray(e.receipt) || e.receipt.some(r => typeof r !== "string"))) {
      c.add(
        "executor-invalid",
        file,
        "`executor.receipt` should be a list of field names",
        line(["executor", "receipt"])
      );
    }
  }
  if ("attester" in fm && fm.attester !== null) {
    if (!isRecord(fm.attester) || typeof fm.attester.resource !== "string") {
      c.add("attester-invalid", file, "`attester` should be `{ resource }`", line("attester"));
    }
  }
  const blocks = concept.computationBlocks;
  const hasPath = typeof fm.computation === "string" && fm.computation.trim() !== "";
  if (!hasPath && blocks.length === 0) {
    c.add(
      "computation-missing",
      file,
      "Give the computation as a code block under `# Computation` or as a `computation` path (§10.3)",
      line("type") ?? 1
    );
  } else if (hasPath && blocks.length > 0) {
    c.add("computation-ambiguous", file, "With a `computation` path, omit the body code block (§10.3)", blocks[0].line);
  } else if (blocks.length > 1) {
    c.add("computation-ambiguous", file, "`# Computation` should hold a single code block (§10.3)", blocks[1].line);
  }
}

function checkIndex(c: Collector, bundle: Bundle, index: IndexFile): void {
  c.problems(index.path, index.problems);
  if (index.directory === "" && index.frontMatter && "okf_version" in index.frontMatter) {
    const v = index.frontMatter.okf_version;
    if (typeof v !== "string" || !KNOWN_VERSIONS.includes(v)) {
      c.add(
        "okf-version-unknown",
        index.path,
        `okf_version ${describe(v)} is not one of ${KNOWN_VERSIONS.join(", ")}; read best-effort (§12)`,
        2
      );
    }
  }
  for (const e of index.entries) {
    const t = bundle.resolve(index.path, e.url);
    if (!t.exists)
      c.add(
        "index-entry-broken",
        index.path,
        `Entry "${e.title}" points at ${e.url}, not in the bundle`,
        e.line,
        e.column
      );
    if (e.description === undefined) {
      c.add("index-entry-no-description", index.path, `Entry "${e.title}" has no description`, e.line, e.column);
    }
  }
  const listed = new Set(
    index.entries
      .map(e => bundle.resolve(index.path, e.url))
      .filter(t => t.kind === "concept")
      .map(t => t.conceptId)
  );
  for (const concept of bundle.conceptsIn(index.directory)) {
    if (!listed.has(concept.id)) {
      c.add("index-missing-concept", index.path, `${concept.path} is not listed`, 1, 1);
    }
  }
}

function checkLog(c: Collector, log: LogFile): void {
  c.problems(log.path, log.problems);
}

function severityRank(s: Severity): number {
  return s === "error" ? 0 : s === "warning" ? 1 : 2;
}

/** Sorts diagnostics by file, line, column, severity and code (the order {@link checkBundle} returns). */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0) ||
      severityRank(a.severity) - severityRank(b.severity) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
  );
}

/**
 * Checks a bundle against OKF v0.2 (§11): the conformance rules as errors, soft guidance as warnings, recommendations
 * as info. Never reports what §11 says consumers must accept (unknown types or keys, missing optional families,
 * missing index files) as an error; broken links are warnings. Deterministic for a given `options.now`.
 */
export function checkBundle(bundle: Bundle, options: CheckOptions = {}): Diagnostic[] {
  const c = new Collector(options);
  for (const concept of bundle.concepts.values()) {
    checkConceptInto(c, concept, options);
    if (concept.problems.length > 0) continue;
    for (const l of bundle.outgoing(concept.id)) {
      if (l.exists || l.link.image) continue;
      if (l.kind === "outside") {
        c.add(
          "link-outside",
          concept.path,
          `Link to ${l.link.url} climbs out of the bundle`,
          l.link.line,
          l.link.column
        );
      } else {
        c.add(
          "link-broken",
          concept.path,
          `Link to ${l.link.url} has no target in the bundle`,
          l.link.line,
          l.link.column
        );
      }
    }
    for (const p of bundle.pathFields(concept.id)) {
      if (p.exists) continue;
      // A `sources` resource may name something outside any bundle (`dashboards/revenue`); only report file-like paths.
      const fileLike = /^(\/|\.\.?\/)/.test(p.value) || /\.[A-Za-z0-9]+$/.test(p.value.split("#")[0]);
      if (p.field.startsWith("sources[") && !fileLike) continue;
      c.add(
        "path-broken",
        concept.path,
        `\`${p.field}\` names ${p.value}, not in the bundle`,
        concept.positionOf(p.keyPath)
      );
    }
  }
  for (const index of bundle.indexes.values()) checkIndex(c, bundle, index);
  for (const log of bundle.logs.values()) checkLog(c, log);
  return sortDiagnostics(c.out);
}

/** True when no diagnostic is an error: the bundle is conformant (§11). */
export function isConformant(diagnostics: readonly Diagnostic[]): boolean {
  return !diagnostics.some(d => d.severity === "error");
}

/** Counts per severity. */
export function summarize(diagnostics: readonly Diagnostic[]): { errors: number; warnings: number; infos: number } {
  return {
    errors: diagnostics.filter(d => d.severity === "error").length,
    warnings: diagnostics.filter(d => d.severity === "warning").length,
    infos: diagnostics.filter(d => d.severity === "info").length,
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Formats diagnostics.
 *
 * - `text`: one line each, `file:line:column: severity: message [code]` (the compiler format editors and
 *   diagnose-it read), then a summary line.
 * - `json`: `{ conformant, summary, diagnostics }`, two-space indented.
 */
export function formatDiagnostics(diagnostics: readonly Diagnostic[], format: "text" | "json" = "text"): string {
  const summary = summarize(diagnostics);
  if (format === "json") {
    return JSON.stringify({ conformant: isConformant(diagnostics), summary, diagnostics }, null, 2) + "\n";
  }
  const lines = diagnostics.map(d => {
    const where = d.line !== undefined ? `${d.file}:${d.line}:${d.column ?? 1}` : d.file;
    const severity = d.severity === "info" ? "note" : d.severity;
    return `${where}: ${severity}: ${d.message} [${d.code}]`;
  });
  lines.push(
    `${plural(summary.errors, "error")}, ${plural(summary.warnings, "warning")}, ${plural(summary.infos, "note")}`
  );
  return lines.join("\n") + "\n";
}
