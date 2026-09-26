import { Logger } from '@nestjs/common';
import { getJwtAccessSecret } from './jwt.config';

describe('getJwtAccessSecret', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.JWT_ACCESS_SECRET;
  });

  afterAll(() => {
    process.env = env;
  });

  it('uses JWT_ACCESS_SECRET when it is set', () => {
    process.env.JWT_ACCESS_SECRET = 'from-env';
    expect(getJwtAccessSecret()).toBe('from-env');
  });

  it('falls back to the dev secret and warns when unset', () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    expect(getJwtAccessSecret()).toBe('change-me-access-secret');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
