/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

/**
 * The typed views of OKF front matter values (§5, §7, §10). Every normaliser is total: it never throws, it returns
 * `undefined` (or an empty list) for a value of the wrong shape, and the checker reports the shape.
 */

/** §5.3: derived from `verified`, lowest to highest. */
export type TrustTier = "unverified" | "machine-confirmed" | "human-reviewed";

/** §5.4. Absent ⇒ `stable`. Unknown values are kept as written. */
export type Status = "draft" | "stable" | "deprecated";

/** §7: the kind of actor an identity string names. */
export type ActorKind = "human" | "process" | "agent" | "unknown";

/** §7: an identity string (`generated.by`, `verified[].by`, `sources[].author`), parsed. */
export interface Actor {
  /** The string as written. */
  raw: string;
  /** `human:<id>`, `process:<id>`, `<producer>/<version>`; anything else is `unknown`. */
  kind: ActorKind;
  /** For `human:` and `process:` (and other `prefix:` forms): the part after the colon. */
  id?: string;
  /** For `unknown` actors of the form `prefix:id` (for example `team:finance`): the prefix. */
  prefix?: string;
  /** For agents: the producer (before the slash). */
  producer?: string;
  /** For agents: the version (after the slash). */
  version?: string;
}

/** A `{ from, to }` datetime range (§5.1 `usage_window`). */
export interface UsageWindow {
  from?: string;
  to?: string;
}

/** A `sources` entry (§5.1). */
export interface Source {
  /** REQUIRED within an entry: a URL, a bundle path, or a scope descriptor. */
  resource?: string;
  /** A stable key for per-claim attribution (footnote labels). */
  id?: string;
  title?: string;
  /** Credibility signal: who produced the source (actor convention). */
  author?: string;
  /** Credibility signal: how often `resource` was exercised over the usage window. */
  usageCount?: number;
  /** Credibility signal: when the source last changed (ISO 8601). */
  lastModified?: string;
  /** The entry's own `usage_window`, else the concept's shared one. */
  usageWindow?: UsageWindow;
  /** The entry as written, unknown keys included. */
  raw: Record<string, unknown>;
}

/** `generated` (§5.2). */
export interface Generated {
  /** REQUIRED within `generated`: an actor. */
  by?: string;
  /** The content's last meaningful change (ISO 8601). */
  at?: string;
}

/** A `verified` event (§5.2). */
export interface Verification {
  by?: string;
  at?: string;
}

/** A `parameters` entry of an Attested Computation (§10.2). */
export interface Parameter {
  name?: string;
  type?: string;
  required: boolean;
  raw: Record<string, unknown>;
}

/** `executor` of an Attested Computation (§10.2). */
export interface Executor {
  /** Run instructions or code (a path, §6.2). */
  resource?: string;
  /** The fields a run must return. */
  receipt: string[];
  raw: Record<string, unknown>;
}

/** `attester` of an Attested Computation (§10.2). */
export interface Attester {
  /** Deterministic code that checks a receipt (a path, §6.2). */
  resource?: string;
  raw: Record<string, unknown>;
}

/** The computation of an Attested Computation (§10.3). */
export interface Computation {
  /** `inline`: the code block under `# Computation`; `file`: the `computation` path. */
  kind: "inline" | "file";
  /** For `inline`: the code. */
  code?: string;
  /** For `inline`: the fence's info string (`sql`), empty for none or an indented block. */
  language?: string;
  /** For `inline`: the line of the code block in the file. */
  line?: number;
  /** For `file`: the path as written. */
  path?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string value, or a number/boolean written where a string was meant, as a string. */
export function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** A non-empty (after trimming) string, else undefined. */
export function asText(value: unknown): string | undefined {
  const s = asString(value);
  return s !== undefined && s.trim() !== "" ? s : undefined;
}

const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Parses an OKF timestamp: an ISO 8601 datetime with an explicit UTC offset (§5). Returns `undefined` for anything
 * else, including a date-only `2026-12-31` (it names a different instant in every time zone).
 */
export function parseTimestamp(value: unknown): Date | undefined {
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value;
  if (typeof value !== "string") return undefined;
  const m = ISO_DATETIME.exec(value.trim());
  if (!m) return undefined;
  let offset = m[8].toUpperCase();
  if (offset !== "Z") {
    const digits = offset.slice(1).replace(":", "");
    offset = `${offset[0]}${digits.slice(0, 2)}:${digits.slice(2, 4) || "00"}`;
  }
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${m[7] ?? ""}${offset}`;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return undefined;
  // Reject overflowing fields (2026-02-30) that Date silently rolls over.
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(Number(m[1]), month)) return undefined;
  if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 60) return undefined;
  return date;
}

/** True when `value` is an ISO 8601 datetime with an explicit UTC offset (§5). */
export function isTimestamp(value: unknown): boolean {
  return parseTimestamp(value) !== undefined;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True for a valid calendar date written `YYYY-MM-DD` (§9 log headings). */
export function isIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(Number(m[1]), month);
}

/** Parses an identity string per the actor convention (§7). */
export function parseActor(value: string): Actor {
  const raw = value;
  const s = value.trim();
  const colon = /^([A-Za-z][\w.-]*):(.+)$/.exec(s);
  if (colon) {
    const prefix = colon[1];
    if (prefix === "human") return { raw, kind: "human", id: colon[2] };
    if (prefix === "process") return { raw, kind: "process", id: colon[2] };
    return { raw, kind: "unknown", prefix, id: colon[2] };
  }
  const slash = /^([^/\s]+)\/(\S+)$/.exec(s);
  if (slash) return { raw, kind: "agent", producer: slash[1], version: slash[2] };
  return { raw, kind: "unknown" };
}

/** `tags`: a list of short strings; a single string is read as a one-element list. */
export function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map(asText).filter((t): t is string => t !== undefined);
}

export function normalizeUsageWindow(value: unknown): UsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  return { from: asString(value.from), to: asString(value.to) };
}

/** `sources` (§5.1): entries that are not mappings are skipped; `usage_window` falls back to the shared one. */
export function normalizeSources(value: unknown, sharedWindow?: unknown): Source[] {
  if (!Array.isArray(value)) return [];
  const shared = normalizeUsageWindow(sharedWindow);
  return value.filter(isRecord).map(entry => {
    const count = entry.usage_count;
    return {
      resource: asText(entry.resource),
      id: asText(entry.id),
      title: asText(entry.title),
      author: asText(entry.author),
      usageCount: typeof count === "number" ? count : undefined,
      lastModified: asText(entry.last_modified),
      usageWindow: normalizeUsageWindow(entry.usage_window) ?? shared,
      raw: entry,
    };
  });
}

export function normalizeGenerated(value: unknown): Generated | undefined {
  if (!isRecord(value)) return undefined;
  return { by: asText(value.by), at: asText(value.at) };
}

/** `verified` (§5.2): a list of `{ by, at }`; a bare mapping is a one-element list (MUST, §11). */
export function normalizeVerified(value: unknown): Verification[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter(isRecord).map(v => ({ by: asText(v.by), at: asText(v.at) }));
}

/** §5.3: the trust tier, derived only from `verified`. */
export function trustTierOf(verified: Verification[]): TrustTier {
  if (verified.length === 0) return "unverified";
  return verified.some(v => v.by !== undefined && parseActor(v.by).kind === "human")
    ? "human-reviewed"
    : "machine-confirmed";
}

export function normalizeParameters(value: unknown): Parameter[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(p => ({
    name: asText(p.name),
    type: asText(p.type),
    required: p.required === true,
    raw: p,
  }));
}

export function normalizeExecutor(value: unknown): Executor | undefined {
  if (!isRecord(value)) return undefined;
  const receipt = Array.isArray(value.receipt)
    ? value.receipt.map(asText).filter((r): r is string => r !== undefined)
    : [];
  return { resource: asText(value.resource), receipt, raw: value };
}

export function normalizeAttester(value: unknown): Attester | undefined {
  if (!isRecord(value)) return undefined;
  return { resource: asText(value.resource), raw: value };
}

/** Derives a display title from a file name (§4.1): `gross-margin_v2` → `Gross margin v2`. */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.md$/i, "");
  const words = base.replace(/[-_]+/g, " ").trim();
  if (words === "") return base;
  return words[0].toUpperCase() + words.slice(1);
}

/** Deep equality for plain YAML values (objects, arrays, scalars). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (Array.isArray(b)) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (typeof a === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every(
      k =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    );
  }
  return false;
}

/** A deep copy of a plain YAML value. */
export function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => clone(v)) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out as T;
  }
  return value;
}
