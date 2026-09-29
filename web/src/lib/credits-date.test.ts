import { describe, expect, it } from 'vitest';
import { formatDate } from './format-date';

describe('formatDate', () => {
  it('renders credential expiry values as Unix seconds', () => {
    const formatted = formatDate(1_790_000_000);
    expect(formatted).toMatch(/2026/u);
    expect(formatted).not.toMatch(/1970/u);
  });
});
