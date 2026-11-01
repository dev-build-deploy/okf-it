<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->
# OkfIt - Open Knowledge Format library

Read, check and write [Open Knowledge Format][OKF] (OKF) knowledge bundles from TypeScript.

OKF is an open format for knowledge about data and systems: a bundle is a directory of markdown files with YAML front
matter, one file per concept, with standard fields for provenance, trust, lifecycle and attested computations. The
[specification][OKF spec] (v0.2) lives at GoogleCloudPlatform/open-knowledge-format.

## Features

* Implements [OKF v0.2][OKF spec]: concepts, index files, log files, links and path fields, trust tiers, staleness,
  attested computations
* Deterministic: no AI, no network, the same input gives the same output
* Round-trips: an unchanged concept is written back byte for byte; a changed one keeps its key order, comments and
  unknown keys
* Checks conformance (§11) with line and column numbers, as compiler-style text or JSON
* Never rejects what the spec says consumers must accept (unknown types and keys, broken links, missing indexes)

## Installation

```sh
npm install @dev-build-deploy/okf-it
```

## Usage

### Read a bundle

```ts
import { readBundle } from "@dev-build-deploy/okf-it";

const bundle = readBundle("bundles/acme_retail");

for (const concept of bundle.concepts.values()) {
  console.log(concept.id, concept.type, concept.title, concept.trustTier);
}
// computations/gross-margin-period Attested Computation Gross margin for a period human-reviewed
// computations/revenue-ytd Attested Computation Revenue for a fiscal year human-reviewed
// ...
```

`readBundle` reads every non-reserved `.md` file as a concept (its ID is its path without `.md`), every `index.md`
and `log.md` as a reserved file, and lists the other files so links to them resolve. `createBundle` builds the same
`Bundle` from texts in memory, and `parseConcept`, `parseIndex` and `parseLog` read single files.

### Typed fields

```ts
const revenue = bundle.concept("computations/revenue-ytd")!;

revenue.status;             // "stable" (the default when absent, §5.4)
revenue.verified;           // [{ by: "human:jsmith@acme", at: "2026-07-01T09:00:00Z" }] (a bare mapping becomes a list)
revenue.trustTier;          // "human-reviewed" (§5.3)
revenue.isStale(new Date("2027-01-01T00:00:00Z")); // true: now >= stale_after (§5.5)
revenue.sources[0];         // { id: "revenue-policy", resource: "policies/revenue-recognition.md", author: "human:jsmith@acme", lastModified: ... }
revenue.attributions;       // footnotes ([^revenue-policy]) joined to their sources entries (§5.1)
revenue.runtime;            // "bigquery" (§10.2)
revenue.parameters;         // [{ name: "year", type: "integer", required: true, ... }]
revenue.computation;        // { kind: "inline", code: "SELECT ...", language: "sql", line: 34 } (§10.3)
revenue.frontMatter;        // every key as written, unknown keys included
```

Timestamps stay the strings the author wrote; `parseTimestamp` turns one into a `Date` (an ISO 8601 datetime with an
explicit offset, §5).

### Links

```ts
bundle.outgoing("metrics/gross-margin-legacy");
// [{ kind: "concept", conceptId: "metrics/gross-margin", exists: true, link: { text, url: "./gross-margin.md", line, column }, ... }]

bundle.backlinks("metrics/gross-margin");  // the links pointing at it
bundle.brokenLinks();                      // tolerated (§6.1), but worth knowing
bundle.pathFields("computations/revenue-ytd");
// resource, sources[].resource, computation, executor.resource and attester.resource, resolved (§6.2)

bundle.tags;    // Map { "attested" => ["computations/gross-margin-period", "computations/revenue-ytd"], ... }
bundle.tree();  // { path: "", index, log, concepts, files, directories: [...] }
```

Links resolve bundle-absolute (`/tables/orders.md`) and relative (`../tables/orders.md`) paths; code blocks and inline
code are skipped.

### Check a bundle

```ts
import { checkBundle, formatDiagnostics, isConformant } from "@dev-build-deploy/okf-it";

const diagnostics = checkBundle(bundle, { now: new Date() });
console.log(formatDiagnostics(diagnostics));         // or formatDiagnostics(diagnostics, "json")
// log.md:1:1: note: §9 defines no front matter for log files [log-front-matter]
// 0 errors, 0 warnings, 1 note

isConformant(diagnostics); // true when there are no errors
```

Errors are the conformance rules of §11; warnings the soft guidance of §4 to §10; notes the recommendations. The full
list: [docs/rules.md](docs/rules.md).

### Write

```ts
import { parseConcept, writeConcept, generateIndex } from "@dev-build-deploy/okf-it";

const concept = parseConcept(text, "computations/profit");
writeConcept(concept) === text;                     // true: nothing changed, nothing moves

concept.set("verified", [...concept.verified, { by: "human:ahormati", at: "2026-07-02T10:00:00Z" }]);
concept.set("stale_after", "2026-12-31T00:00:00Z");
const updated = writeConcept(concept);              // only those two lines differ

generateIndex(bundle, "metrics");                    // the index.md of a directory (§8), deterministic
```

### Command line

```sh
npx okf-it check bundles/acme_retail            # exit 1 when not conformant; --json, --now, --no-info
npx okf-it index bundles/acme_retail --check    # exit 1 when an index.md is missing or out of date
npx okf-it index bundles/acme_retail --write    # regenerate them
```

The whole API: [docs/api.md](docs/api.md).

## Contributing

If you have suggestions for how `okf-it` could be improved, or want to report a bug, open an issue! We'd love all and
any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

- [MIT](./LICENSES/MIT.txt) © 2026 Kevin de Jong \<monkaii@hotmail.com\>
- The sample bundles and specification examples under `test/fixtures/` come from
  [GoogleCloudPlatform/open-knowledge-format][OKF] under the [Apache-2.0](./LICENSES/Apache-2.0.txt) licence.

[OKF]: https://github.com/GoogleCloudPlatform/open-knowledge-format
[OKF spec]: https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md
