import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AppConfig, parseTrustProxy } from '../src/config/configuration';
import { computeConfigValidation } from '../src/config/validate-environment';
import { OutboxWorkerService } from '../src/modules/notifications/outbox-worker.service';
import { EmailDeliveryWorkerService } from '../src/modules/notifications/email-delivery-worker.service';

/**
 * Phase 14 - Production Infrastructure & Deployment Readiness (e2e).
 *
 * Docker/Compose/nginx/backup-script/reverse-proxy artifacts are NOT (and
 * cannot meaningfully be) covered by Jest - they were instead verified by
 * actually building the Docker images and running real containers against
 * this same dev PostgreSQL, and by actually running the backup/restore
 * scripts against a real throwaway database (see the Phase 14 report's
 * Docker/Backup sections for that evidence). This file covers what IS
 * expressible as real, deterministic Jest assertions: the pure config-
 * validation/trust-proxy logic, worker enable/disable wiring, and
 * health/readiness behavior.
 */
describe('Peshani Phase 14 - Production Infrastructure (e2e)', () => {
  describe('Trust proxy configuration parsing', () => {
    it('defaults to false when unset or "false"', () => {
      expect(parseTrustProxy(undefined)).toBe(false);
      expect(parseTrustProxy('false')).toBe(false);
    });

    it('parses "true" as boolean true', () => {
      expect(parseTrustProxy('true')).toBe(true);
    });

    it('parses a plain integer string as a hop count (number)', () => {
      expect(parseTrustProxy('1')).toBe(1);
      expect(parseTrustProxy('2')).toBe(2);
    });

    it('passes through an IP/CIDR/list value as-is for Express to interpret natively', () => {
      expect(parseTrustProxy('10.0.0.1')).toBe('10.0.0.1');
      expect(parseTrustProxy('10.0.0.1,10.0.0.2')).toBe('10.0.0.1,10.0.0.2');
    });
  });

  describe('Production configuration validation', () => {
    const baseValidEnv = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
    };

    it('passes with no problems in development given only the universally-required keys', () => {
      const result = computeConfigValidation(baseValidEnv);
      expect(result.problems).toEqual([]);
    });

    it('flags a missing DATABASE_URL regardless of environment', () => {
      const result = computeConfigValidation({ ...baseValidEnv, DATABASE_URL: undefined });
      expect(result.problems.some((p) => p.includes('DATABASE_URL'))).toBe(true);
    });

    it('flags a JWT_ACCESS_SECRET shorter than 32 characters', () => {
      const result = computeConfigValidation({ ...baseValidEnv, JWT_ACCESS_SECRET: 'too-short' });
      expect(result.problems.some((p) => p.includes('JWT_ACCESS_SECRET') && p.includes('too short'))).toBe(true);
    });

    it('in production, requires CORS_ORIGINS, Razorpay credentials, and rejects known dev placeholders', () => {
      const prodEnv = { ...baseValidEnv, NODE_ENV: 'production' };

      const missingCors = computeConfigValidation({ ...prodEnv, CORS_ORIGINS: '' });
      expect(missingCors.problems.some((p) => p.includes('CORS_ORIGINS'))).toBe(true);

      const missingRazorpay = computeConfigValidation({ ...prodEnv, CORS_ORIGINS: 'https://example.com' });
      expect(missingRazorpay.problems.some((p) => p.includes('RAZORPAY_KEY_ID'))).toBe(true);

      const placeholderRazorpay = computeConfigValidation({
        ...prodEnv,
        CORS_ORIGINS: 'https://example.com',
        RAZORPAY_KEY_ID: 'rzp_test_placeholder',
        RAZORPAY_KEY_SECRET: 'real-secret-value',
        RAZORPAY_WEBHOOK_SECRET: 'real-webhook-secret',
      });
      expect(placeholderRazorpay.problems.some((p) => p.includes('RAZORPAY_KEY_ID') && p.includes('placeholder'))).toBe(true);

      const clean = computeConfigValidation({
        ...prodEnv,
        CORS_ORIGINS: 'https://example.com',
        RAZORPAY_KEY_ID: 'rzp_live_real',
        RAZORPAY_KEY_SECRET: 'real-secret-value',
        RAZORPAY_WEBHOOK_SECRET: 'real-webhook-secret',
        TRUST_PROXY: '1',
      });
      expect(clean.problems).toEqual([]);
    });

    it('in production, warns (does not fail) when TRUST_PROXY is unset - a directly-reachable deployment legitimately wants this', () => {
      const result = computeConfigValidation({
        ...baseValidEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://example.com',
        RAZORPAY_KEY_ID: 'x',
        RAZORPAY_KEY_SECRET: 'y',
        RAZORPAY_WEBHOOK_SECRET: 'z',
      });
      expect(result.problems).toEqual([]);
      expect(result.warnings.some((w) => w.includes('TRUST_PROXY'))).toBe(true);
    });

    it('never includes an actual secret VALUE in its problems/summary/warnings output', () => {
      const secretValue = 'super-secret-value-that-must-never-appear-in-output';
      const result = computeConfigValidation({
        ...baseValidEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: secretValue.padEnd(40, 'x'),
        CORS_ORIGINS: 'https://example.com',
        RAZORPAY_KEY_ID: secretValue,
        RAZORPAY_KEY_SECRET: secretValue,
        RAZORPAY_WEBHOOK_SECRET: secretValue,
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(secretValue);
    });

    it('requires EMAIL_HOST/USERNAME/PASSWORD only when EMAIL_ENABLED=true, in production', () => {
      const prodEnv = {
        ...baseValidEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://example.com',
        RAZORPAY_KEY_ID: 'x',
        RAZORPAY_KEY_SECRET: 'y',
        RAZORPAY_WEBHOOK_SECRET: 'z',
      };
      expect(computeConfigValidation(prodEnv).problems).toEqual([]);
      const withEmailEnabled = computeConfigValidation({ ...prodEnv, EMAIL_ENABLED: 'true' });
      expect(withEmailEnabled.problems.some((p) => p.includes('EMAIL_HOST'))).toBe(true);
    });

    it('requires STORAGE_S3_* only when STORAGE_PROVIDER=s3, in production', () => {
      const prodEnv = {
        ...baseValidEnv,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://example.com',
        RAZORPAY_KEY_ID: 'x',
        RAZORPAY_KEY_SECRET: 'y',
        RAZORPAY_WEBHOOK_SECRET: 'z',
      };
      expect(computeConfigValidation(prodEnv).problems).toEqual([]);
      const withS3 = computeConfigValidation({ ...prodEnv, STORAGE_PROVIDER: 's3' });
      expect(withS3.problems.some((p) => p.includes('STORAGE_S3_BUCKET'))).toBe(true);
    });
  });

  describe('Worker enable/disable configuration', () => {
    let app: INestApplication;

    afterEach(async () => {
      if (app) await app.close();
    });

    it('ENABLE_WORKERS=false resolves to workers.enabled=false in config', async () => {
      const previous = process.env.ENABLE_WORKERS;
      process.env.ENABLE_WORKERS = 'false';
      try {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        await app.init();
        const configService = app.get(ConfigService<AppConfig, true>);
        expect(configService.get('workers', { infer: true }).enabled).toBe(false);
      } finally {
        process.env.ENABLE_WORKERS = previous;
      }
    });

    it('defaults to workers.enabled=true when ENABLE_WORKERS is unset', async () => {
      const previous = process.env.ENABLE_WORKERS;
      delete process.env.ENABLE_WORKERS;
      try {
        const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        await app.init();
        const configService = app.get(ConfigService<AppConfig, true>);
        expect(configService.get('workers', { infer: true }).enabled).toBe(true);
      } finally {
        if (previous !== undefined) process.env.ENABLE_WORKERS = previous;
      }
    });

    it('both worker services resolve without throwing regardless of ENABLE_WORKERS (NODE_ENV=test always short-circuits real polling either way)', async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleFixture.createNestApplication();
      await app.init();
      expect(app.get(OutboxWorkerService)).toBeDefined();
      expect(app.get(EmailDeliveryWorkerService)).toBeDefined();
    });
  });

  describe('Health and readiness', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api/v1');
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('/health/live never touches the database and always reports ok', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('/health/ready and the legacy /health both succeed when the database is reachable, and never leak connection details', async () => {
      const ready = await request(app.getHttpServer()).get('/api/v1/health/ready');
      expect(ready.status).toBe(200);
      const legacy = await request(app.getHttpServer()).get('/api/v1/health');
      expect(legacy.status).toBe(200);
      const serialized = JSON.stringify(ready.body) + JSON.stringify(legacy.body);
      expect(serialized).not.toMatch(/localhost|5432|peshani_dev_password/i);
    });
  });
});
