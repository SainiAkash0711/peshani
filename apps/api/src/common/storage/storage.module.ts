import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { LocalStorageProvider } from './local-storage.provider';
import { STORAGE_PROVIDER } from './storage.tokens';

/**
 * Phase 14 fix: this previously hardcoded `useClass: LocalStorageProvider`
 * regardless of `STORAGE_PROVIDER`, so setting `STORAGE_PROVIDER=s3` in any
 * environment silently still got the local filesystem provider - a real
 * footgun for anyone attempting to configure object storage. Now actually
 * dispatches on the resolved config value, and fails loudly and immediately
 * at startup (not on the first upload request) if a provider is requested
 * that has no real implementation yet - "fail loud" is safer than "silently
 * wrong provider" for something as consequential as where uploaded media
 * physically lives. No S3Provider class exists in this codebase yet (see
 * the Phase 14 report's Media Storage section for the documented
 * persistent-volume-first strategy and the extension point this interface
 * already provides for adding one later).
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const provider = configService.get('storage', { infer: true }).provider;
        if (provider === 'local') {
          return new LocalStorageProvider(configService);
        }
        throw new Error(
          `STORAGE_PROVIDER=${provider} has no implementation yet - only 'local' is currently supported. ` +
            `See StorageProvider (storage-provider.interface.ts) for the extension point a future S3-compatible provider would implement.`,
        );
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
