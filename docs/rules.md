<!--
SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
SPDX-License-Identifier: MIT
-->

# Check rules

`checkBundle` (and `okf-it check`) report these diagnostics. Only errors make a bundle non-conformant
(`isConformant`): they are the three rules of [§11](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md#11-conformance).
Everything §11 says consumers must accept (unknown types or keys, missing optional families, broken links, missing
index files) is never an error.

## Errors: conformance (§11)

| Code | Spec | What it reports |
| --- | --- | --- |
| `front-matter-missing` | §11 | A concept has no front matter block |
| `front-matter-unterminated` | §11 | The front matter has no closing `---` |
| `front-matter-invalid` | §11 | The front matter is not valid YAML |
| `front-matter-not-mapping` | §11 | The front matter is not a mapping |
| `type-missing` | §11 | A concept has no `type` |
| `type-invalid` | §11 | `type` is empty or not a string |
| `index-front-matter` | §8 | A non-root index has front matter |
| `index-front-matter-invalid` | §8 | The root index front matter is invalid |
| `index-entry-outside-section` | §8 | An index entry is not under a heading |
| `index-item-malformed` | §8 | An index list item is not a link entry |
| `log-date-heading` | §9 | A log heading is not a `YYYY-MM-DD` date |
| `log-entry-outside-date` | §9 | A log entry is not under a date heading |

## Warnings: soft guidance

| Code | Spec | What it reports |
| --- | --- | --- |
| `index-extra-front-matter` | §8 | Root index front matter has extra keys |
| `index-entry-separator` | §8 | An entry's description lacks ` - ` |
| `index-empty` | §8 | An index lists nothing |
| `index-empty-section` | §8 | An index section lists nothing |
| `index-entry-broken` | §8 | An index entry points at nothing |
| `okf-version-unknown` | §12 | `okf_version` is not one this library knows |
| `log-order` | §9 | Log dates are not newest first |
| `log-duplicate-date` | §9 | A log date appears twice |
| `log-empty-date` | §9 | A log date has no entries |
| `field-not-string` | §4.1 | A text field is not a string |
| `tags-invalid` | §4.1 | `tags` is not a list of strings |
| `timestamp-invalid` | §5 | A timestamp lacks an explicit UTC offset |
| `sources-invalid` | §5.1 | `sources` or an entry has the wrong shape |
| `source-resource-missing` | §5.1 | A `sources` entry has no `resource` |
| `source-id-duplicate` | §5.1 | Two `sources` entries share an `id` |
| `usage-count-invalid` | §5.1 | `usage_count` is not a count |
| `usage-window-invalid` | §5.1 | `usage_window` is not `{ from, to }` |
| `attribution-unknown` | §5.1 | A footnote names no `sources` id |
| `generated-invalid` | §5.2 | `generated` is not `{ by, at }` |
| `verified-invalid` | §5.2 | A `verified` event is not `{ by, at }` |
| `actor-invalid` | §7 | An actor does not follow the convention |
| `status-unknown` | §5.4 | `status` is not draft, stable or deprecated |
| `runtime-missing` | §10.2 | An Attested Computation has no `runtime` |
| `parameters-invalid` | §10.2 | A parameter is not `{ name, type, required }` |
| `executor-invalid` | §10.2 | `executor` has the wrong shape |
| `attester-invalid` | §10.2 | `attester` has the wrong shape |
| `computation-missing` | §10.3 | No `computation` and no code block |
| `computation-ambiguous` | §10.3 | More than one computation |
| `link-broken` | §6.1 | A link's target is not in the bundle |
| `link-outside` | §6.1 | A link climbs out of the bundle |
| `path-broken` | §6.2 | A path-valued field names a missing file |

## Notes: recommendations and observations

| Code | Spec | What it reports |
| --- | --- | --- |
| `title-missing` | §4.1 | No `title` (derived from the file name) |
| `description-missing` | §4.1 | No `description` |
| `index-entry-no-description` | §8 | An index entry has no description |
| `index-missing-concept` | §8 | A concept is not listed in its index |
| `log-front-matter` | §9 | A log file has front matter |
| `legacy-timestamp` | §13.1 | v0.1 `timestamp` instead of `generated.at` |
| `legacy-citations` | §13.1 | v0.1 `# Citations` instead of `sources` |
| `stale` | §5.5 | The concept is past its `stale_after` |
