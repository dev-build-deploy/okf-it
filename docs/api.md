<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# API

Everything is exported from `@dev-build-deploy/okf-it`. Section numbers (§) refer to the
[OKF v0.2 specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md). Nothing
throws on malformed content: problems are recorded and reported by the checker.

## Reading

| Function | Returns |
| --- | --- |
| `readBundle(directory: string, options?: ReadOptions): Bundle` | The bundle in a directory (§3). Skips names starting with `.` and `node_modules` (override with `options.ignore(path, isDirectory)`); does not follow symbolic links. Throws only when the directory cannot be read. |
| `createBundle(files: Record<string, string> \| Map<string, string>, options?: { otherFiles?: string[]; root?: string }): Bundle` | The same from texts in memory, keyed by bundle path. `otherFiles` names non-markdown files so links to them resolve. |
| `parseConcept(text: string, id: string): Concept` | One concept document (§4); `id` is its path without `.md`. |
| `parseIndex(text: string, path = "index.md"): IndexFile` | One `index.md` (§8). |
| `parseLog(text: string, path = "log.md"): LogFile` | One `log.md` (§9). |
| `splitFrontMatter(text: string): FrontMatterSplit` | A file split into BOM, delimiters, YAML and body, every part as written. |
| `scanMarkdown(text: string, lineOffset = 0): MarkdownScan` | Headings, links, footnotes, code blocks, list items and paragraphs, with line numbers; code is skipped. |

YAML is read as YAML 1.2 (core schema): timestamps stay the strings the author wrote.

## Bundle

| Member | Description |
| --- | --- |
| `root?: string` | The directory it was read from. |
| `concepts: ReadonlyMap<string, Concept>` | By concept ID, sorted. |
| `indexes: ReadonlyMap<string, IndexFile>` / `logs: ReadonlyMap<string, LogFile>` | By directory (`""` is the root), sorted. |
| `files: readonly string[]` / `directories: readonly string[]` | Every file and directory, as sorted bundle paths. |
| `okfVersion: string \| undefined` | `okf_version` of the root `index.md` (§12). |
| `concept(id)` | Lookup; accepts `x`, `x.md` and `/x.md`. |
| `outgoing(id): ResolvedLink[]` | A concept's links, resolved (§6.1). |
| `backlinks(id, { includeReserved? }): ResolvedLink[]` | The links pointing at a concept, from concepts (and index and log files). |
| `links({ includeReserved? }): ResolvedLink[]` / `brokenLinks({ includeReserved? })` | Every link; the ones whose target is missing or outside the bundle (images left out). |
| `pathFields(id): PathField[]` | `resource`, `sources[].resource`, `computation`, `executor.resource`, `attester.resource`, resolved (§6.2). |
| `resolve(from, url, rootFallback = false): Target` | Resolves any destination written in the file `from`. |
| `tags: Map<string, string[]>` / `types: Map<string, string[]>` | Tag or type to concept IDs, sorted. |
| `byTag(tag)`, `byType(type)`, `conceptsIn(directory)`, `subdirectories(directory)` | Filters. |
| `tree(): DirectoryNode` | `{ name, path, index?, log?, concepts, files, directories }` from the root. |

A `Target` is `{ kind, path?, conceptId?, fragment?, exists, base? }` with `kind` one of `concept`, `index`, `log`,
`directory`, `file`, `external`, `anchor`, `outside`, `descriptor` (a `sources[].resource` scope descriptor, §5.1). A
`ResolvedLink` adds `from`, `fromKind` (`concept`, `index`, `log`), `fromConcept` and the `link` as written (`text`,
`url`, `title`, `line`, `column`, `image`). Links resolve bundle-absolute (`/x.md`) and file-relative paths; path fields
also fall back from a bare relative path to the bundle root (`base: "root"`), the way the spec's examples write them.

## Concept

| Member | Description |
| --- | --- |
| `id`, `path`, `text`, `problems` | The ID, the bundle path, the file as read, and the read problems (missing, unterminated or invalid front matter). |
| `frontMatter` | Every key as plain values, unknown keys included. Live: mutate it, or use `get(key)`, `set(key, value)`, `delete(key)`. |
| `body` | Everything after the front matter, as written (settable). `bodyLine` is its first file line. |
| `type`, `title`, `hasTitle`, `description`, `resource`, `tags` | §4.1. `title` falls back to the file name (`posts_answers` → `Posts answers`). |
| `sources`, `usageWindow`, `source(id)`, `attributions` | §5.1: entries with `author`, `usageCount`, `lastModified`, `usageWindow` (the shared one unless overridden); footnote labels joined to entries. |
| `generated`, `verified`, `lastVerified`, `trustTier`, `lastChanged` | §5.2, §5.3. A bare `verified` mapping is a one-element list. `lastChanged` falls back to the v0.1 `timestamp`. |
| `status`, `isDeprecated`, `staleAfter`, `isStale(now = new Date())` | §5.4, §5.5. |
| `isAttestedComputation`, `runtime`, `parameters`, `computationPath`, `executor`, `attester`, `computation`, `computationBlocks` | §10. `computation` is the `computation` file or the code block under `# Computation`. |
| `headings`, `links`, `legacyCitations`, `blocksUnder(heading)` | The body; `legacyCitations` reads a v0.1 `# Citations` list (§13.1). |
| `extensionKeys` | Keys OKF does not define. |
| `positionOf(path)`, `lineOf(path)` | Where a key or nested value (`["sources", 1, "resource"]`) is in the file. |

Helpers for raw values: `parseTimestamp`, `isTimestamp`, `isIsoDate`, `parseActor` (§7: `human`, `process`, `agent`,
`unknown`), `normalizeVerified`, `trustTierOf`, `titleFromFilename`.

## Checking

| Function | Description |
| --- | --- |
| `checkBundle(bundle, options?: { now?: Date; skipInfo?: boolean }): Diagnostic[]` | All rules, sorted by file, line, column. |
| `checkConcept(concept, options?): Diagnostic[]` | The rules that need no other file. |
| `isConformant(diagnostics): boolean` | No errors. |
| `formatDiagnostics(diagnostics, format: "text" \| "json" = "text"): string` | `file:line:col: severity: message [code]` lines and a summary, or `{ conformant, summary, diagnostics }`. |
| `summarize(diagnostics)`, `sortDiagnostics(diagnostics)`, `RULES` | Counts; the order; every code with its severity, spec section and summary. |

A `Diagnostic` is `{ severity: "error" | "warning" | "info", code, message, file, line?, column?, spec }`. The rules:
[rules.md](rules.md).

## Writing

| Function | Description |
| --- | --- |
| `writeConcept(concept): string` | The file text. Unchanged: the input byte for byte. Changed keys are re-rendered in place (flow style kept), other keys and comments copied, deleted keys dropped, new keys appended. Throws only when front matter that did not parse was changed. |
| `generateIndex(bundle, directory = "", options?): string \| undefined` | A directory's `index.md` (§8): a section per `type` (`Other` for none) and `Subdirectories`, sorted, entries by title with the concept's description. Keeps curated subdirectory descriptions, entries for non-markdown files and the root front matter. `options`: `okfVersion`, `subdirectoriesHeading`, `untypedHeading`. |
| `generateIndexes(bundle, options?): Map<string, string>` | Every directory's, keyed by the index's bundle path. |

## Command line

```text
okf-it check <dir> [--json] [--now <datetime>] [--no-info]     exit 1 when not conformant
okf-it index <dir> [--write | --check] [--json] [--okf-version <v>]
```
