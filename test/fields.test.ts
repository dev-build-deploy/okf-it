/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import {
  clone,
  deepEqual,
  isIsoDate,
  isTimestamp,
  normalizeSources,
  normalizeTags,
  normalizeVerified,
  parseActor,
  parseTimestamp,
  titleFromFilename,
  trustTierOf,
} from "../src/fields";

describe("timestamps (§5)", () => {
  test.each([
    ["2026-06-30T14:00:00Z", "2026-06-30T14:00:00.000Z"],
    ["2026-07-10T21:15:20+00:00", "2026-07-10T21:15:20.000Z"],
    ["2026-07-10T23:15:20+02:00", "2026-07-10T21:15:20.000Z"],
    ["2026-07-10T21:15:20-0130", "2026-07-10T22:45:20.000Z"],
    ["2026-07-10T21:15Z", "2026-07-10T21:15:00.000Z"],
    ["2026-07-10 21:15:20.5Z", "2026-07-10T21:15:20.500Z"],
  ])("%s is a timestamp", (input, iso) => {
    expect(parseTimestamp(input)?.toISOString()).toBe(iso);
    expect(isTimestamp(input)).toBe(true);
  });

  test.each(["2026-12-31", "2026-06-30T14:00:00", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "yesterday", ""])(
    "%s is not (no explicit offset, or not a date)",
    input => expect(parseTimestamp(input)).toBeUndefined()
  );

  test("non-strings", () => {
    expect(parseTimestamp(20260101)).toBeUndefined();
    expect(parseTimestamp(new Date("2026-01-01T00:00:00Z"))?.getTime()).toBe(Date.UTC(2026, 0, 1));
    expect(parseTimestamp(new Date("nope"))).toBeUndefined();
  });

  test("ISO dates for log headings (§9)", () => {
    expect(isIsoDate("2026-05-22")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-5-22")).toBe(false);
    expect(isIsoDate("May 22")).toBe(false);
  });
});

describe("actors (§7)", () => {
  test("the three conventions", () => {
    expect(parseActor("reference_agent/gemini-2.5-pro")).toEqual({
      raw: "reference_agent/gemini-2.5-pro",
      kind: "agent",
      producer: "reference_agent",
      version: "gemini-2.5-pro",
    });
    expect(parseActor("human:ahormati")).toEqual({ raw: "human:ahormati", kind: "human", id: "ahormati" });
    expect(parseActor("process:finance-nightly")).toEqual({
      raw: "process:finance-nightly",
      kind: "process",
      id: "finance-nightly",
    });
  });

  test("anything else is unknown, with a prefix when it has one", () => {
    expect(parseActor("team:finance-fpa")).toEqual({
      raw: "team:finance-fpa",
      kind: "unknown",
      prefix: "team",
      id: "finance-fpa",
    });
    expect(parseActor("somebody")).toEqual({ raw: "somebody", kind: "unknown" });
    expect(parseActor("a b/c")).toMatchObject({ kind: "unknown" });
  });
});

describe("trust tiers (§5.3)", () => {
  test("derived from verified only", () => {
    expect(trustTierOf([])).toBe("unverified");
    expect(trustTierOf([{ by: "process:nightly", at: "2026-06-26T02:00:00Z" }])).toBe("machine-confirmed");
    expect(trustTierOf([{ by: "agent/v1" }, { by: "human:x" }])).toBe("human-reviewed");
    expect(trustTierOf([{ at: "2026-06-26T02:00:00Z" }])).toBe("machine-confirmed");
  });

  test("a bare mapping is a one-element list (§5.2, §11)", () => {
    expect(normalizeVerified({ by: "human:ahormati", at: "2026-06-25T09:00:00Z" })).toEqual([
      { by: "human:ahormati", at: "2026-06-25T09:00:00Z" },
    ]);
    expect(normalizeVerified(undefined)).toEqual([]);
    expect(normalizeVerified(["not a mapping", { by: "human:a" }])).toEqual([{ by: "human:a", at: undefined }]);
  });
});

describe("sources (§5.1)", () => {
  test("credibility signals and the shared usage window", () => {
    const sources = normalizeSources(
      [
        {
          id: "a",
          resource: "https://x",
          usage_count: 5000,
          last_modified: "2026-05-30T00:00:00Z",
          author: "team:docs",
        },
        { resource: "all queries in project X", usage_window: { from: "2026-01-01T00:00:00Z" } },
        "not a mapping",
      ],
      { from: "2026-06-01T00:00:00Z", to: "2026-06-30T00:00:00Z" }
    );
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      id: "a",
      resource: "https://x",
      author: "team:docs",
      usageCount: 5000,
      lastModified: "2026-05-30T00:00:00Z",
      usageWindow: { from: "2026-06-01T00:00:00Z", to: "2026-06-30T00:00:00Z" },
    });
    expect(sources[1].usageWindow).toEqual({ from: "2026-01-01T00:00:00Z", to: undefined });
    expect(normalizeSources("nope")).toEqual([]);
  });
});

describe("helpers", () => {
  test("tags", () => {
    expect(normalizeTags(["a", 2, "", null])).toEqual(["a", "2"]);
    expect(normalizeTags("solo")).toEqual(["solo"]);
    expect(normalizeTags(undefined)).toEqual([]);
  });

  test("titles from file names (§4.1)", () => {
    expect(titleFromFilename("gross-margin_v2.md")).toBe("Gross margin v2");
    expect(titleFromFilename("events_")).toBe("Events");
    expect(titleFromFilename("blocks___transactions")).toBe("Blocks transactions");
    expect(titleFromFilename("___")).toBe("___");
  });

  test("deep equality and cloning", () => {
    const v = { a: [1, { b: "c" }], d: new Date(0), e: null };
    const c = clone(v);
    expect(c).not.toBe(v);
    expect(deepEqual(v, c)).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1], { 0: 1 })).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(new Date(0), new Date(1))).toBe(false);
  });
});
