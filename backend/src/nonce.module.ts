import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { NonceService } from './services/nonce.service';

/** Verification links must not compete with autocomplete entries for cache space. */
@Module({
  imports: [CacheModule.register({ max: 10000 })],
  providers: [NonceService],
  exports: [NonceService],
})
export class NonceModule {}
