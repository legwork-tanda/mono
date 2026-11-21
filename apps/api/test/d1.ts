// A D1 database for tests, backed by Node's built-in SQLite and set up with
// the real migrations, so routes can be exercised end to end.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const MIGRATIONS = join(import.meta.dirname, "../migrations");

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : (p as SQLInputValue))));
  }

  async first<T>() {
    return ((this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null) as T | null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true, meta: {} };
  }

  async run() {
    return this.runSync();
  }

  runSync() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { results: [], success: true, meta: { changes: Number(result.changes) } };
  }
}

/**
 * A fresh in-memory database with every migration applied. Pass
 * `seededTradies: false` to start with no tradies (the migrations seed some).
 */
export function testDb(options: { seededTradies?: boolean } = {}) {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  if (options.seededTradies === false) db.exec("DELETE FROM tradies");
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    // Runs without yielding, like D1, where one batch never interleaves with another.
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(s.runSync());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { d1: d1 as unknown as D1Database, sqlite: db };
}
