// A real SQLite database behind the D1 interface, with the project's migrations
// applied, so matching tests run the actual SQL rather than a stand-in.

import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS = new URL("../migrations/", import.meta.url);

export function testDb(options: { seededTradies?: boolean } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  if (options.seededTradies === false) sqlite.exec("DELETE FROM tradies");

  type Stmt = { sql: string; params: unknown[] };
  const statement = (s: Stmt) => ({
    bind: (...params: unknown[]) => statement({ sql: s.sql, params }),
    all: async () => ({ results: sqlite.prepare(s.sql).all(...(s.params as never[])) }),
    first: async () => sqlite.prepare(s.sql).all(...(s.params as never[]))[0] ?? null,
    run: async () => {
      sqlite.prepare(s.sql).run(...(s.params as never[]));
      return { success: true };
    },
    __stmt: s,
  });

  const db = {
    prepare: (sql: string) => statement({ sql, params: [] }),
    batch: async (stmts: { __stmt: Stmt }[]) => {
      sqlite.exec("BEGIN");
      try {
        for (const { __stmt } of stmts) sqlite.prepare(__stmt.sql).run(...(__stmt.params as never[]));
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
      return [];
    },
  };
  return db as unknown as D1Database;
}
