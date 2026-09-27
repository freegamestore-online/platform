import { describe, expect, it } from 'vitest';
import {
  ERROR_LOG_LIMITS,
  ERROR_LOG_SCHEMA,
  recordError,
} from '../../../contracts/error-log/v1/contract';

describe('error-log v1 persistence contract', () => {
  it('uses the canonical schema and clamps every persisted row field', async () => {
    const calls: Array<{ sql: string; binds: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        let binds: unknown[] = [];
        const statement = {
          bind(...values: unknown[]) {
            binds = values;
            return statement;
          },
          async run() {
            calls.push({ sql, binds });
            return {};
          },
        };
        return statement;
      },
    };

    await recordError(db, {
      source: 's'.repeat(ERROR_LOG_LIMITS.source + 1),
      user: 'u'.repeat(ERROR_LOG_LIMITS.user + 1),
      context: 'c'.repeat(ERROR_LOG_LIMITS.context + 1),
      message: 'm'.repeat(ERROR_LOG_LIMITS.message + 1),
      stack: 'k'.repeat(ERROR_LOG_LIMITS.stack + 1),
    });

    expect(calls[0]?.sql).toBe(ERROR_LOG_SCHEMA);
    expect(calls[1]?.binds.map((value) => String(value).length)).toEqual([
      ERROR_LOG_LIMITS.source,
      ERROR_LOG_LIMITS.user,
      ERROR_LOG_LIMITS.context,
      ERROR_LOG_LIMITS.message,
      ERROR_LOG_LIMITS.stack,
    ]);
  });
});
