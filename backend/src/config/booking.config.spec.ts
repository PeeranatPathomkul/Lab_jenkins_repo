import { getBookingHoldMs, getBookingSweepMs } from './booking.config';

describe('booking.config', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.BOOKING_HOLD_MINUTES;
    delete process.env.BOOKING_SWEEP_SECONDS;
  });

  afterAll(() => {
    process.env = env;
  });

  describe('getBookingHoldMs', () => {
    it('defaults to 3 minutes', () => {
      expect(getBookingHoldMs()).toBe(3 * 60_000);
    });

    it('reads BOOKING_HOLD_MINUTES', () => {
      process.env.BOOKING_HOLD_MINUTES = '10';
      expect(getBookingHoldMs()).toBe(10 * 60_000);
    });

    it.each(['0', '-5', 'abc'])('falls back to 3 minutes for invalid value %p', (value) => {
      process.env.BOOKING_HOLD_MINUTES = value;
      expect(getBookingHoldMs()).toBe(3 * 60_000);
    });
  });

  describe('getBookingSweepMs', () => {
    it('defaults to 30 seconds', () => {
      expect(getBookingSweepMs()).toBe(30_000);
    });

    it('reads BOOKING_SWEEP_SECONDS', () => {
      process.env.BOOKING_SWEEP_SECONDS = '60';
      expect(getBookingSweepMs()).toBe(60_000);
    });

    it('rejects intervals shorter than 5 seconds', () => {
      process.env.BOOKING_SWEEP_SECONDS = '2';
      expect(getBookingSweepMs()).toBe(30_000);
    });
  });
});
