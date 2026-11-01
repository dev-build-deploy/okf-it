/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "fs";
import * as path from "path";

import { Concept, parseConcept } from "./concept";
import { isRecord } from "./fields";
import { MarkdownLink } from "./markdown";
import { PathIndex, Target, resolveTarget } from "./paths";
import { INDEX_FILE, IndexFile, LOG_FILE, LogFile, directoryOf, parseIndex, parseLog } from "./reserved";

/** A link of a bundle file (§6.1), resolved. */
export interface ResolvedLink extends Target {
  /** The bundle path of the file the link is in. */
  from: string;
  /** What kind of file the link is in. */
  fromKind: "concept" | "index" | "log";
  /** For links in a concept: its ID. */
  fromConcept?: string;
  /** The link as written. */
  link: MarkdownLink;
}

/** A path-valued front matter field (§6.2), resolved. */
export interface PathField extends Target {
  /** The field: `resource`, `sources[0].resource`, `computation`, `executor.resource`, `attester.resource`. */
  field: string;
  /** The key path into the front matter (for line lookups). */
  keyPath: (string | number)[];
  /** The value as written. */
  value: string;
}

/** A directory of the bundle with what it holds. */
export interface DirectoryNode {
  /** The directory's name (`""` for the root). */
  name: string;
  /** Its bundle path (`""` for the root). */
  path: string;
  index?: IndexFile;
  log?: LogFile;
  /** The IDs of the concepts directly in it, sorted. */
  concepts: string[];
  /** The other files directly in it (not markdown), sorted. */
  files: string[];
  directories: DirectoryNode[];
}

/** Options for {@link readBundle}. */
export interface ReadOptions {
  /**
   * Skips a file or directory (by bundle path) while reading. By default entries whose name starts with `.` and
   * `node_modules` are skipped.
   */
  ignore?: (bundlePath: string, isDirectory: boolean) => boolean;
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A knowledge bundle (§3): its concepts, index files and log files, with the links between them. Build one with
 * {@link readBundle} (from a directory) or {@link createBundle} (from texts in memory).
 */
export class Bundle {
  /** The directory the bundle was read from, if any. */
  readonly root?: string;
  /** The concepts, by concept ID, sorted. */
  readonly concepts: ReadonlyMap<string, Concept>;
  /** The index files, by the directory they list (`""` for the root), sorted. */
  readonly indexes: ReadonlyMap<string, IndexFile>;
  /** The log files, by directory, sorted. */
  readonly logs: ReadonlyMap<string, LogFile>;
  /** Every file of the bundle (markdown or not), as sorted bundle paths. */
  readonly files: readonly string[];
  /** Every directory of the bundle (`""` for the root), sorted. */
  readonly directories: readonly string[];

  private readonly pathIndex: PathIndex;

  /** @internal Use {@link createBundle} or {@link readBundle}. */
  constructor(
    concepts: Concept[],
    indexes: IndexFile[],
    logs: LogFile[],
    files: string[],
    directories: string[],
    root?: string
  ) {
    this.root = root;
    this.concepts = new Map([...concepts].sort((a, b) => byString(a.id, b.id)).map(c => [c.id, c]));
    this.indexes = new Map([...indexes].sort((a, b) => byString(a.directory, b.directory)).map(i => [i.directory, i]));
    this.logs = new Map([...logs].sort((a, b) => byString(a.directory, b.directory)).map(l => [l.directory, l]));
    this.files = [...files].sort(byString);
    this.directories = [...directories].sort(byString);
    this.pathIndex = { files: new Set(this.files), directories: new Set(this.directories) };
  }

  /** The concept with this ID (with or without `.md`). */
  concept(id: string): Concept | undefined {
    return this.concepts.get(id.replace(/^\//, "").replace(/\.md$/i, ""));
  }

  /** `okf_version` from the bundle root `index.md` (§12). */
  get okfVersion(): string | undefined {
    return this.indexes.get("")?.okfVersion;
  }

  /** Resolves a link destination written in the file at `from` (§6.1). */
  resolve(from: string, url: string, rootFallback = false): Target {
    return resolveTarget(from, url, this.pathIndex, rootFallback);
  }

  private resolveLinks(
    from: string,
    fromKind: ResolvedLink["fromKind"],
    links: MarkdownLink[],
    fromConcept?: string
  ): ResolvedLink[] {
    return links.map(link => ({ ...this.resolve(from, link.url), from, fromKind, fromConcept, link }));
  }

  /** The links of one concept's body, resolved (§6.1), in order. */
  outgoing(id: string): ResolvedLink[] {
    const concept = this.concept(id);
    if (!concept) return [];
    return this.resolveLinks(concept.path, "concept", concept.links, concept.id);
  }

  /** Every link of the bundle: of the concepts and, with `includeReserved`, of the index and log files. */
  links(options: { includeReserved?: boolean } = {}): ResolvedLink[] {
    const out: ResolvedLink[] = [];
    for (const c of this.concepts.values()) out.push(...this.outgoing(c.id));
    if (options.includeReserved) {
      for (const i of this.indexes.values()) out.push(...this.resolveLinks(i.path, "index", i.scan.links));
      for (const l of this.logs.values()) out.push(...this.resolveLinks(l.path, "log", l.scan.links));
    }
    return out;
  }

  /** The links that point at a concept (§6.1), from concepts and, with `includeReserved`, index and log files. */
  backlinks(id: string, options: { includeReserved?: boolean } = {}): ResolvedLink[] {
    const target = id.replace(/^\//, "").replace(/\.md$/i, "");
    return this.links(options).filter(l => l.kind === "concept" && l.conceptId === target && l.from !== `${target}.md`);
  }

  /**
   * Links whose in-bundle target does not exist, or that climb out of the bundle (§6.1). These are tolerated, not
   * errors: they may be knowledge not written yet.
   */
  brokenLinks(options: { includeReserved?: boolean } = {}): ResolvedLink[] {
    return this.links(options).filter(l => !l.exists && !l.link.image);
  }

  /** The path-valued fields of a concept (§6.2), resolved; bare relative paths fall back to the bundle root. */
  pathFields(id: string): PathField[] {
    const concept = this.concept(id);
    if (!concept) return [];
    const fm = concept.frontMatter;
    const out: PathField[] = [];
    const add = (field: string, keyPath: (string | number)[], value: unknown, descriptorAllowed: boolean): void => {
      if (typeof value !== "string" || value.trim() === "") return;
      if (descriptorAllowed && /\s/.test(value.trim())) {
        out.push({ field, keyPath, value, kind: "descriptor", exists: true });
        return;
      }
      out.push({ field, keyPath, value, ...this.resolve(concept.path, value, true) });
    };
    add("resource", ["resource"], fm.resource, false);
    if (Array.isArray(fm.sources)) {
      fm.sources.forEach((s, i) => {
        if (isRecord(s)) add(`sources[${i}].resource`, ["sources", i, "resource"], s.resource, true);
      });
    }
    add("computation", ["computation"], fm.computation, false);
    if (isRecord(fm.executor)) add("executor.resource", ["executor", "resource"], fm.executor.resource, false);
    if (isRecord(fm.attester)) add("attester.resource", ["attester", "resource"], fm.attester.resource, false);
    return out;
  }

  /** Every tag used in the bundle (§4.1), sorted, with the IDs of the concepts carrying it. */
  get tags(): Map<string, string[]> {
    const tags = new Map<string, string[]>();
    for (const c of this.concepts.values()) {
      for (const t of new Set(c.tags)) tags.set(t, [...(tags.get(t) ?? []), c.id]);
    }
    return new Map([...tags.entries()].sort((a, b) => byString(a[0], b[0])));
  }

  /** Every `type` used in the bundle, sorted, with the IDs of its concepts. */
  get types(): Map<string, string[]> {
    const types = new Map<string, string[]>();
    for (const c of this.concepts.values()) {
      if (c.type !== undefined) types.set(c.type, [...(types.get(c.type) ?? []), c.id]);
    }
    return new Map([...types.entries()].sort((a, b) => byString(a[0], b[0])));
  }

  /** The concepts carrying a tag. */
  byTag(tag: string): Concept[] {
    return [...this.concepts.values()].filter(c => c.tags.includes(tag));
  }

  /** The concepts of a type. */
  byType(type: string): Concept[] {
    return [...this.concepts.values()].filter(c => c.type === type);
  }

  /** The concepts directly in a directory (`""` for the root), sorted by ID. */
  conceptsIn(directory: string): Concept[] {
    return [...this.concepts.values()].filter(c => directoryOf(c.path) === directory);
  }

  /** The directories directly under a directory, sorted. */
  subdirectories(directory: string): string[] {
    return this.directories.filter(d => d !== "" && directoryOf(d) === directory);
  }

  /** The directory tree, from the root. */
  tree(): DirectoryNode {
    const build = (dir: string): DirectoryNode => ({
      name: dir === "" ? "" : (dir.split("/").pop() ?? dir),
      path: dir,
      index: this.indexes.get(dir),
      log: this.logs.get(dir),
      concepts: this.conceptsIn(dir).map(c => c.id),
      files: this.files.filter(f => directoryOf(f) === dir && !/\.md$/i.test(f)),
      directories: this.subdirectories(dir).map(build),
    });
    return build("");
  }
}

/**
 * Builds a bundle from file texts in memory: a map of bundle paths (`tables/orders.md`) to markdown text. `otherFiles`
 * names the bundle's other (non-markdown) files, so links and path fields to them resolve.
 */
export function createBundle(
  files: Record<string, string> | ReadonlyMap<string, string>,
  options: { otherFiles?: string[]; root?: string } = {}
): Bundle {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  const concepts: Concept[] = [];
  const indexes: IndexFile[] = [];
  const logs: LogFile[] = [];
  const all = new Set<string>(options.otherFiles ?? []);
  for (const [rawPath, text] of entries) {
    const p = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
    all.add(p);
    if (!/\.md$/i.test(p)) continue;
    const name = p.split("/").pop();
    if (name === INDEX_FILE) indexes.push(parseIndex(text, p));
    else if (name === LOG_FILE) logs.push(parseLog(text, p));
    else concepts.push(parseConcept(text, p));
  }
  const directories = new Set<string>([""]);
  for (const f of all) {
    for (let d = directoryOf(f); d !== ""; d = directoryOf(d)) directories.add(d);
  }
  return new Bundle(concepts, indexes, logs, [...all], [...directories], options.root);
}

function defaultIgnore(bundlePath: string): boolean {
  const name = bundlePath.split("/").pop() ?? "";
  return name.startsWith(".") || name === "node_modules";
}

function walk(root: string, options: ReadOptions): { markdown: Map<string, string>; other: string[] } {
  const ignore = options.ignore ?? defaultIgnore;
  const markdown = new Map<string, string>();
  const other: string[] = [];
  const visit = (dir: string, rel: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => byString(a.name, b.name));
    for (const entry of entries) {
      const bundlePath = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignore(bundlePath, true)) visit(full, bundlePath);
      } else if (entry.isFile()) {
        if (ignore(bundlePath, false)) continue;
        if (/\.md$/i.test(entry.name)) markdown.set(bundlePath, fs.readFileSync(full, "utf8"));
        else other.push(bundlePath);
      }
    }
  };
  visit(root, "");
  return { markdown, other };
}

/**
 * Reads a bundle from a directory (§3): every non-reserved `.md` file is a concept, every `index.md` and `log.md` a
 * reserved file; other files are listed so links to them resolve. Symbolic links are not followed. Never throws for
 * malformed content (see {@link checkBundle}); throws when the directory cannot be read.
 */
export function readBundle(directory: string, options: ReadOptions = {}): Bundle {
  const root = path.resolve(directory);
  if (!fs.statSync(root).isDirectory()) throw new Error(`${directory} is not a directory`);
  const { markdown, other } = walk(root, options);
  return createBundle(markdown, { otherFiles: other, root });
}
