import { join } from 'path';
import { ALLOWED_SLIP_MIME, getPaymentConfig } from './payment.config';

describe('getPaymentConfig', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    for (const key of [
      'UPLOAD_DIR',
      'PAYMENT_ACCOUNT_NAME',
      'PAYMENT_PROMPTPAY_ID',
      'PAYMENT_NOTE',
      'PAYMENT_MAX_SLIP_BYTES',
    ]) {
      delete process.env[key];
    }
  });

  afterAll(() => {
    process.env = env;
  });

  it('has safe defaults', () => {
    const cfg = getPaymentConfig();
    expect(cfg.accountName).toBe('Poonsuk Resort');
    expect(cfg.promptPayId).toBe('000-000-0000');
    expect(cfg.uploadDir).toBe(join(process.cwd(), 'uploads'));
    expect(cfg.slipDir).toBe(join(process.cwd(), 'uploads', 'slips'));
    expect(cfg.maxSlipBytes).toBe(5 * 1024 * 1024);
  });

  it('reads overrides from the environment', () => {
    process.env.PAYMENT_ACCOUNT_NAME = 'Test Resort';
    process.env.PAYMENT_PROMPTPAY_ID = '0812345678';
    process.env.PAYMENT_NOTE = 'note';
    process.env.PAYMENT_MAX_SLIP_BYTES = '1024';
    const cfg = getPaymentConfig();
    expect(cfg).toMatchObject({
      accountName: 'Test Resort',
      promptPayId: '0812345678',
      note: 'note',
      maxSlipBytes: 1024,
    });
  });

  it('keeps an absolute UPLOAD_DIR as-is', () => {
    const abs = join(process.cwd(), 'tmp-uploads');
    process.env.UPLOAD_DIR = abs;
    expect(getPaymentConfig().uploadDir).toBe(abs);
  });

  it('only allows image slip uploads', () => {
    expect(ALLOWED_SLIP_MIME['image/png']).toBe('png');
    expect(ALLOWED_SLIP_MIME['application/pdf']).toBeUndefined();
  });
});
