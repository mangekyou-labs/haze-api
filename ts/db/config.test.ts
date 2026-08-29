import { describe, it, expect } from 'vitest';
import { getDbConfig, DbConfigError, SCHEMAS } from './config.js';

describe('getDbConfig', () => {
  it('fails closed when neither DATABASE_URL nor PG* vars are set', () => {
    expect(() => getDbConfig({})).toThrow(DbConfigError);
  });

  it('parses DATABASE_URL into a connectionString pool config', () => {
    const cfg = getDbConfig({ DATABASE_URL: 'postgres://u:p@localhost:5433/mydb' });
    expect(cfg.poolConfig.connectionString).toBe('postgres://u:p@localhost:5433/mydb');
  });

  it('parses PG* composite vars into a pool config', () => {
    const cfg = getDbConfig({
      PGHOST: 'db.example.com',
      PGPORT: '5433',
      PGUSER: 'alice',
      PGPASSWORD: 'secret',
      PGDATABASE: 'credits',
    });
    expect(cfg.poolConfig.host).toBe('db.example.com');
    expect(cfg.poolConfig.port).toBe(5433);
    expect(cfg.poolConfig.user).toBe('alice');
    expect(cfg.poolConfig.password).toBe('secret');
    expect(cfg.poolConfig.database).toBe('credits');
  });

  it('fails closed on a non-numeric PGPORT', () => {
    expect(() => getDbConfig({ PGPORT: 'abc' })).toThrow(DbConfigError);
  });

  it('exposes the three isolated schemas', () => {
    expect([...SCHEMAS]).toEqual(['gateway', 'billing', 'fee-sponsor']);
  });
});