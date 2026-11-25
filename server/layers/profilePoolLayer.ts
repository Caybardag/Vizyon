import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext } from 'playwright-core';
import type { ProfileWarmupState } from '../../src/types/automation';

const PROFILES_DIR = path.resolve(process.cwd(), 'data', 'profiles');

export interface IsolatedProfileUnit {
  profileKey: string;
  storagePath: string;
  metaPath: string;
  proxyId: string;
  countryCode: string | null;
  fingerprintSeed: string;
  state: ProfileWarmupState;
  quarantinedUntil: string | null;
  lastBlockReason: string | null;
  updatedAt: string;
}

function ensureProfilesDir(): void {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

export function buildProfileKey(proxyId: string, sessionIndex: number): string {
  const rawKey =
    proxyId && proxyId !== 'direct-local'
      ? proxyId
      : `direct-slot-${((sessionIndex - 1) % 8) + 1}`;
  return rawKey.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function getProfilePaths(profileKey: string): { storagePath: string; metaPath: string } {
  return {
    storagePath: path.join(PROFILES_DIR, `${profileKey}.json`),
    metaPath: path.join(PROFILES_DIR, `${profileKey}.meta.json`),
  };
}

export function hasUsableWarmProfile(storagePath: string, metaPath?: string): boolean {
  try {
    if (metaPath && fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Partial<IsolatedProfileUnit>;
      if (meta.quarantinedUntil && new Date(meta.quarantinedUntil).getTime() > Date.now()) {
        return false;
      }
    }
    if (!fs.existsSync(storagePath)) return false;
    const stat = fs.statSync(storagePath);
    if (stat.size < 40) return false;
    if (Date.now() - stat.mtimeMs > 72 * 60 * 60 * 1000) return false;
    const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf8')) as { cookies?: unknown[] };
    return Array.isArray(parsed.cookies) && parsed.cookies.length > 0;
  } catch {
    return false;
  }
}

export function acquireIsolatedProfile(
  proxyId: string,
  sessionIndex: number,
  countryCode: string | null,
  enableWarmup: boolean
): IsolatedProfileUnit {
  ensureProfilesDir();
  const profileKey = buildProfileKey(proxyId, sessionIndex);
  const { storagePath, metaPath } = getProfilePaths(profileKey);

  let existingMeta: Partial<IsolatedProfileUnit> | null = null;
  if (fs.existsSync(metaPath)) {
    try {
      existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Partial<IsolatedProfileUnit>;
    } catch {
      existingMeta = null;
    }
  }

  const isQuarantined = Boolean(
    existingMeta?.quarantinedUntil && new Date(existingMeta.quarantinedUntil).getTime() > Date.now()
  );

  // If previous profile unit was quarantined (403/429/bot-gate), rotate to a fresh fingerprint seed
  const fingerprintSeed =
    !isQuarantined && existingMeta?.fingerprintSeed
      ? existingMeta.fingerprintSeed
      : `${profileKey}-${isQuarantined ? Date.now() : 'v1'}`;

  const usable = enableWarmup && !isQuarantined && hasUsableWarmProfile(storagePath, metaPath);

  return {
    profileKey,
    storagePath,
    metaPath,
    proxyId,
    countryCode,
    fingerprintSeed,
    state: usable ? 'reused-warm' : 'cold',
    quarantinedUntil: isQuarantined ? existingMeta?.quarantinedUntil ?? null : null,
    lastBlockReason: existingMeta?.lastBlockReason ?? null,
    updatedAt: new Date().toISOString(),
  };
}

export async function persistWarmProfile(
  unit: IsolatedProfileUnit,
  context: BrowserContext
): Promise<ProfileWarmupState> {
  try {
    ensureProfilesDir();
    await context.storageState({ path: unit.storagePath });
    const nextState: ProfileWarmupState = unit.state === 'reused-warm' ? 'reused-warm' : 'warmed';
    const nextMeta: IsolatedProfileUnit = {
      ...unit,
      state: nextState,
      quarantinedUntil: null,
      lastBlockReason: null,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(unit.metaPath, JSON.stringify(nextMeta, null, 2), 'utf8');
    return nextState;
  } catch {
    return unit.state;
  }
}

export function quarantineProfile(unit: IsolatedProfileUnit, reason: string, cooldownMs = 30 * 60 * 1000): void {
  try {
    ensureProfilesDir();
    if (fs.existsSync(unit.storagePath)) {
      fs.unlinkSync(unit.storagePath);
    }
    const quarantined: IsolatedProfileUnit = {
      ...unit,
      state: 'quarantined',
      quarantinedUntil: new Date(Date.now() + cooldownMs).toISOString(),
      lastBlockReason: reason.slice(0, 140),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(unit.metaPath, JSON.stringify(quarantined, null, 2), 'utf8');
  } catch {
    // Non-fatal profile quarantine
  }
}

export function getWarmProfilesCount(): number {
  try {
    if (!fs.existsSync(PROFILES_DIR)) return 0;
    return fs
      .readdirSync(PROFILES_DIR)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json')).length;
  } catch {
    return 0;
  }
}
