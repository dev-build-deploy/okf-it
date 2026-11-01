/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Document, LineCounter, isMap, parseDocument } from "yaml";

import { isRecord } from "./fields";

/** A problem found while reading a file, before any checking. */
export interface ParseProblem {
  code: string;
  message: string;
  line?: number;
  column?: number;
}

/**
 * A file split at its front matter (§4): the YAML block delimited by `---` lines at the very start, and the body
 * after it. All parts are kept exactly as written, so `open + yaml + close + body` (after the BOM) is the input.
 */
export interface FrontMatterSplit {
  /** A leading byte order mark, if any. */
  bom: string;
  /** True when the file starts with a `---` line. */
  present: boolean;
  /** True when a closing `---` line was found. */
  closed: boolean;
  /** The opening delimiter line with its line break (empty when absent). */
  open: string;
  /** The YAML text between the delimiters. */
  yaml: string;
  /** The closing delimiter line with its line break (empty when absent). */
  close: string;
  /** Everything after the front matter, exactly as written. */
  body: string;
  /** 1-based line of the first YAML line. */
  yamlLine: number;
  /** 1-based line where the body starts. */
  bodyLine: number;
  /** The line break the file uses (`\n` or `\r\n`). */
  eol: string;
}

const DELIMITER = /^---[ \t]*(\r?\n|$)/;

/** Splits a markdown file into front matter and body (§4). Never throws. */
export function splitFrontMatter(text: string): FrontMatterSplit {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const rest = text.slice(bom.length);
  const eol = rest.slice(0, rest.indexOf("\n") + 1).includes("\r\n") ? "\r\n" : "\n";
  const none: FrontMatterSplit = {
    bom,
    present: false,
    closed: false,
    open: "",
    yaml: "",
    close: "",
    body: rest,
    yamlLine: 1,
    bodyLine: 1,
    eol,
  };
  const first = DELIMITER.exec(rest);
  if (!first) return none;
  const open = first[0];
  let offset = open.length;
  let line = 2;
  while (offset <= rest.length) {
    const next = rest.indexOf("\n", offset);
    const end = next < 0 ? rest.length : next + 1;
    const content = rest.slice(offset, end);
    if (/^---[ \t]*\r?\n?$/.test(content) && content.length > 0) {
      return {
        bom,
        present: true,
        closed: true,
        open,
        yaml: rest.slice(open.length, offset),
        close: content,
        body: rest.slice(end),
        yamlLine: 2,
        bodyLine: line + 1,
        eol,
      };
    }
    if (next < 0) break;
    offset = end;
    line++;
  }
  return { ...none, present: true, open, yaml: rest.slice(open.length), body: "", yamlLine: 2, bodyLine: line + 1 };
}

/** The parsed YAML of a front matter block. */
export interface ParsedFrontMatter {
  /** The mapping as plain values (empty when absent or invalid). */
  data: Record<string, unknown>;
  /** The YAML document (with source ranges), when the block parsed. */
  document?: Document.Parsed;
  lineCounter: LineCounter;
  problems: ParseProblem[];
}

/**
 * Parses a front matter block as YAML 1.2 (core schema), so timestamps stay the strings the author wrote. `yamlLine`
 * is the file line of the block's first line, used for the problem positions.
 */
export function parseFrontMatterYaml(yaml: string, yamlLine: number): ParsedFrontMatter {
  const lineCounter = new LineCounter();
  const problems: ParseProblem[] = [];
  const document = parseDocument(yaml, { lineCounter, prettyErrors: false, uniqueKeys: true });
  if (document.errors.length > 0) {
    for (const error of document.errors) {
      const pos = lineCounter.linePos(error.pos[0]);
      problems.push({
        code: "front-matter-invalid",
        message: `Front matter is not valid YAML: ${error.message.split("\n")[0]}`,
        line: pos.line + yamlLine - 1,
        column: pos.col,
      });
    }
    return { data: {}, lineCounter, problems };
  }
  if (document.contents === null) return { data: {}, document, lineCounter, problems };
  if (!isMap(document.contents)) {
    const pos = lineCounter.linePos(document.contents.range?.[0] ?? 0);
    problems.push({
      code: "front-matter-not-mapping",
      message: "Front matter must be a YAML mapping of keys to values",
      line: pos.line + yamlLine - 1,
      column: pos.col,
    });
    return { data: {}, lineCounter, problems };
  }
  const js: unknown = document.toJS({ maxAliasCount: 100 });
  return { data: isRecord(js) ? js : {}, document, lineCounter, problems };
}
