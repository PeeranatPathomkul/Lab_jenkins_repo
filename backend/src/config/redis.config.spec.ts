import { getRedisConnection } from './redis.config';

describe('getRedisConnection', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.REDIS_URL;
  });

  afterAll(() => {
    process.env = env;
  });

  it('defaults to localhost:6379 without a password', () => {
    expect(getRedisConnection()).toEqual({ host: 'localhost', port: 6379, password: undefined });
  });

  it('parses host, port and password from REDIS_URL', () => {
    process.env.REDIS_URL = 'redis://:s3cret@redis:6380';
    expect(getRedisConnection()).toEqual({ host: 'redis', port: 6380, password: 's3cret' });
  });
});
