/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

/**
 * A small, deterministic markdown scanner: just enough CommonMark to find the headings, links, footnotes and code
 * blocks of an OKF document, with their line numbers. Code (fenced, indented, inline) and HTML comments are skipped, so
 * a link inside a code sample is never mistaken for a relationship.
 */

/** A heading (ATX `# x` or setext `x\n===`). */
export interface Heading {
  /** 1..6 */
  level: number;
  /** The heading text, trimmed, without the closing `#`s. */
  text: string;
  /** 1-based line number (relative to the scanned text). */
  line: number;
}

/** A markdown link or image, as written. */
export interface MarkdownLink {
  /** The link text (for an image: the alt text), as written. */
  text: string;
  /** The destination, as written (angle brackets removed). */
  url: string;
  /** The optional link title. */
  title?: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the opening `[` (or `!`, `<`). */
  column: number;
  /** True for `![alt](src)`. */
  image: boolean;
  /** For a reference link (`[text][label]`), the label. */
  reference?: string;
  /** True for an autolink (`<https://...>`). */
  autolink?: boolean;
}

/** A footnote reference (`[^label]`) or definition (`[^label]: text`). */
export interface Footnote {
  label: string;
  /** For a definition: its text. */
  text?: string;
  line: number;
  column: number;
}

/** A code block: fenced (```` ``` ````, `~~~`) or indented (four spaces). */
export interface CodeBlock {
  fenced: boolean;
  /** The info string of a fence (`sql`), empty for none. */
  info: string;
  /** The code, without the fences or the indentation; lines joined with `\n`, a trailing newline. */
  code: string;
  /** 1-based line of the opening fence (or the first indented line). */
  line: number;
  /** 1-based line of the closing fence (or the last indented line). */
  endLine: number;
  /** The index (into `headings`) of the heading this block is under, -1 for none. */
  heading: number;
}

/** A list item (`* x`, `- x`, `+ x`, `1. x`) with its continuation lines. */
export interface ListItem {
  /** The marker as written (`*`, `-`, `+`, `1.`). */
  marker: string;
  /** The item's text, continuation lines joined with a space. */
  text: string;
  line: number;
  /** The column of the text after the marker (1-based). */
  column: number;
  /** The index (into `headings`) of the heading this item is under, -1 for none. */
  heading: number;
}

/** The result of {@link scanMarkdown}. */
export interface MarkdownScan {
  headings: Heading[];
  links: MarkdownLink[];
  footnoteReferences: Footnote[];
  footnoteDefinitions: Footnote[];
  codeBlocks: CodeBlock[];
  listItems: ListItem[];
  /** Paragraphs (consecutive text lines joined with a space) that are not headings, list items, code or definitions. */
  paragraphs: { text: string; line: number; heading: number }[];
}

/** Splits text into lines, accepting `\n` and `\r\n`. A trailing newline does not make an extra empty line. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const LIST = /^( {0,3})([*+-]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const DEFINITION = /^ {0,3}\[([^\]^][^\]]*)\]:[ \t]*(<[^>]*>|\S+)(?:[ \t]+("[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const FOOTNOTE_DEF = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;

/** True when a fence line closes the fence opened with `marker` (same character, at least as long, no info). */
function closesFence(f: RegExpExecArray | null, marker: string): boolean {
  return f !== null && f[2].startsWith(marker.charAt(0)) && f[2].length >= marker.length && f[3].trim() === "";
}

function indentOf(line: string): number {
  let n = 0;
  for (const c of line) {
    if (c === " ") n += 1;
    else if (c === "\t") n += 4 - (n % 4);
    else break;
  }
  return n;
}

function stripIndent(line: string, width: number): string {
  let n = 0;
  let i = 0;
  while (i < line.length && n < width) {
    if (line[i] === " ") n += 1;
    else if (line[i] === "\t") n += 4 - (n % 4);
    else break;
    i += 1;
  }
  return line.slice(i);
}

/** Replaces inline code spans and HTML comments with spaces, keeping the columns. */
function maskInline(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\\" && i + 1 < line.length) {
      out += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (line[i] === "`") {
      let run = 1;
      while (line[i + run] === "`") run += 1;
      const ticks = "`".repeat(run);
      let j = i + run;
      let close = -1;
      while (j < line.length) {
        const k = line.indexOf(ticks, j);
        if (k < 0) break;
        if (line[k + run] !== "`" && line[k - 1] !== "`") {
          close = k;
          break;
        }
        j = k + 1;
      }
      if (close < 0) {
        out += ticks;
        i += run;
        continue;
      }
      out += " ".repeat(close + run - i);
      i = close + run;
      continue;
    }
    out += line[i];
    i += 1;
  }
  return out;
}

/** Finds the closing `]` of a bracket opened at `open`, honouring nesting and escapes. */
function closeBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i += 1;
      continue;
    }
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parses `(dest "title")` starting at `open` (the `(`); returns the end index (after `)`) or -1. */
function parseDestination(s: string, open: number): { url: string; title?: string; end: number } | undefined {
  let i = open + 1;
  while (s[i] === " " || s[i] === "\t") i++;
  let url = "";
  if (s[i] === "<") {
    const close = s.indexOf(">", i);
    if (close < 0) return undefined;
    url = s.slice(i + 1, close);
    i = close + 1;
  } else {
    let depth = 0;
    const start = i;
    while (i < s.length) {
      const c = s[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === " " || c === "\t") break;
      if (c === "(") depth++;
      if (c === ")") {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    url = s.slice(start, i);
  }
  while (s[i] === " " || s[i] === "\t") i++;
  let title: string | undefined;
  const q = s[i];
  if (q === '"' || q === "'" || q === "(") {
    const closer = q === "(" ? ")" : q;
    const close = s.indexOf(closer, i + 1);
    if (close < 0) return undefined;
    title = s.slice(i + 1, close);
    i = close + 1;
    while (s[i] === " " || s[i] === "\t") i++;
  }
  if (s[i] !== ")") return undefined;
  return { url, title, end: i + 1 };
}

function scanInline(
  original: string,
  lineNo: number,
  columnOffset: number,
  definitions: Map<string, { url: string; title?: string }>,
  scan: MarkdownScan
): void {
  const s = maskInline(original);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "<") {
      const m = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/.exec(s.slice(i));
      if (m) {
        scan.links.push({
          text: m[1],
          url: m[1],
          line: lineNo,
          column: columnOffset + i + 1,
          image: false,
          autolink: true,
        });
        i += m[0].length;
        continue;
      }
      if (s.startsWith("<!--", i)) {
        const close = s.indexOf("-->", i + 4);
        i = close < 0 ? s.length : close + 3;
        continue;
      }
    }
    if (c === "[") {
      const image = i > 0 && s[i - 1] === "!" && (i < 2 || s[i - 2] !== "\\");
      const start = image ? i - 1 : i;
      if (s[i + 1] === "^") {
        const close = s.indexOf("]", i);
        const label = close > 0 ? s.slice(i + 2, close) : "";
        if (close > 0 && label.length > 0 && !/\s/.test(label) && s[close + 1] !== ":") {
          scan.footnoteReferences.push({ label, line: lineNo, column: columnOffset + i + 1 });
          i = close + 1;
          continue;
        }
      }
      const close = closeBracket(s, i);
      if (close < 0) {
        i++;
        continue;
      }
      const text = original.slice(i + 1, close);
      if (s[close + 1] === "(") {
        const dest = parseDestination(original, close + 1);
        if (dest) {
          scan.links.push({
            text,
            url: unescape(dest.url),
            title: dest.title,
            line: lineNo,
            column: columnOffset + start + 1,
            image,
          });
          i = dest.end;
          continue;
        }
      }
      if (s[close + 1] === "[") {
        const close2 = s.indexOf("]", close + 1);
        if (close2 > 0) {
          const label = s.slice(close + 2, close2) || text;
          const def = definitions.get(normalizeLabel(label));
          if (def) {
            scan.links.push({
              text,
              url: def.url,
              title: def.title,
              line: lineNo,
              column: columnOffset + start + 1,
              image,
              reference: label,
            });
            i = close2 + 1;
            continue;
          }
        }
      }
      const def = definitions.get(normalizeLabel(text));
      if (def && s[close + 1] !== ":") {
        scan.links.push({
          text,
          url: def.url,
          title: def.title,
          line: lineNo,
          column: columnOffset + start + 1,
          image,
          reference: text,
        });
        i = close + 1;
        continue;
      }
      // Not a link: continue inside the brackets (a link may be nested in the text).
      i++;
      continue;
    }
    i++;
  }
}

function unescape(url: string): string {
  return url.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Scans a markdown text. Line numbers are 1-based; pass `lineOffset` when the text starts further down a file (for a
 * body after front matter: the number of lines before it).
 */
export function scanMarkdown(text: string, lineOffset = 0): MarkdownScan {
  const lines = splitLines(text);
  const scan: MarkdownScan = {
    headings: [],
    links: [],
    footnoteReferences: [],
    footnoteDefinitions: [],
    codeBlocks: [],
    listItems: [],
    paragraphs: [],
  };

  // First pass: link reference definitions (they may appear after their use).
  const definitions = new Map<string, { url: string; title?: string }>();
  {
    let fence: string | undefined;
    for (const line of lines) {
      const f = FENCE.exec(line);
      if (fence) {
        if (closesFence(f, fence)) fence = undefined;
        continue;
      }
      if (f && !(f[2].startsWith("`") && f[3].includes("`"))) {
        fence = f[2];
        continue;
      }
      const d = DEFINITION.exec(line);
      if (d) {
        const key = normalizeLabel(d[1]);
        if (!definitions.has(key)) {
          let url = d[2];
          if (url.startsWith("<")) url = url.slice(1, -1);
          definitions.set(key, { url, title: d[3]?.slice(1, -1) });
        }
      }
    }
  }

  let fence: { marker: string; indent: number; info: string; line: number; code: string[] } | undefined;
  let indented: { line: number; endLine: number; code: string[]; blanks: number } | undefined;
  let inComment = false;
  let previousBlank = true;
  let inList = false;
  let paragraphLine = -1; // index into scan.paragraphs of the open paragraph's last line, for setext headings
  let currentItem: ListItem | undefined;

  const heading = (): number => scan.headings.length - 1;
  const flushIndented = (): void => {
    if (!indented) return;
    scan.codeBlocks.push({
      fenced: false,
      info: "",
      code: indented.code.join("\n") + "\n",
      line: indented.line,
      endLine: indented.endLine,
      heading: heading(),
    });
    indented = undefined;
  };

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const lineNo = n + 1 + lineOffset;
    const blank = line.trim() === "";

    if (fence) {
      const f = FENCE.exec(line);
      if (closesFence(f, fence.marker)) {
        scan.codeBlocks.push({
          fenced: true,
          info: fence.info,
          code: fence.code.length ? fence.code.join("\n") + "\n" : "",
          line: fence.line,
          endLine: lineNo,
          heading: heading(),
        });
        fence = undefined;
      } else {
        fence.code.push(stripIndent(line, fence.indent));
      }
      continue;
    }

    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }

    if (indented) {
      if (blank) {
        indented.blanks++;
        continue;
      }
      if (indentOf(line) >= 4) {
        for (; indented.blanks > 0; indented.blanks--) indented.code.push("");
        indented.code.push(stripIndent(line, 4));
        indented.endLine = lineNo;
        continue;
      }
      flushIndented();
    }

    if (blank) {
      previousBlank = true;
      paragraphLine = -1;
      currentItem = undefined;
      continue;
    }

    if (indentOf(line) >= 4 && previousBlank && !inList) {
      indented = { line: lineNo, endLine: lineNo, code: [stripIndent(line, 4)], blanks: 0 };
      previousBlank = false;
      paragraphLine = -1;
      continue;
    }

    const f = FENCE.exec(line);
    if (f && !(f[2].startsWith("`") && f[3].includes("`"))) {
      fence = { marker: f[2], indent: f[1].length, info: f[3].trim(), line: lineNo, code: [] };
      previousBlank = false;
      paragraphLine = -1;
      currentItem = undefined;
      continue;
    }

    if (/^ {0,3}<!--/.test(line) && !line.includes("-->")) {
      inComment = true;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      scan.headings.push({ level: atx[1].length, text: (atx[2] ?? "").trim(), line: lineNo });
      previousBlank = false;
      inList = false;
      paragraphLine = -1;
      currentItem = undefined;
      scanInline(atx[2] ?? "", lineNo, line.indexOf(atx[2] ?? "\0"), definitions, scan);
      continue;
    }

    const setext = SETEXT.exec(line);
    if (setext && paragraphLine >= 0 && !currentItem) {
      const p = scan.paragraphs.splice(paragraphLine, 1)[0];
      scan.headings.push({ level: setext[1].startsWith("=") ? 1 : 2, text: p.text.trim(), line: p.line });
      paragraphLine = -1;
      previousBlank = false;
      continue;
    }

    if (THEMATIC.test(line)) {
      previousBlank = false;
      paragraphLine = -1;
      inList = false;
      currentItem = undefined;
      continue;
    }

    const fd = FOOTNOTE_DEF.exec(line);
    if (fd) {
      scan.footnoteDefinitions.push({ label: fd[1], text: fd[2], line: lineNo, column: line.indexOf("[") + 1 });
      const textStart = line.length - fd[2].length;
      scanInline(fd[2], lineNo, textStart, definitions, scan);
      previousBlank = false;
      paragraphLine = -1;
      continue;
    }

    if (DEFINITION.test(line)) {
      previousBlank = false;
      paragraphLine = -1;
      continue;
    }

    const li = LIST.exec(line);
    if (li) {
      const content = li[3] ?? "";
      const column = line.length - content.length + 1;
      currentItem = { marker: li[2], text: content.trim(), line: lineNo, column, heading: heading() };
      scan.listItems.push(currentItem);
      scanInline(content, lineNo, column - 1, definitions, scan);
      inList = true;
      previousBlank = false;
      paragraphLine = -1;
      continue;
    }

    // A continuation of a list item, or a paragraph line.
    if (currentItem || (inList && indentOf(line) >= 2)) {
      if (currentItem) currentItem.text += " " + line.trim();
      scanInline(line, lineNo, 0, definitions, scan);
      previousBlank = false;
      continue;
    }
    inList = false;
    if (paragraphLine >= 0) {
      scan.paragraphs[paragraphLine].text += " " + line.trim();
    } else {
      scan.paragraphs.push({ text: line.trim(), line: lineNo, heading: heading() });
      paragraphLine = scan.paragraphs.length - 1;
    }
    scanInline(line, lineNo, 0, definitions, scan);
    previousBlank = false;
  }

  if (fence) {
    // An unclosed fence runs to the end of the document (CommonMark).
    scan.codeBlocks.push({
      fenced: true,
      info: fence.info,
      code: fence.code.length ? fence.code.join("\n") + "\n" : "",
      line: fence.line,
      endLine: lines.length + lineOffset,
      heading: heading(),
    });
  }
  flushIndented();
  scan.codeBlocks.sort((a, b) => a.line - b.line);
  return scan;
}
