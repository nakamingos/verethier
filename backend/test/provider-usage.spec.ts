import { Logger } from '@nestjs/common';
import { ProviderUsageLogService } from '@/services/provider-usage-log.service';
import { formatProviderUsage, ordiscanCallKind, recordProviderCall, takeProviderUsage, xverseCallKind } from '@/services/utils/provider-usage.util';

describe('Ordinals provider usage', () => {
  beforeEach(() => takeProviderUsage());
  afterEach(() => jest.restoreAllMocks());

  it('names Xverse and Ordiscan calls without the wallet', () => {
    expect(xverseCallKind('/v1/inscriptions/batch?inscriptionIds=a')).toBe('batch-owners');
    expect(xverseCallKind('/v1/ordinals/collections/abc')).toBe('collection-info');
    expect(xverseCallKind('/v1/ordinals/address/bc1x/inscriptions?limit=25&offset=0')).toBe('wallet-inventory');
    expect(xverseCallKind('/v1/ordinals/address/bc1x/collections?limit=25&offset=0')).toBe('wallet-collections');
    expect(xverseCallKind('/v1/ordinals/address/bc1x/inscriptions/collection/abc?limit=25')).toBe('wallet-collection-items');
    expect(ordiscanCallKind('https://api.ordiscan.com/v1/address/bc1x/inscription-ids')).toBe('wallet-ids');
    expect(ordiscanCallKind('https://api.ordiscan.com/v1/address/bc1x/inscriptions?page=1')).toBe('wallet-inventory');
  });

  it('tallies, formats and clears recorded calls', () => {
    recordProviderCall('xverse', 'wallet-inventory', 'background');
    recordProviderCall('xverse', 'wallet-inventory', 'background');
    recordProviderCall('xverse', 'batch-owners', 'interactive');
    recordProviderCall('ordiscan', 'wallet-ids', 'interactive');
    expect(formatProviderUsage(takeProviderUsage())).toBe(
      'ordiscan 1 (wallet-ids interactive 1); xverse 3 (batch-owners interactive 1, wallet-inventory background 2)');
    expect(takeProviderUsage().size).toBe(0);
  });

  it('logs each hour and a daily total at midnight UTC', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new ProviderUsageLogService();
    recordProviderCall('xverse', 'wallet-inventory', 'interactive');
    service.logHour(new Date('2026-11-18T23:00:00Z'));
    service.logHour(new Date('2026-11-18T23:30:00Z'));
    recordProviderCall('xverse', 'wallet-inventory', 'interactive');
    service.logHour(new Date('2026-11-19T00:00:00Z'));
    expect(log.mock.calls.map(call => call[0])).toEqual([
      'Ordinals API calls, past hour: xverse 1 (wallet-inventory interactive 1)',
      'Ordinals API calls, past hour: xverse 1 (wallet-inventory interactive 1)',
      'Ordinals API calls, past day: xverse 2 (wallet-inventory interactive 2)',
    ]);
    service.logHour(new Date('2026-11-19T01:00:00Z'));
    expect(log).toHaveBeenCalledTimes(3);
  });
});
