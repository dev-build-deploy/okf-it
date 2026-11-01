/*
 * SPDX-FileCopyrightText: 2026 Kevin de Jong <monkaii@hotmail.com>
 * SPDX-License-Identifier: MIT
 */

import * as fs from "fs";
import * as path from "path";

export const FIXTURES = path.join(__dirname, "fixtures");
export const SPEC = path.join(FIXTURES, "spec");
export const BUNDLES = path.join(FIXTURES, "bundles");

/** Reads a fixture file (relative to test/fixtures). */
export function fixture(relative: string): string {
  return fs.readFileSync(path.join(FIXTURES, relative), "utf8");
}

/** Every file under a directory, as sorted relative paths. */
export function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string, rel: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visit(path.join(d, e.name), r);
      else out.push(r);
    }
  };
  visit(dir, "");
  return out.sort();
}
