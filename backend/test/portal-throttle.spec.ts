import { clientAddress } from '../src/portal/portal-throttle.guard';

describe('clientAddress', () => {
  const edge = '10.0.0.5';

  it('uses the socket address when no client IP header is configured', () => {
    expect(clientAddress({ ip: edge, headers: { 'x-real-ip': '203.0.113.7' } }, undefined)).toBe(edge);
  });

  it.each(['203.0.113.7', '2001:db8::1'])('uses a single valid IP from the configured header (%s)', ip => {
    expect(clientAddress({ ip: edge, headers: { 'x-real-ip': ` ${ip} ` } }, 'X-Real-IP')).toBe(ip);
  });

  it.each([
    ['missing', undefined],
    ['a list of addresses', '203.0.113.7, 198.51.100.2'],
    ['not an address', 'localhost'],
    ['repeated', ['203.0.113.7', '198.51.100.2']],
  ])('falls back to the socket address when the header is %s', (_case, value) => {
    expect(clientAddress({ ip: edge, headers: { 'x-real-ip': value as any } }, 'x-real-ip')).toBe(edge);
  });

  it('ignores an invalid header name', () => {
    expect(clientAddress({ ip: edge, headers: { 'x real ip': '203.0.113.7' } }, 'x real ip')).toBe(edge);
  });
});
