/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Bundle } from "./bundle";
import { directoryOf, INDEX_FILE } from "./reserved";

/** Options for {@link generateIndex}. */
export interface GenerateIndexOptions {
  /**
   * Writes `okf_version` into the root index's front matter (§12). By default an existing root front matter block is
   * kept as written and none is added.
   */
  okfVersion?: string;
  /** The section heading for subdirectories (default `Subdirectories`). */
  subdirectoriesHeading?: string;
  /** The section heading for concepts without a `type` (default `Other`). */
  untypedHeading?: string;
}

interface Entry {
  section: string;
  title: string;
  link: string;
  description?: string;
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function oneLine(text: string | undefined): string | undefined {
  const s = text?.replace(/\s+/g, " ").trim();
  return s ? s : undefined;
}

function escapeTitle(title: string): string {
  return title.replace(/([\\[\]])/g, "\\$1");
}

function escapeLink(link: string): string {
  return /[\s()<>]/.test(link) ? `<${link.replace(/>/g, "%3E")}>` : link;
}

function hasMarkdown(bundle: Bundle, dir: string): boolean {
  return bundle.files.some(f => f.startsWith(`${dir}/`) && /\.md$/i.test(f));
}

/** The entries of a directory's index, keyed by directory, computed bottom-up (subdirectory descriptions). */
function entriesFor(bundle: Bundle, dir: string, options: GenerateIndexOptions, memo: Map<string, Entry[]>): Entry[] {
  const cached = memo.get(dir);
  if (cached) return cached;
  const existing = bundle.indexes.get(dir);
  const existingFor = (path: string): { section: string; title: string; description?: string } | undefined => {
    if (!existing) return undefined;
    for (const section of existing.sections) {
      for (const e of section.entries) {
        const t = bundle.resolve(existing.path, e.url);
        const target = t.kind === "directory" ? `${t.path}/${INDEX_FILE}` : t.path;
        if (target === path) return { section: section.heading, title: e.title, description: e.description };
      }
    }
    return undefined;
  };

  const entries: Entry[] = [];
  for (const c of bundle.conceptsIn(dir)) {
    const name = c.path.split("/").pop() ?? c.path;
    entries.push({
      section: c.type ?? options.untypedHeading ?? "Other",
      title: c.title,
      link: name,
      description: oneLine(c.description) ?? oneLine(existingFor(c.path)?.description),
    });
  }
  for (const sub of bundle.subdirectories(dir)) {
    if (!hasMarkdown(bundle, sub)) continue;
    const name = sub.split("/").pop() ?? sub;
    const childEntries = entriesFor(bundle, sub, options, memo);
    const derived = childEntries.length === 1 ? childEntries[0].description : undefined;
    entries.push({
      section: options.subdirectoriesHeading ?? "Subdirectories",
      title: name,
      link: `${name}/${INDEX_FILE}`,
      description: oneLine(existingFor(`${sub}/${INDEX_FILE}`)?.description) ?? derived,
    });
  }
  // Keep curated entries for the directory's other (non-markdown) files that still exist.
  if (existing) {
    for (const section of existing.sections) {
      for (const e of section.entries) {
        const t = bundle.resolve(existing.path, e.url);
        if (t.kind === "file" && t.exists && t.path !== undefined && directoryOf(t.path) === dir) {
          entries.push({ section: section.heading, title: e.title, link: e.url, description: oneLine(e.description) });
        }
      }
    }
  }
  memo.set(dir, entries);
  return entries;
}

function render(entries: Entry[]): string {
  const sections = new Map<string, Entry[]>();
  for (const e of entries) sections.set(e.section, [...(sections.get(e.section) ?? []), e]);
  const parts: string[] = [];
  for (const heading of [...sections.keys()].sort(byString)) {
    const items = (sections.get(heading) ?? []).sort((a, b) => {
      const ta = a.title.toLowerCase();
      const tb = b.title.toLowerCase();
      return ta !== tb ? byString(ta, tb) : byString(a.link, b.link);
    });
    const lines = items.map(
      e => `* [${escapeTitle(e.title)}](${escapeLink(e.link)})${e.description ? ` - ${e.description}` : ""}`
    );
    parts.push([`# ${heading}`, "", ...lines].join("\n"));
  }
  return parts.join("\n\n") + "\n";
}

/**
 * Generates the `index.md` of a directory (§8), deterministically, from the bundle: one section per concept `type`
 * (concepts without one under `Other`) and a `Subdirectories` section, sections sorted by heading and entries by
 * title, as the OKF reference implementation lays them out. Each entry carries the concept's `description`.
 *
 * Curated text survives regeneration: a subdirectory's description and the description of a concept without one are
 * taken from the existing index; entries for the directory's other files (`check.py`) are kept. A subdirectory
 * without such a description gets its only entry's description, else none. The root index keeps its front matter.
 *
 * Returns undefined when the directory has nothing to list.
 */
export function generateIndex(bundle: Bundle, directory = "", options: GenerateIndexOptions = {}): string | undefined {
  const dir = directory.replace(/^\/+|\/+$/g, "");
  return generateWith(bundle, dir, options, new Map());
}

function generateWith(
  bundle: Bundle,
  dir: string,
  options: GenerateIndexOptions,
  memo: Map<string, Entry[]>
): string | undefined {
  const entries = entriesFor(bundle, dir, options, memo);
  if (entries.length === 0) return undefined;
  let head = "";
  if (dir === "") {
    if (options.okfVersion !== undefined) {
      head = `---\nokf_version: "${options.okfVersion.replace(/"/g, '\\"')}"\n---\n\n`;
    } else {
      const existing = bundle.indexes.get("");
      const m = existing ? /^(\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n)/.exec(existing.text) : null;
      if (m && existing?.frontMatter) head = `${m[1]}\n`;
    }
  }
  return head + render(entries);
}

/**
 * Generates the `index.md` of every directory that has something to list, keyed by the index's bundle path
 * (`tables/index.md`), sorted.
 */
export function generateIndexes(bundle: Bundle, options: GenerateIndexOptions = {}): Map<string, string> {
  const memo = new Map<string, Entry[]>();
  const out = new Map<string, string>();
  for (const dir of bundle.directories) {
    const text = generateWith(bundle, dir, options, memo);
    if (text !== undefined) out.set(dir === "" ? INDEX_FILE : `${dir}/${INDEX_FILE}`, text);
  }
  return out;
}
