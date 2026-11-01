/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Document, LineCounter, isMap, isNode, isScalar } from "yaml";

import {
  Attester,
  Computation,
  Executor,
  Generated,
  Parameter,
  Source,
  Status,
  TrustTier,
  UsageWindow,
  Verification,
  asText,
  clone,
  normalizeAttester,
  normalizeExecutor,
  normalizeGenerated,
  normalizeParameters,
  normalizeSources,
  normalizeTags,
  normalizeUsageWindow,
  normalizeVerified,
  parseTimestamp,
  titleFromFilename,
  trustTierOf,
} from "./fields";
import { FrontMatterSplit, ParseProblem, parseFrontMatterYaml, splitFrontMatter } from "./frontmatter";
import { CodeBlock, Heading, MarkdownLink, MarkdownScan, scanMarkdown, splitLines } from "./markdown";

/** The front matter keys OKF v0.2 defines (§4.1, §5, §10), plus the legacy v0.1 `timestamp` (§13.1). */
export const KNOWN_KEYS: readonly string[] = [
  "type",
  "title",
  "description",
  "resource",
  "tags",
  "sources",
  "usage_window",
  "generated",
  "verified",
  "status",
  "stale_after",
  "runtime",
  "parameters",
  "computation",
  "executor",
  "attester",
  "timestamp",
];

/** The concept type of an Attested Computation (§10). */
export const ATTESTED_COMPUTATION = "Attested Computation";

/** Where a top-level key sits in the original front matter, for splicing on write. */
interface KeySpan {
  key: string;
  /** Offset (in the YAML text) of the start of the key's line. */
  start: number;
  /** Offset just after the value's last line (its line break included). */
  end: number;
  /** True when the value was written in flow style (`{ ... }` or `[ ... ]`). */
  flow: boolean;
}

/** A footnote attribution (§5.1): a `[^label]` in the body and the `sources` entry it names. */
export interface Attribution {
  label: string;
  line: number;
  column: number;
  /** The `sources` entry whose `id` is the label; undefined when there is none. */
  source?: Source;
}

/**
 * A concept document (§4): one markdown file with YAML front matter. The front matter is live: change it with
 * {@link Concept.set}/{@link Concept.delete} (or by mutating {@link Concept.frontMatter}) and the body with
 * {@link Concept.body}, then {@link writeConcept} renders it, keeping everything unchanged byte-identical.
 */
export class Concept {
  /** The concept ID (§2): the bundle path without `.md`, `/`-separated. */
  readonly id: string;
  /** The bundle path of the file (`tables/orders.md`). */
  readonly path: string;
  /** The file as read. */
  readonly text: string;
  /** Problems found while reading (unterminated or invalid front matter). */
  readonly problems: readonly ParseProblem[];

  /** @internal */ readonly split: FrontMatterSplit;
  /** @internal */ readonly original: Readonly<Record<string, unknown>>;
  /** @internal */ readonly spans: readonly KeySpan[];
  /** @internal */ readonly lineCounter: LineCounter;
  /** @internal */ readonly document?: Document.Parsed;

  private data: Record<string, unknown>;
  private currentBody: string;
  private scanned?: { body: string; scan: MarkdownScan };

  /** @internal Use {@link parseConcept}. */
  constructor(id: string, text: string) {
    this.id = id;
    this.path = `${id}.md`;
    this.text = text;
    this.split = splitFrontMatter(text);
    const problems: ParseProblem[] = [];
    if (!this.split.present) {
      problems.push({
        code: "front-matter-missing",
        message: "A concept must start with a YAML front matter block delimited by `---` lines",
        line: 1,
        column: 1,
      });
    } else if (!this.split.closed) {
      problems.push({
        code: "front-matter-unterminated",
        message: "The front matter block has no closing `---` line",
        line: 1,
        column: 1,
      });
    }
    const parsed = this.split.closed
      ? parseFrontMatterYaml(this.split.yaml, this.split.yamlLine)
      : { data: {}, lineCounter: new LineCounter(), problems: [], document: undefined };
    problems.push(...parsed.problems);
    this.problems = problems;
    this.lineCounter = parsed.lineCounter;
    this.document = parsed.document;
    this.original = clone(parsed.data);
    this.data = parsed.data;
    this.spans = this.document ? keySpans(this.document, this.split.yaml) : [];
    this.currentBody = this.split.closed ? this.split.body : this.split.present ? "" : this.split.body;
  }

  /** True when the file has a (closed) front matter block. */
  get hasFrontMatter(): boolean {
    return this.split.closed;
  }

  /** The front matter as plain values (live: mutations are written by {@link writeConcept}). */
  get frontMatter(): Record<string, unknown> {
    return this.data;
  }

  /** Replaces the whole front matter (key order as given). */
  set frontMatter(value: Record<string, unknown>) {
    this.data = value;
  }

  /** The markdown body (everything after the front matter), exactly as written. */
  get body(): string {
    return this.currentBody;
  }

  set body(value: string) {
    this.currentBody = value;
  }

  /** The 1-based file line where the body starts. */
  get bodyLine(): number {
    return this.split.bodyLine;
  }

  /** Reads a front matter key. */
  get(key: string): unknown {
    return this.data[key];
  }

  /** Sets a front matter key: an existing key keeps its place, a new key is appended. */
  set(key: string, value: unknown): this {
    this.data[key] = value;
    return this;
  }

  /** Removes a front matter key. */
  delete(key: string): this {
    delete this.data[key];
    return this;
  }

  /** The front matter keys OKF does not define (§4.1 extensions), in order. */
  get extensionKeys(): string[] {
    return Object.keys(this.data).filter(k => !KNOWN_KEYS.includes(k));
  }

  // --- §4.1 core fields ---

  /** `type` (REQUIRED): undefined when absent, empty or not a string. */
  get type(): string | undefined {
    const t = this.data.type;
    return typeof t === "string" && t.trim() !== "" ? t : undefined;
  }

  /** `title`, else derived from the file name (§4.1). */
  get title(): string {
    return asText(this.data.title) ?? titleFromFilename(this.id.split("/").pop() ?? this.id);
  }

  /** True when `title` is written in the front matter. */
  get hasTitle(): boolean {
    return asText(this.data.title) !== undefined;
  }

  get description(): string | undefined {
    return asText(this.data.description);
  }

  get resource(): string | undefined {
    return asText(this.data.resource);
  }

  get tags(): string[] {
    return normalizeTags(this.data.tags);
  }

  // --- §5.1 provenance ---

  /** `sources`, each with its credibility signals; `usage_window` falls back to the shared one. */
  get sources(): Source[] {
    return normalizeSources(this.data.sources, this.data.usage_window);
  }

  /** The shared `usage_window` (§5.1). */
  get usageWindow(): UsageWindow | undefined {
    return normalizeUsageWindow(this.data.usage_window);
  }

  /** The `sources` entry with this `id`. */
  source(id: string): Source | undefined {
    return this.sources.find(s => s.id === id);
  }

  /** The footnote references in the body, each joined to the `sources` entry its label names (§5.1). */
  get attributions(): Attribution[] {
    const sources = this.sources;
    return this.scan.footnoteReferences.map(f => ({
      label: f.label,
      line: f.line,
      column: f.column,
      source: sources.find(s => s.id === f.label),
    }));
  }

  // --- §5.2 / §5.3 trust ---

  get generated(): Generated | undefined {
    return normalizeGenerated(this.data.generated);
  }

  /** `verified` as a list: a bare mapping is a one-element list (§5.2). */
  get verified(): Verification[] {
    return normalizeVerified(this.data.verified);
  }

  /** The latest `verified[].at` (as written), if any. */
  get lastVerified(): string | undefined {
    let best: { at: string; time: number } | undefined;
    for (const v of this.verified) {
      const time = parseTimestamp(v.at)?.getTime();
      if (v.at !== undefined && time !== undefined && (!best || time > best.time)) best = { at: v.at, time };
    }
    return best?.at;
  }

  /** The trust tier derived from `verified` (§5.3). */
  get trustTier(): TrustTier {
    return trustTierOf(this.verified);
  }

  /** When the content last changed: `generated.at`, else the legacy v0.1 `timestamp` (§13.1). */
  get lastChanged(): string | undefined {
    return this.generated?.at ?? asText(this.data.timestamp);
  }

  // --- §5.4 / §5.5 lifecycle ---

  /** `status`; absent ⇒ `stable` (§5.4). An unknown value is returned as written. */
  get status(): Status | string {
    return asText(this.data.status) ?? "stable";
  }

  get isDeprecated(): boolean {
    return this.status === "deprecated";
  }

  /** `stale_after` as written. */
  get staleAfter(): string | undefined {
    return asText(this.data.stale_after);
  }

  /**
   * §5.5: stale when `now >= stale_after`. False when `stale_after` is absent or not an ISO 8601 datetime with an
   * explicit offset.
   */
  isStale(now: Date = new Date()): boolean {
    const at = parseTimestamp(this.data.stale_after);
    return at !== undefined && now.getTime() >= at.getTime();
  }

  // --- §10 attested computations ---

  get isAttestedComputation(): boolean {
    return this.type === ATTESTED_COMPUTATION;
  }

  get runtime(): string | undefined {
    return asText(this.data.runtime);
  }

  get parameters(): Parameter[] {
    return normalizeParameters(this.data.parameters);
  }

  /** The `computation` path (§10.3), as written. */
  get computationPath(): string | undefined {
    return asText(this.data.computation);
  }

  get executor(): Executor | undefined {
    return normalizeExecutor(this.data.executor);
  }

  get attester(): Attester | undefined {
    return normalizeAttester(this.data.attester);
  }

  /** The code blocks under the `# Computation` heading (§10.3). */
  get computationBlocks(): CodeBlock[] {
    return this.blocksUnder("Computation");
  }

  /** The computation (§10.3): the `computation` file, else the first code block under `# Computation`. */
  get computation(): Computation | undefined {
    const path = this.computationPath;
    if (path !== undefined) return { kind: "file", path };
    const block = this.computationBlocks[0];
    if (!block) return undefined;
    return { kind: "inline", code: block.code, language: block.info, line: block.line };
  }

  // --- body ---

  /** @internal The body scan (cached until the body changes). */
  get scan(): MarkdownScan {
    if (!this.scanned || this.scanned.body !== this.currentBody) {
      this.scanned = { body: this.currentBody, scan: scanMarkdown(this.currentBody, this.split.bodyLine - 1) };
    }
    return this.scanned.scan;
  }

  /** The headings of the body, with file line numbers. */
  get headings(): Heading[] {
    return this.scan.headings;
  }

  /** Every markdown link in the body (code excluded), as written, with file line numbers. */
  get links(): MarkdownLink[] {
    return this.scan.links;
  }

  /** The legacy v0.1 `# Citations` list items (§13.1); empty when there is no such heading. */
  get legacyCitations(): string[] {
    const index = this.headings.findIndex(h => h.text.toLowerCase() === "citations");
    if (index < 0) return [];
    return this.scan.listItems.filter(i => this.underHeading(i.heading, index)).map(i => i.text);
  }

  /** The code blocks under the first heading with this text (any level), up to the next heading of that level. */
  blocksUnder(headingText: string): CodeBlock[] {
    const index = this.headings.findIndex(h => h.text.toLowerCase() === headingText.toLowerCase());
    if (index < 0) return [];
    return this.scan.codeBlocks.filter(b => this.underHeading(b.heading, index));
  }

  private underHeading(itemHeading: number, index: number): boolean {
    if (itemHeading < index) return false;
    const level = this.headings[index].level;
    for (let h = index + 1; h <= itemHeading; h++) if (this.headings[h].level <= level) return false;
    return true;
  }

  /**
   * The file line (1-based) of a front matter key, or of a nested value (`["sources", 1, "resource"]`). Undefined
   * when the key is not in the original front matter.
   */
  lineOf(path: string | (string | number)[]): number | undefined {
    if (!this.document) return undefined;
    const keys = typeof path === "string" ? [path] : path;
    let node: unknown = this.document.contents;
    let start: number | undefined;
    for (const key of keys) {
      if (isMap(node)) {
        const pair = node.items.find(p => (isScalar(p.key) ? p.key.value : p.key) === key);
        if (!pair) return undefined;
        start = isNode(pair.key) ? pair.key.range?.[0] : undefined;
        node = pair.value;
      } else if (node && typeof node === "object" && "items" in node && typeof key === "number") {
        const items = (node as { items: unknown[] }).items;
        node = items[key];
        start = isNode(node) ? node.range?.[0] : undefined;
      } else {
        return undefined;
      }
    }
    if (start === undefined) return undefined;
    return this.lineCounter.linePos(start).line + this.split.yamlLine - 1;
  }

  /** The number of lines of the file. */
  get lineCount(): number {
    return splitLines(this.text).length;
  }
}

/** The source spans of the top-level keys, in order (offsets into the YAML text). */
function keySpans(document: Document.Parsed, yaml: string): KeySpan[] {
  if (!isMap(document.contents)) return [];
  const spans: KeySpan[] = [];
  for (const pair of document.contents.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const keyRange = isNode(pair.key) ? pair.key.range : undefined;
    if (!keyRange) continue;
    const valueRange = isNode(pair.value) ? pair.value.range : undefined;
    const start = yaml.lastIndexOf("\n", keyRange[0] - 1) + 1;
    let end = valueRange ? valueRange[1] : keyRange[2];
    if (end === 0 || yaml[end - 1] !== "\n") {
      const nl = yaml.indexOf("\n", end);
      end = nl < 0 ? yaml.length : nl + 1;
    }
    const value = pair.value as { flow?: boolean } | null;
    spans.push({ key, start, end, flow: Boolean(value && typeof value === "object" && value.flow) });
  }
  return spans;
}

/**
 * Parses one concept document (§4). `id` is its concept ID (bundle path without `.md`). Never throws: problems with
 * the front matter are in {@link Concept.problems}.
 */
export function parseConcept(text: string, id: string): Concept {
  return new Concept(id.replace(/\.md$/i, ""), text);
}
