import { normalizeBaseUrl } from '../src/config/environment.config';

describe('normalizeBaseUrl', () => {
  it.each([
    ['https://bouncer.example/', 'https://bouncer.example'],
    ['https://bouncer.example//', 'https://bouncer.example'],
    [' https://bouncer.example ', 'https://bouncer.example'],
    ['https://bouncer.example/admin', 'https://bouncer.example'],
    ['http://localhost:4200/', 'http://localhost:4200'],
  ])('reduces %s to its origin', (input, origin) => {
    expect(normalizeBaseUrl(input)).toBe(origin);
  });

  it.each(['bouncer.example', 'ftp://bouncer.example', 'https://user:pass@bouncer.example'])(
    'keeps invalid value %s as given so startup validation can report it', input => {
      expect(normalizeBaseUrl(input)).toBe(input);
    });

  it('treats an empty value as unset', () => {
    expect(normalizeBaseUrl('  ')).toBeUndefined();
    expect(normalizeBaseUrl(undefined)).toBeUndefined();
  });
});
