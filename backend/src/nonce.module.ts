import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { NonceService } from './services/nonce.service';
import { boundedCacheOptions } from './utils/bounded-cache.util';

/** Verification links must not compete with autocomplete entries for cache space. */
@Module({
  imports: [CacheModule.register(boundedCacheOptions(10000))],
  providers: [NonceService],
  exports: [NonceService],
})
export class NonceModule {}
