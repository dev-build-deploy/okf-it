/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { asText, isIsoDate } from "./fields";
import { ParseProblem, parseFrontMatterYaml, splitFrontMatter } from "./frontmatter";
import { MarkdownScan, scanMarkdown } from "./markdown";

/** The reserved file names (§3.1): never concepts. */
export const INDEX_FILE = "index.md";
export const LOG_FILE = "log.md";
export const RESERVED_FILES: readonly string[] = [INDEX_FILE, LOG_FILE];

/** True when the file name (the last path segment) is reserved (§3.1). */
export function isReserved(path: string): boolean {
  return RESERVED_FILES.includes(path.split("/").pop() ?? "");
}

/** The directory of a bundle path (`""` for the root). */
export function directoryOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** An index entry (§8): `* [Title](url) - description`. */
export interface IndexEntry {
  title: string;
  url: string;
  /** The text after the separator; undefined when there is none. */
  description?: string;
  line: number;
  column: number;
}

/** An index section (§8): a heading and the entries under it. */
export interface IndexSection {
  heading: string;
  level: number;
  line: number;
  entries: IndexEntry[];
}

/** A parsed `index.md` (§8). */
export interface IndexFile {
  /** The bundle path (`tables/index.md`). */
  path: string;
  /** The directory it lists (`tables`, `""` for the root). */
  directory: string;
  /** The front matter, when the file has one (only `okf_version` on the bundle root is allowed, §8, §12). */
  frontMatter?: Record<string, unknown>;
  /** `okf_version` from the root index's front matter (§12). */
  okfVersion?: string;
  sections: IndexSection[];
  /** Every entry of every section, in order. */
  entries: IndexEntry[];
  /** Structural problems (§8, §11.3); the checker decides their severity. */
  problems: ParseProblem[];
  /** The file as read. */
  text: string;
  /** @internal */ scan: MarkdownScan;
}

const ENTRY =
  /^\[((?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\])*)\]\(\s*(<[^>]*>|(?:[^\s()\\]|\\.|\([^\s()]*\))+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)(.*)$/;
const SEPARATOR = /^\s*(?:[-–—:])\s*(.*)$/;

/** Parses an `index.md` (§8). `path` is its bundle path (default: the bundle root's). Never throws. */
export function parseIndex(text: string, path: string = INDEX_FILE): IndexFile {
  const directory = directoryOf(path);
  const split = splitFrontMatter(text);
  const problems: ParseProblem[] = [];
  let frontMatter: Record<string, unknown> | undefined;
  let okfVersion: string | undefined;
  let bodyText = text.slice(split.bom.length);
  let lineOffset = 0;
  if (split.present && split.closed) {
    bodyText = split.body;
    lineOffset = split.bodyLine - 1;
    const parsed = parseFrontMatterYaml(split.yaml, split.yamlLine);
    frontMatter = parsed.data;
    if (parsed.problems.length > 0) {
      for (const p of parsed.problems) problems.push({ ...p, code: "index-front-matter-invalid" });
    } else if (directory !== "") {
      problems.push({
        code: "index-front-matter",
        message: "Index files contain no front matter; only the bundle root index may carry `okf_version`",
        line: 1,
        column: 1,
      });
    } else {
      const raw = frontMatter.okf_version;
      okfVersion = asText(raw);
      const extra = Object.keys(frontMatter).filter(k => k !== "okf_version");
      if (extra.length > 0) {
        problems.push({
          code: "index-extra-front-matter",
          message: `The root index front matter may only carry \`okf_version\`; also found: ${extra.join(", ")}`,
          line: 1,
          column: 1,
        });
      }
    }
  } else if (split.present) {
    problems.push({
      code: "index-front-matter-invalid",
      message: "The front matter block has no closing `---` line",
      line: 1,
      column: 1,
    });
  }

  const scan = scanMarkdown(bodyText, lineOffset);
  const sections: IndexSection[] = scan.headings.map(h => ({
    heading: h.text,
    level: h.level,
    line: h.line,
    entries: [],
  }));
  const entries: IndexEntry[] = [];
  for (const item of scan.listItems) {
    const m = ENTRY.exec(item.text);
    if (!m) {
      problems.push({
        code: "index-item-malformed",
        message: "An index list item must be a link: `* [Title](url) - description`",
        line: item.line,
        column: item.column,
      });
      continue;
    }
    let url = m[2];
    if (url.startsWith("<")) url = url.slice(1, -1);
    const rest = m[3];
    let description: string | undefined;
    if (rest.trim() !== "") {
      const sep = SEPARATOR.exec(rest);
      if (sep) {
        description = sep[1].trim() || undefined;
      } else {
        description = rest.trim();
        problems.push({
          code: "index-entry-separator",
          message: "Separate an index entry's description from its link with ` - `",
          line: item.line,
          column: item.column,
        });
      }
    }
    const entry: IndexEntry = {
      title: m[1].replace(/\\([[\]\\])/g, "$1"),
      url: url.replace(/\\(.)/g, "$1"),
      description,
      line: item.line,
      column: item.column,
    };
    entries.push(entry);
    if (item.heading < 0) {
      problems.push({
        code: "index-entry-outside-section",
        message: "Index entries must be grouped under a section heading (§8)",
        line: item.line,
        column: item.column,
      });
    } else {
      sections[item.heading].entries.push(entry);
    }
  }
  if (entries.length === 0) {
    problems.push({ code: "index-empty", message: "The index lists nothing", line: 1, column: 1 });
  } else {
    sections.forEach((s, i) => {
      let nested = 0;
      for (let j = i + 1; j < sections.length && sections[j].level > s.level; j++) nested += sections[j].entries.length;
      if (s.entries.length === 0 && nested === 0) {
        problems.push({
          code: "index-empty-section",
          message: `Section "${s.heading}" lists nothing`,
          line: s.line,
          column: 1,
        });
      }
    });
  }
  return { path, directory, frontMatter, okfVersion, sections, entries, problems, text, scan };
}

/** A log entry (§9). */
export interface LogEntry {
  /** The entry text (list item or paragraph), as written. */
  text: string;
  /** The leading bold word (`Update`, `Creation`, `Deprecation`), a convention, not a requirement. */
  kind?: string;
  line: number;
}

/** A date group of a log (§9). */
export interface LogDay {
  /** `YYYY-MM-DD`. */
  date: string;
  line: number;
  entries: LogEntry[];
}

/** A parsed `log.md` (§9). */
export interface LogFile {
  path: string;
  directory: string;
  /** The first level-1 heading that is not a date. */
  title?: string;
  /** Front matter, when present (§9 does not define one). */
  frontMatter?: Record<string, unknown>;
  /** The date groups, as written (newest first when conformant). */
  days: LogDay[];
  /** Every entry, in order. */
  entries: LogEntry[];
  problems: ParseProblem[];
  text: string;
  /** @internal */ scan: MarkdownScan;
}

/** Parses a `log.md` (§9). Never throws. */
export function parseLog(text: string, path: string = LOG_FILE): LogFile {
  const directory = directoryOf(path);
  const split = splitFrontMatter(text);
  const problems: ParseProblem[] = [];
  let frontMatter: Record<string, unknown> | undefined;
  let bodyText = text.slice(split.bom.length);
  let lineOffset = 0;
  if (split.present && split.closed) {
    bodyText = split.body;
    lineOffset = split.bodyLine - 1;
    const parsed = parseFrontMatterYaml(split.yaml, split.yamlLine);
    frontMatter = parsed.data;
    problems.push({
      code: "log-front-matter",
      message: "§9 defines no front matter for log files",
      line: 1,
      column: 1,
    });
    for (const p of parsed.problems) problems.push(p);
  }

  const scan = scanMarkdown(bodyText, lineOffset);
  let title: string | undefined;
  const days: LogDay[] = [];
  const dayOfHeading = new Map<number, LogDay>();
  scan.headings.forEach((h, i) => {
    if (isIsoDate(h.text)) {
      const day = { date: h.text, line: h.line, entries: [] };
      days.push(day);
      dayOfHeading.set(i, day);
    } else if (i === 0 && h.level === 1) {
      title = h.text;
    } else {
      problems.push({
        code: "log-date-heading",
        message: `Log date headings must use ISO 8601 \`YYYY-MM-DD\` form, found "${h.text}"`,
        line: h.line,
        column: 1,
      });
    }
  });

  const entries: LogEntry[] = [];
  const add = (heading: number, text: string, line: number, column: number, listItem: boolean): void => {
    let owner: LogDay | undefined;
    for (let h = heading; h >= 0 && !owner; h--) owner = dayOfHeading.get(h);
    if (!owner) {
      if (listItem) {
        problems.push({
          code: "log-entry-outside-date",
          message: "Log entries must be grouped under a `YYYY-MM-DD` date heading (§9)",
          line,
          column,
        });
      }
      return;
    }
    const kind = /^\*\*([^*]+?)\*\*/.exec(text)?.[1]?.replace(/:$/, "");
    const entry = { text, kind, line };
    owner.entries.push(entry);
    entries.push(entry);
  };
  const items = [
    ...scan.listItems.map(i => ({ heading: i.heading, text: i.text, line: i.line, column: i.column, list: true })),
    ...scan.paragraphs.map(p => ({ heading: p.heading, text: p.text, line: p.line, column: 1, list: false })),
  ].sort((a, b) => a.line - b.line);
  for (const item of items) add(item.heading, item.text, item.line, item.column, item.list);

  const seen = new Set<string>();
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    if (seen.has(day.date)) {
      problems.push({
        code: "log-duplicate-date",
        message: `Date ${day.date} appears more than once`,
        line: day.line,
        column: 1,
      });
    }
    seen.add(day.date);
    if (i > 0 && day.date > days[i - 1].date) {
      problems.push({
        code: "log-order",
        message: `Log dates must be newest first: ${day.date} follows ${days[i - 1].date}`,
        line: day.line,
        column: 1,
      });
    }
    if (day.entries.length === 0) {
      problems.push({ code: "log-empty-date", message: `Date ${day.date} has no entries`, line: day.line, column: 1 });
    }
  }
  return { path, directory, title, frontMatter, days, entries, problems, text, scan };
}
