/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import { INDEX_FILE, LOG_FILE, directoryOf } from "./reserved";

/** What a link or path-valued field points at (§6). */
export type TargetKind =
  /** A concept document (`.md`, not reserved). */
  | "concept"
  /** An `index.md`. */
  | "index"
  /** A `log.md`. */
  | "log"
  /** A directory of the bundle (`tables/`). */
  | "directory"
  /** Any other file of the bundle (`attesters/check.py`). */
  | "file"
  /** An absolute URL (`https://...`, `mailto:...`). */
  | "external"
  /** A fragment only (`#schema`): the same document. */
  | "anchor"
  /** A path that climbs out of the bundle root. */
  | "outside"
  /** A `sources[].resource` scope descriptor (§5.1), not a path. */
  | "descriptor";

/** A resolved link or path (§6). */
export interface Target {
  kind: TargetKind;
  /** The bundle path (no leading `/`; `""` for the root directory), for in-bundle kinds. */
  path?: string;
  /** For `concept`: the concept ID. */
  conceptId?: string;
  /** The `#fragment`, without the `#`. */
  fragment?: string;
  /** True when the target exists in the bundle (always true for `external`, `anchor` and `descriptor`). */
  exists: boolean;
  /** How a relative path was resolved: against the file's directory, or (fallback) the bundle root. */
  base?: "file" | "root";
}

/** What the resolver needs to know about the bundle. */
export interface PathIndex {
  /** Every file of the bundle (bundle paths). */
  files: ReadonlySet<string>;
  /** Every directory of the bundle (`""` for the root). */
  directories: ReadonlySet<string>;
}

/** Normalises a `/`-separated path; undefined when `..` climbs above the root. */
export function normalizePath(path: string): string | undefined {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join("/");
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch (_e) {
    return s;
  }
}

/** True for an absolute URL (a scheme, or protocol-relative `//host`). */
export function isAbsoluteUrl(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith("//");
}

function classify(path: string, trailingSlash: boolean, index: PathIndex, fragment?: string): Target {
  if (trailingSlash || path === "" || (index.directories.has(path) && !index.files.has(path))) {
    return { kind: "directory", path, fragment, exists: index.directories.has(path) };
  }
  const name = path.split("/").pop() ?? "";
  const exists = index.files.has(path);
  if (name === INDEX_FILE) return { kind: "index", path, fragment, exists };
  if (name === LOG_FILE) return { kind: "log", path, fragment, exists };
  if (/\.md$/i.test(name)) return { kind: "concept", path, conceptId: path.replace(/\.md$/i, ""), fragment, exists };
  return { kind: "file", path, fragment, exists };
}

/**
 * Resolves a link destination or a path-valued field written in the file at `from` (a bundle path) (§6).
 *
 * - An absolute URL is `external`; a bare `#fragment` is an `anchor`.
 * - A path starting with `/` is bundle-relative; any other path is relative to the file's directory (§6.1).
 * - With `rootFallback`, a bare relative path (not starting with `./` or `../`) that does not exist next to the file
 *   but does exist from the bundle root resolves there. The spec's own examples write path-valued fields that way
 *   (`references/skills/run-on-bq.md` from `computations/revenue.md`), so it is used for §6.2 fields, not for links.
 */
export function resolveTarget(from: string, url: string, index: PathIndex, rootFallback = false): Target {
  const raw = url.trim();
  if (raw === "") return { kind: "anchor", exists: true };
  if (isAbsoluteUrl(raw)) return { kind: "external", exists: true };
  const hash = raw.indexOf("#");
  const fragment = hash >= 0 ? decode(raw.slice(hash + 1)) : undefined;
  let pathPart = hash >= 0 ? raw.slice(0, hash) : raw;
  const query = pathPart.indexOf("?");
  if (query >= 0) pathPart = pathPart.slice(0, query);
  if (pathPart === "") return { kind: "anchor", fragment, exists: true };
  pathPart = decode(pathPart);
  const trailingSlash = pathPart.endsWith("/");

  if (pathPart.startsWith("/")) {
    const p = normalizePath(pathPart);
    if (p === undefined) return { kind: "outside", fragment, exists: false };
    return { ...classify(p, trailingSlash, index, fragment), base: "root" };
  }
  const fromFile = normalizePath(`${directoryOf(from)}/${pathPart}`);
  const fileTarget =
    fromFile === undefined
      ? ({ kind: "outside", fragment, exists: false } as Target)
      : { ...classify(fromFile, trailingSlash, index, fragment), base: "file" as const };
  if (fileTarget.exists || !rootFallback || /^\.\.?\//.test(pathPart)) return fileTarget;
  const fromRoot = normalizePath(pathPart);
  if (fromRoot === undefined) return fileTarget;
  const rootTarget = { ...classify(fromRoot, trailingSlash, index, fragment), base: "root" as const };
  return rootTarget.exists ? rootTarget : fileTarget;
}

/** The relative link from the directory `fromDir` to the bundle path `to` (both `/`-separated, no leading `/`). */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir === "" ? [] : fromDir.split("/");
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}
