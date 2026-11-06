// An in-memory D1 for tests, backed by real SQLite (node:sqlite), so the auth
// worker's SQL runs as written rather than against a stub that pattern-matches
// it. Seeded with schema.sql. Only the D1 surface the workers use is here.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { SQLInputValue } from 'node:sqlite';

// Loaded with require, not import: Vite (the agent's vitest) doesn't know the
// prefix-only node:sqlite builtin and fails to resolve the import.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

export function sqliteD1(users: string[] = []) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const id of users) db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(id, id);
  const statement = (sql: string, args: SQLInputValue[] = []) => ({
    bind: (...a: SQLInputValue[]) => statement(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
    exec: () => db.prepare(sql).run(...args),
  });
  return {
    sqlite: db,
    prepare: (sql: string) => statement(sql),
    async batch(statements: ReturnType<typeof statement>[]) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => s.exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
