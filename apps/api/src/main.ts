import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { StructuredLogger } from './common/logging/structured-logger.service';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { computeConfigValidation } from './config/validate-environment';

/**
 * Fail fast on missing/weak/placeholder required configuration rather than
 * silently defaulting to an empty JWT secret or shipping with a checked-in
 * dev credential (which previously happened - see the old
 * `process.env.JWT_ACCESS_SECRET ?? ''`). The actual rule set lives in
 * `computeConfigValidation()` (a pure function, unit-tested directly) -
 * this is just the side-effecting wrapper that logs/exits based on its
 * result. Never prints an actual secret value - only whether each key is
 * configured, and which ones are missing.
 */
function validateEnvironment(): void {
  const { problems, summary, warnings } = computeConfigValidation(process.env);

  for (const warning of warnings) {
    // eslint-disable-next-line no-console
    console.warn(`WARNING: ${warning}`);
  }

  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`Startup aborted - invalid configuration:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`Configuration validated:\n  - ${summary.join('\n  - ')}`);
}

async function bootstrap() {
  validateEnvironment();

  // rawBody:true additionally exposes req.rawBody (a Buffer) on every
  // request, alongside the normal parsed req.body - needed so the Razorpay
  // webhook handler can verify its signature against the exact bytes
  // Razorpay sent, never a re-serialized JSON object (see PaymentController).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(new StructuredLogger());
  const configService = app.get(ConfigService<AppConfig, true>);
  const isProduction = configService.get('nodeEnv', { infer: true }) === 'production';
  const serverConfig = configService.get('server', { infer: true });

  // Never trust X-Forwarded-* unless explicitly configured (§9) - see
  // configuration.ts's parseTrustProxy() for the accepted value forms.
  // Getting this wrong either makes every rate-limit/audit-log IP wrong
  // (if left false behind a real proxy) or lets a client spoof its own IP
  // via a forged header (if set to `true` with no proxy actually present) -
  // this must match the REAL deployment topology, documented in the
  // production runbook.
  app.set('trust proxy', serverConfig.trustProxy);

  app.use(requestIdMiddleware);

  // Local-storage media is served as plain static files under /media - deliberately
  // outside the /api/v1 prefix (it's object storage, not an API resource) and
  // outside the global validation/exception pipeline (nothing to validate for a
  // static GET). storageProvider.getUrl() is what actually builds these URLs.
  if (configService.get('storage', { infer: true }).provider === 'local') {
    app.useStaticAssets(configService.get('storage', { infer: true }).localRoot, { prefix: '/media' });
  }

  // Swagger UI's own bundled assets need 'unsafe-inline' script/style - this
  // API serves no other HTML page, so scoping the exception to exactly what
  // Swagger needs (rather than disabling CSP outright) keeps every JSON
  // response still covered by a real policy. Swagger itself is gated off
  // entirely in production (see below), so this exception never applies there.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // HSTS is production-only - forcing it in local HTTP development would
      // make the browser refuse to reconnect over plain http://localhost.
      hsts: isProduction ? undefined : false,
    }),
  );
  app.enableCors({
    origin: configService.get('corsOrigins', { infer: true }),
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger's generated OpenAPI JSON and UI are development/staging tooling,
  // not a customer- or admin-facing product surface - never exposed in a
  // production deployment.
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Peshani API')
      .setDescription('Peshani ecommerce platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = configService.get('port', { infer: true });
  await app.listen(port);
  Logger.log(`Peshani API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
  if (!isProduction) {
    Logger.log(`Swagger docs at http://localhost:${port}/api/docs`, 'Bootstrap');
  }

  registerGracefulShutdown(app, serverConfig.shutdownTimeoutMs);
}

/**
 * §13 - explicit SIGTERM/SIGINT handling rather than Nest's bare
 * `enableShutdownHooks()`: `app.close()` already (a) stops the HTTP server
 * accepting new connections and waits for in-flight ones (Node's own
 * `http.Server.close()` semantics), then (b) runs every provider's
 * `onModuleDestroy` in reverse-registration order - which is what actually
 * makes `PrismaService.onModuleDestroy()` (`$disconnect()`) and both
 * worker services' `onModuleDestroy()` (clearing their poll interval, so
 * they stop claiming new outbox/notification rows) run at all; previously
 * nothing ever called `app.close()` in response to a real process signal,
 * so those hooks were unreachable dead code against a bare `docker stop`/
 * Kubernetes termination. The one thing bare `enableShutdownHooks()`
 * doesn't give you is a bounded wait - this adds a configurable hard
 * timeout that force-exits if shutdown hangs (e.g. a request or an
 * in-progress worker batch that never completes) rather than letting an
 * orchestrator's own (usually less graceful) kill signal be the only thing
 * that ever stops it.
 */
function registerGracefulShutdown(app: import('@nestjs/common').INestApplication, shutdownTimeoutMs: number): void {
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    Logger.log(`Received ${signal} - shutting down gracefully (timeout ${shutdownTimeoutMs}ms)`, 'Bootstrap');

    const forceExitTimer = setTimeout(() => {
      Logger.error(`Graceful shutdown did not complete within ${shutdownTimeoutMs}ms - forcing exit`, 'Bootstrap');
      process.exit(1);
    }, shutdownTimeoutMs);

    try {
      await app.close();
      clearTimeout(forceExitTimer);
      Logger.log('Graceful shutdown complete', 'Bootstrap');
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExitTimer);
      Logger.error(`Error during graceful shutdown: ${error instanceof Error ? error.message : String(error)}`, 'Bootstrap');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap();
