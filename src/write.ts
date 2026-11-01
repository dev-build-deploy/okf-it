/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { Document, isCollection } from "yaml";

import { Concept } from "./concept";
import { deepEqual, isRecord } from "./fields";

/** Dates become OKF timestamps (`2026-06-25T09:00:00Z`); everything else is kept. */
function toYamlValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().replace(/\.000Z$/, "Z");
  if (Array.isArray(value)) return value.map(toYamlValue);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = toYamlValue(v);
    return out;
  }
  return value;
}

/** Renders `key: value` as YAML (block style, or flow style when `flow`), ending in `eol`. */
function renderPair(key: string, value: unknown, flow: boolean, eol: string, padded = true): string {
  const doc = new Document({ [key]: toYamlValue(value) });
  if (flow) {
    const node = doc.get(key, true);
    if (isCollection(node)) node.flow = true;
  }
  const text = doc.toString({ lineWidth: 0, flowCollectionPadding: padded });
  return eol === "\n" ? text : text.replace(/\n/g, eol);
}

/** Renders a whole mapping as YAML (used when a file had no front matter). */
function renderMapping(data: Record<string, unknown>, eol: string): string {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => renderPair(k, v, false, eol))
    .join("");
}

/**
 * Renders a concept back to its file text (§4).
 *
 * - Nothing changed: the input, byte for byte.
 * - Changed keys are re-rendered in place (a value written in flow style stays in flow style); unchanged keys, their
 *   comments and unknown keys are copied as written; deleted keys are dropped; new keys are appended.
 * - A changed body replaces the old one as given.
 *
 * Throws when the concept's front matter did not parse and its front matter was changed (there is nothing safe to
 * splice into).
 */
export function writeConcept(concept: Concept): string {
  const split = concept.split;
  const data = concept.frontMatter;
  const original = concept.original;
  const eol = split.eol;
  const bodyChanged = concept.body !== (split.closed ? split.body : split.present ? "" : split.body);
  const keysChanged = !deepEqual(stripUndefined(data), original);

  if (!keysChanged && !bodyChanged) return concept.text;

  if (!split.closed || (split.present && !concept.document)) {
    if (keysChanged && split.present) {
      throw new Error(`${concept.path}: cannot write front matter that did not parse; fix the YAML first`);
    }
    if (!keysChanged) return split.bom + split.open + split.yaml + split.close + concept.body;
    return `${split.bom}---${eol}${renderMapping(data, eol)}---${eol}${concept.body}`;
  }

  const yaml = split.yaml;
  let out = "";
  let pos = 0;
  for (const span of concept.spans) {
    out += yaml.slice(pos, span.start);
    const value = data[span.key];
    if (value === undefined) {
      // deleted: drop the key's lines
    } else if (deepEqual(value, original[span.key])) {
      out += yaml.slice(span.start, span.end);
    } else {
      out += renderPair(span.key, value, span.flow, eol, span.padded);
    }
    pos = span.end;
  }
  out += yaml.slice(pos);
  const known = new Set(concept.spans.map(s => s.key));
  for (const [key, value] of Object.entries(data)) {
    if (known.has(key) || value === undefined) continue;
    if (out !== "" && !out.endsWith("\n")) out += eol;
    out += renderPair(key, value, false, eol);
  }
  return split.bom + split.open + out + split.close + concept.body;
}

function stripUndefined(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = v;
  return out;
}
