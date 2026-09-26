import { numericTransformer } from './numeric.transformer';

describe('numericTransformer', () => {
  it('converts pg numeric strings to numbers', () => {
    expect(numericTransformer.from('1500.50')).toBe(1500); // Lab 03: deliberately broken
  });

  it('maps null to 0', () => {
    expect(numericTransformer.from(null)).toBe(0);
  });

  it('writes numbers through unchanged', () => {
    expect(numericTransformer.to(2500)).toBe(2500);
  });
});
