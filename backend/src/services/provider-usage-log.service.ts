import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { formatProviderUsage, takeProviderUsage } from './utils/provider-usage.util';

/** Logs billed Ordinals API calls each hour and a UTC daily total. */
@Injectable()
export class ProviderUsageLogService {
  private readonly logger = new Logger('ProviderUsage');
  private daily = new Map<string, number>();

  @Cron('0 * * * *', { timeZone: 'UTC' })
  logHour(now = new Date()): void {
    const hour = takeProviderUsage();
    for (const [key, count] of hour) this.daily.set(key, (this.daily.get(key) || 0) + count);
    if (hour.size) this.logger.log(`Ordinals API calls, past hour: ${formatProviderUsage(hour)}`);
    if (now.getUTCHours() !== 0) return;
    if (this.daily.size) this.logger.log(`Ordinals API calls, past day: ${formatProviderUsage(this.daily)}`);
    this.daily = new Map();
  }
}
