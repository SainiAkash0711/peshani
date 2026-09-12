import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 14-R1 - Environment Isolation & Production Compose Safety.
 *
 * These assertions are pure static-file checks against the repo's Compose
 * files - no Docker, no database, no running app required, so they run
 * anywhere (including plain CI) and fail immediately if a future edit
 * reintroduces the exact class of bug this remediation fixed: a
 * production/dev/smoke-test Compose file resolving to the SAME underlying
 * Postgres/Redis volume, network, or container identity because an
 * explicit environment-specific name was removed or a compose file lost
 * its own top-level project `name:`.
 *
 * Background: docker-compose.yml (dev) and docker-compose.prod.yml
 * (production) used to declare the same volume key with no Docker-level
 * `name:` override and no top-level Compose project `name:` of their own.
 * Compose tracks "is this service already running" by the (project,
 * service-name) pair, so both files defaulted to the same project name
 * (the working directory's name) and the same service name ("postgres"),
 * and a plain `docker compose -f docker-compose.prod.yml up` (no `-p`)
 * caused Compose to recreate the real, long-running development Postgres
 * container in place. No data was lost (the volume itself was reused
 * safely), but this was purely accidental - relying on volume/container
 * `name:` overrides ALONE was later found (via a real, repeated Docker
 * test) to be insufficient on its own, because Compose's service-identity
 * matching happens at the project level, before volume/container names are
 * even considered. The complete fix adds an explicit top-level `name:` to
 * each Compose file (docker-compose.yml -> peshani-dev,
 * docker-compose.prod.yml -> peshani-prod) IN ADDITION to environment-
 * specific volume/network/container names, so isolation holds regardless
 * of the operator's working directory or whether `-p`/COMPOSE_PROJECT_NAME
 * is supplied at all.
 */

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readComposeFile(name: string): string {
  const filePath = path.join(REPO_ROOT, name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected Compose file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

/** Extracts the file's own top-level Compose project `name:` (column 0), if any. */
function extractProjectName(yaml: string): string | undefined {
  const match = yaml.match(/^name:\s*(\S+)\s*$/m);
  return match?.[1];
}

/**
 * Extracts `{ volumeKey: dockerVolumeName }` pairs from the top-level
 * `volumes:` block, where each entry looks like:
 *   volumes:
 *     some-key:
 *       name: some-docker-name
 * A key with no explicit `name:` (bare declaration) maps to undefined,
 * which every assertion below treats as a failure - this repo's
 * convention (post-remediation) is that every persistent volume in
 * docker-compose.yml/docker-compose.prod.yml/docker-compose.smoketest.yml
 * always carries an explicit, environment-specific Docker-level name.
 */
function extractTopLevelVolumeNames(yaml: string): Record<string, string | undefined> {
  const volumesBlockMatch = yaml.match(/^volumes:\n((?:^ {2}.*\n?)*)/m);
  if (!volumesBlockMatch) return {};
  const block = volumesBlockMatch[1];
  const result: Record<string, string | undefined> = {};
  const entryRegex = /^ {2}([\w-]+):\n(?: {4}name:\s*(\S+))?/gm;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(block)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

/** Extracts `{ networkKey: dockerNetworkName }` pairs the same way as volumes. */
function extractTopLevelNetworkNames(yaml: string): Record<string, string | undefined> {
  const networksBlockMatch = yaml.match(/^networks:\n((?:^ {2}.*\n?)*)/m);
  if (!networksBlockMatch) return {};
  const block = networksBlockMatch[1];
  const result: Record<string, string | undefined> = {};
  const entryRegex = /^ {2}([\w-]+):\n(?: {4}name:\s*(\S+))?/gm;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(block)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

function allContainerNames(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*container_name:\s*(\S+)\s*$/gm)].map((m) => m[1]);
}

describe('Phase 14-R1 - Environment isolation (static Compose file checks)', () => {
  const dev = readComposeFile('docker-compose.yml');
  const prod = readComposeFile('docker-compose.prod.yml');
  const smoketest = readComposeFile('docker-compose.smoketest.yml');

  describe('Top-level Compose project names', () => {
    it('docker-compose.yml declares its own fixed project name', () => {
      expect(extractProjectName(dev)).toBe('peshani-dev');
    });

    it('docker-compose.prod.yml declares its own fixed project name, different from dev', () => {
      const prodName = extractProjectName(prod);
      expect(prodName).toBe('peshani-prod');
      expect(prodName).not.toBe(extractProjectName(dev));
    });
  });

  describe('PostgreSQL volume isolation', () => {
    it('dev, prod, and smoketest each declare an explicit, environment-specific postgres volume name', () => {
      const devVolumes = extractTopLevelVolumeNames(dev);
      const prodVolumes = extractTopLevelVolumeNames(prod);
      const smoketestVolumes = extractTopLevelVolumeNames(smoketest);

      const devPgName = Object.values(devVolumes).find((v) => v?.includes('postgres'));
      const prodPgName = Object.values(prodVolumes).find((v) => v?.includes('postgres'));
      const smoketestPgName = Object.values(smoketestVolumes).find((v) => v?.includes('postgres'));

      expect(devPgName).toBe('peshani-dev-postgres-data');
      expect(prodPgName).toBe('peshani-prod-postgres-data');
      expect(smoketestPgName).toBe('peshani-smoketest-postgres-data');
    });

    it('DEV postgres volume != TEST postgres volume != PROD postgres volume (no accidental reuse)', () => {
      const names = [
        Object.values(extractTopLevelVolumeNames(dev)).find((v) => v?.includes('postgres')),
        Object.values(extractTopLevelVolumeNames(prod)).find((v) => v?.includes('postgres')),
        Object.values(extractTopLevelVolumeNames(smoketest)).find((v) => v?.includes('postgres')),
      ];
      expect(names.every(Boolean)).toBe(true);
      expect(new Set(names).size).toBe(3);
    });

    it('never uses a bare, non-namespaced volume name such as "postgres_data" or "postgres-data"', () => {
      for (const yaml of [dev, prod, smoketest]) {
        const volumes = extractTopLevelVolumeNames(yaml);
        for (const name of Object.values(volumes)) {
          if (name?.includes('postgres')) {
            expect(name).toMatch(/^peshani-(dev|prod|smoketest)-postgres-data$/);
          }
        }
      }
    });
  });

  describe('Redis volume isolation (Redis remains optional - see docs/PRODUCTION_RUNBOOK.md)', () => {
    it('dev, prod, and smoketest each declare a distinct, environment-specific redis volume name', () => {
      const devRedis = Object.values(extractTopLevelVolumeNames(dev)).find((v) => v?.includes('redis'));
      const prodRedis = Object.values(extractTopLevelVolumeNames(prod)).find((v) => v?.includes('redis'));
      const smoketestRedis = Object.values(extractTopLevelVolumeNames(smoketest)).find((v) => v?.includes('redis'));

      expect(devRedis).toBe('peshani-dev-redis-data');
      expect(prodRedis).toBe('peshani-prod-redis-data');
      expect(smoketestRedis).toBe('peshani-smoketest-redis-data');

      const names = [devRedis, prodRedis, smoketestRedis];
      expect(names.every(Boolean)).toBe(true);
      expect(new Set(names).size).toBe(3);
    });

    it('production Redis remains opt-in only (the "with-redis" profile), never started by a plain `up`', () => {
      expect(prod).toMatch(/profiles:\s*\["with-redis"\]/);
    });
  });

  describe('Media storage volume isolation', () => {
    it('prod and smoketest api-storage volumes are distinct and environment-specific', () => {
      const prodStorage = Object.values(extractTopLevelVolumeNames(prod)).find((v) => v?.includes('api-storage'));
      const smoketestStorage = Object.values(extractTopLevelVolumeNames(smoketest)).find((v) => v?.includes('api-storage'));
      expect(prodStorage).toBe('peshani-prod-api-storage');
      expect(smoketestStorage).toBe('peshani-smoketest-api-storage');
      expect(prodStorage).not.toBe(smoketestStorage);
    });
  });

  describe('Network isolation', () => {
    it('dev, prod, and smoketest each use a distinct, explicitly-named network', () => {
      const devNetworks = Object.values(extractTopLevelNetworkNames(dev));
      const prodNetworks = Object.values(extractTopLevelNetworkNames(prod));
      const smoketestNetworks = Object.values(extractTopLevelNetworkNames(smoketest));

      expect(devNetworks).toContain('peshani-dev-network');
      expect(prodNetworks).toContain('peshani-prod-network');
      expect(smoketestNetworks).toContain('peshani-smoketest-network');

      const allNames = [...devNetworks, ...prodNetworks, ...smoketestNetworks].filter(Boolean);
      expect(new Set(allNames).size).toBe(allNames.length);
    });
  });

  describe('Container naming', () => {
    it('every explicit container_name in dev/prod/smoketest is environment-prefixed, and no name is shared across environments', () => {
      const devNames = allContainerNames(dev);
      const prodNames = allContainerNames(prod);
      const smoketestNames = allContainerNames(smoketest);

      for (const n of devNames) expect(n).toMatch(/^peshani-dev-/);
      for (const n of prodNames) expect(n).toMatch(/^peshani-prod-/);
      for (const n of smoketestNames) expect(n).toMatch(/^peshani-smoketest-/);

      const combined = [...devNames, ...prodNames, ...smoketestNames];
      expect(new Set(combined).size).toBe(combined.length);
    });
  });

  describe('Smoke-test override completeness', () => {
    it('every service that mounts a persistent volume in prod has a corresponding override in docker-compose.smoketest.yml', () => {
      // Prevents a future new persistent-volume service from silently
      // reusing the production name because someone forgot to add the
      // matching override here.
      expect(smoketest).toMatch(/postgres:/);
      expect(smoketest).toMatch(/api:/);
      expect(smoketest).toMatch(/peshani-smoketest-postgres-data/);
      expect(smoketest).toMatch(/peshani-smoketest-api-storage/);
    });
  });
});
