import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { buildDataSourceOptions } from './data-source';

describe('buildDataSourceOptions', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterAll(() => {
    process.env = env;
  });

  it('reads the connection from DB_* variables', () => {
    process.env.DB_HOST = 'postgres';
    process.env.DB_PORT = '5433';
    process.env.DB_NAME = 'poonsuk_test';
    const opts = buildDataSourceOptions() as PostgresConnectionOptions;
    expect(opts).toMatchObject({ type: 'postgres', host: 'postgres', port: 5433, database: 'poonsuk_test' });
  });

  it('never lets TypeORM synchronize the schema', () => {
    expect(buildDataSourceOptions().synchronize).toBe(false);
  });

  it('logs only errors in production', () => {
    process.env.NODE_ENV = 'production';
    expect(buildDataSourceOptions().logging).toEqual(['error']);
  });
});
