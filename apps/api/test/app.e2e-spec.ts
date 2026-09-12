import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Peshani API (e2e)', () => {
  let app: INestApplication;
  const uniqueEmail = `customer.${Date.now()}@example.com`;
  const password = 'SuperSecret123!';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/v1/store-settings is public and returns Peshani branding', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/store-settings');
    expect(res.status).toBe(200);
    expect(res.body.storeName).toBe('Peshani');
  });

  it('GET /api/v1/auth/me without a token is rejected', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('registers a new customer', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail, password, firstName: 'Test', lastName: 'Customer' });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe(uniqueEmail);
  });

  it('rejects duplicate registration', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail, password, firstName: 'Test', lastName: 'Customer' });
    expect(res.status).toBe(409);
  });

  it('rejects login with wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail, password: 'WrongPassword123!' });
    expect(res.status).toBe(401);
  });

  it('logs in and receives an access/refresh token pair, then accesses /auth/me', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail, password });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.accessToken).toBeDefined();
    expect(loginRes.body.refreshToken).toBeDefined();

    const meRes = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe(uniqueEmail);
    expect(meRes.body.roles).toContain('CUSTOMER');
  });

  it('a plain customer cannot access an admin-only, permission-gated route', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail, password });

    const res = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('rotates the refresh token and rejects reuse of the old one', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail, password });
    const oldRefreshToken = loginRes.body.refreshToken;

    const refreshRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeDefined();

    const reuseRes = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefreshToken });
    expect(reuseRes.status).toBe(401);
  });

  it('logs in as the seeded super admin and can access a permission-gated route', async () => {
    const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@peshani.example';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: adminPassword });
    expect(loginRes.status).toBe(200);

    const usersRes = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);
    expect(usersRes.status).toBe(200);
    expect(Array.isArray(usersRes.body.items)).toBe(true);
  });
});
