export type OsFamily = 'windows' | 'macos' | 'linux';

export interface CoherentDeviceProfile {
  profileTemplateId: string;
  osFamily: OsFamily;
  weight: number;
  userAgent: string;
  chromeMajor: string;
  platform: string;
  uaPlatform: string;
  uaPlatformVersion: string;
  architecture: string;
  bitness: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number; availHeight: number; colorDepth: number; pixelRatio: number };
  hardwareConcurrency: number;
  deviceMemory: number;
  webglVendor: string;
  webglRenderer: string;
  tlsProfile: string;
}

export interface ProxyGeoContext {
  countryCode?: string | null;
  timezone?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface CoherentSessionFingerprint extends CoherentDeviceProfile {
  countryCode: string;
  locale: string;
  languages: string[];
  timezoneId: string;
  acceptLanguage: string;
  geolocation: { latitude: number; longitude: number; accuracy: number };
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  consistencyScore: number;
}

export interface ConsistencyAuditResult {
  score: number;
  passed: boolean;
  warnings: string[];
}

interface CountryGeoDefaults {
  locale: string;
  languages: string[];
  timezoneId: string;
  acceptLanguage: string;
  lat: number;
  lon: number;
}

const COUNTRY_GEO_DEFAULTS: Record<string, CountryGeoDefaults> = {
  TR: {
    locale: 'tr-TR',
    languages: ['tr-TR', 'tr', 'en-US', 'en'],
    timezoneId: 'Europe/Istanbul',
    acceptLanguage: 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    lat: 41.0082,
    lon: 28.9784,
  },
  US: {
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezoneId: 'America/New_York',
    acceptLanguage: 'en-US,en;q=0.9',
    lat: 40.7128,
    lon: -74.006,
  },
  GB: {
    locale: 'en-GB',
    languages: ['en-GB', 'en'],
    timezoneId: 'Europe/London',
    acceptLanguage: 'en-GB,en;q=0.9',
    lat: 51.5072,
    lon: -0.1276,
  },
  CA: {
    locale: 'en-CA',
    languages: ['en-CA', 'en', 'fr-CA'],
    timezoneId: 'America/Toronto',
    acceptLanguage: 'en-CA,en;q=0.9,fr-CA;q=0.8',
    lat: 43.6532,
    lon: -79.3832,
  },
  DE: {
    locale: 'de-DE',
    languages: ['de-DE', 'de', 'en'],
    timezoneId: 'Europe/Berlin',
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8',
    lat: 52.52,
    lon: 13.405,
  },
  FR: {
    locale: 'fr-FR',
    languages: ['fr-FR', 'fr', 'en'],
    timezoneId: 'Europe/Paris',
    acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
    lat: 48.8566,
    lon: 2.3522,
  },
  NL: {
    locale: 'nl-NL',
    languages: ['nl-NL', 'nl', 'en'],
    timezoneId: 'Europe/Amsterdam',
    acceptLanguage: 'nl-NL,nl;q=0.9,en;q=0.8',
    lat: 52.3676,
    lon: 4.9041,
  },
  ES: {
    locale: 'es-ES',
    languages: ['es-ES', 'es', 'en'],
    timezoneId: 'Europe/Madrid',
    acceptLanguage: 'es-ES,es;q=0.9,en;q=0.8',
    lat: 40.4168,
    lon: -3.7038,
  },
  MX: {
    locale: 'es-MX',
    languages: ['es-MX', 'es', 'en'],
    timezoneId: 'America/Mexico_City',
    acceptLanguage: 'es-MX,es;q=0.9,en;q=0.8',
    lat: 19.4326,
    lon: -99.1332,
  },
  BR: {
    locale: 'pt-BR',
    languages: ['pt-BR', 'pt', 'en'],
    timezoneId: 'America/Sao_Paulo',
    acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.8',
    lat: -23.5505,
    lon: -46.6333,
  },
  IT: {
    locale: 'it-IT',
    languages: ['it-IT', 'it', 'en'],
    timezoneId: 'Europe/Rome',
    acceptLanguage: 'it-IT,it;q=0.9,en;q=0.8',
    lat: 41.9028,
    lon: 12.4964,
  },
  PL: {
    locale: 'pl-PL',
    languages: ['pl-PL', 'pl', 'en'],
    timezoneId: 'Europe/Warsaw',
    acceptLanguage: 'pl-PL,pl;q=0.9,en;q=0.8',
    lat: 52.2297,
    lon: 21.0122,
  },
  RO: {
    locale: 'ro-RO',
    languages: ['ro-RO', 'ro', 'en'],
    timezoneId: 'Europe/Bucharest',
    acceptLanguage: 'ro-RO,ro;q=0.9,en;q=0.8',
    lat: 44.4268,
    lon: 26.1025,
  },
  RU: {
    locale: 'ru-RU',
    languages: ['ru-RU', 'ru', 'en'],
    timezoneId: 'Europe/Moscow',
    acceptLanguage: 'ru-RU,ru;q=0.9,en;q=0.8',
    lat: 55.7558,
    lon: 37.6173,
  },
  UA: {
    locale: 'uk-UA',
    languages: ['uk-UA', 'uk', 'en'],
    timezoneId: 'Europe/Kyiv',
    acceptLanguage: 'uk-UA,uk;q=0.9,en;q=0.8',
    lat: 50.4501,
    lon: 30.5234,
  },
  ID: {
    locale: 'id-ID',
    languages: ['id-ID', 'id', 'en'],
    timezoneId: 'Asia/Jakarta',
    acceptLanguage: 'id-ID,id;q=0.9,en;q=0.8',
    lat: -6.2088,
    lon: 106.8456,
  },
  IN: {
    locale: 'en-IN',
    languages: ['en-IN', 'en', 'hi'],
    timezoneId: 'Asia/Kolkata',
    acceptLanguage: 'en-IN,en;q=0.9,hi;q=0.8',
    lat: 19.076,
    lon: 72.8777,
  },
  JP: {
    locale: 'ja-JP',
    languages: ['ja-JP', 'ja', 'en'],
    timezoneId: 'Asia/Tokyo',
    acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8',
    lat: 35.6762,
    lon: 139.6503,
  },
  KR: {
    locale: 'ko-KR',
    languages: ['ko-KR', 'ko', 'en'],
    timezoneId: 'Asia/Seoul',
    acceptLanguage: 'ko-KR,ko;q=0.9,en;q=0.8',
    lat: 37.5665,
    lon: 126.978,
  },
  SG: {
    locale: 'en-SG',
    languages: ['en-SG', 'en'],
    timezoneId: 'Asia/Singapore',
    acceptLanguage: 'en-SG,en;q=0.9',
    lat: 1.3521,
    lon: 103.8198,
  },
  MY: {
    locale: 'ms-MY',
    languages: ['ms-MY', 'ms', 'en'],
    timezoneId: 'Asia/Kuala_Lumpur',
    acceptLanguage: 'ms-MY,ms;q=0.9,en;q=0.8',
    lat: 3.139,
    lon: 101.6869,
  },
  VN: {
    locale: 'vi-VN',
    languages: ['vi-VN', 'vi', 'en'],
    timezoneId: 'Asia/Ho_Chi_Minh',
    acceptLanguage: 'vi-VN,vi;q=0.9,en;q=0.8',
    lat: 10.8231,
    lon: 106.6297,
  },
  TH: {
    locale: 'th-TH',
    languages: ['th-TH', 'th', 'en'],
    timezoneId: 'Asia/Bangkok',
    acceptLanguage: 'th-TH,th;q=0.9,en;q=0.8',
    lat: 13.7563,
    lon: 100.5018,
  },
  HK: {
    locale: 'zh-HK',
    languages: ['zh-HK', 'zh', 'en'],
    timezoneId: 'Asia/Hong_Kong',
    acceptLanguage: 'zh-HK,zh;q=0.9,en;q=0.8',
    lat: 22.3193,
    lon: 114.1694,
  },
  AU: {
    locale: 'en-AU',
    languages: ['en-AU', 'en'],
    timezoneId: 'Australia/Sydney',
    acceptLanguage: 'en-AU,en;q=0.9',
    lat: -33.8688,
    lon: 151.2093,
  },
};

/**
 * Weighted real-world desktop device catalog (OS + UA + Platform + Client Hints + WebGL + Hardware + Screen)
 * so no session ever mixes contradictory cross-OS signals (e.g. Windows UA with Linux Mesa WebGL).
 */
export const COHERENT_DEVICE_PROFILES: CoherentDeviceProfile[] = [
  {
    profileTemplateId: 'win11-rtx3060-1080p',
    osFamily: 'windows',
    weight: 28,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    chromeMajor: '131',
    platform: 'Win32',
    uaPlatform: 'Windows',
    uaPlatformVersion: '15.0.0',
    architecture: 'x86',
    bitness: '64',
    viewport: { width: 1536, height: 864 },
    screen: { width: 1920, height: 1080, availHeight: 1032, colorDepth: 24, pixelRatio: 1.25 },
    hardwareConcurrency: 12,
    deviceMemory: 8,
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    tlsProfile: 'chrome131-win-boringssl',
  },
  {
    profileTemplateId: 'win10-uhd630-1366',
    osFamily: 'windows',
    weight: 24,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    chromeMajor: '130',
    platform: 'Win32',
    uaPlatform: 'Windows',
    uaPlatformVersion: '10.0.0',
    architecture: 'x86',
    bitness: '64',
    viewport: { width: 1366, height: 696 },
    screen: { width: 1366, height: 768, availHeight: 728, colorDepth: 24, pixelRatio: 1 },
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    tlsProfile: 'chrome130-win-boringssl',
  },
  {
    profileTemplateId: 'win11-radeon-1440p',
    osFamily: 'windows',
    weight: 18,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    chromeMajor: '131',
    platform: 'Win32',
    uaPlatform: 'Windows',
    uaPlatformVersion: '15.0.0',
    architecture: 'x86',
    bitness: '64',
    viewport: { width: 1600, height: 900 },
    screen: { width: 2560, height: 1440, availHeight: 1392, colorDepth: 24, pixelRatio: 1.5 },
    hardwareConcurrency: 16,
    deviceMemory: 8,
    webglVendor: 'Google Inc. (AMD)',
    webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    tlsProfile: 'chrome131-win-boringssl',
  },
  {
    profileTemplateId: 'mac-apple-m2-1440',
    osFamily: 'macos',
    weight: 14,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    chromeMajor: '131',
    platform: 'MacIntel',
    uaPlatform: 'macOS',
    uaPlatformVersion: '14.6.1',
    architecture: 'arm',
    bitness: '64',
    viewport: { width: 1440, height: 820 },
    screen: { width: 1440, height: 900, availHeight: 875, colorDepth: 30, pixelRatio: 2 },
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    tlsProfile: 'chrome131-mac-boringssl',
  },
  {
    profileTemplateId: 'mac-apple-m1-1280',
    osFamily: 'macos',
    weight: 10,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    chromeMajor: '130',
    platform: 'MacIntel',
    uaPlatform: 'macOS',
    uaPlatformVersion: '13.6.7',
    architecture: 'arm',
    bitness: '64',
    viewport: { width: 1280, height: 736 },
    screen: { width: 1280, height: 800, availHeight: 775, colorDepth: 30, pixelRatio: 2 },
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: 'Google Inc. (Apple)',
    webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
    tlsProfile: 'chrome130-mac-boringssl',
  },
  {
    profileTemplateId: 'linux-mesa-iris-1080p',
    osFamily: 'linux',
    weight: 6,
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    chromeMajor: '131',
    platform: 'Linux x86_64',
    uaPlatform: 'Linux',
    uaPlatformVersion: '6.8.0',
    architecture: 'x86',
    bitness: '64',
    viewport: { width: 1280, height: 740 },
    screen: { width: 1920, height: 1080, availHeight: 1053, colorDepth: 24, pixelRatio: 1 },
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2), OpenGL 4.6)',
    tlsProfile: 'chrome131-linux-boringssl',
  },
];

function deterministicHashInt(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function selectWeightedDeviceProfile(seedKey: string | number): CoherentDeviceProfile {
  const totalWeight = COHERENT_DEVICE_PROFILES.reduce((sum, p) => sum + p.weight, 0);
  const hash =
    typeof seedKey === 'number'
      ? deterministicHashInt(`slot-${seedKey}`)
      : deterministicHashInt(seedKey);
  let target = hash % totalWeight;
  for (const profile of COHERENT_DEVICE_PROFILES) {
    if (target < profile.weight) {
      return profile;
    }
    target -= profile.weight;
  }
  return COHERENT_DEVICE_PROFILES[0];
}

export function buildCoherentFingerprint(
  seedKey: string | number,
  geoContext?: ProxyGeoContext
): CoherentSessionFingerprint {
  const device = selectWeightedDeviceProfile(seedKey);
  const cc = (geoContext?.countryCode || 'US').trim().toUpperCase();
  const geo = COUNTRY_GEO_DEFAULTS[cc] ?? COUNTRY_GEO_DEFAULTS.US;

  const baseLat = typeof geoContext?.lat === 'number' && Number.isFinite(geoContext.lat)
    ? geoContext.lat
    : geo.lat;
  const baseLon = typeof geoContext?.lon === 'number' && Number.isFinite(geoContext.lon)
    ? geoContext.lon
    : geo.lon;

  // Deterministic micro-offset (+/- 0.045 deg) so sessions from same city do not share exact GPS coordinates
  const h = deterministicHashInt(`geo-${seedKey}-${cc}`);
  const latOffset = (((h % 900) / 900) - 0.5) * 0.09;
  const lonOffset = ((((h >>> 10) % 900) / 900) - 0.5) * 0.09;

  const timezoneId =
    geoContext?.timezone && geoContext.timezone.includes('/')
      ? geoContext.timezone
      : geo.timezoneId;

  const secChUa = `"Google Chrome";v="${device.chromeMajor}", "Chromium";v="${device.chromeMajor}", "Not_A Brand";v="24"`;
  const secChUaPlatform = `"${device.uaPlatform}"`;

  const fp: CoherentSessionFingerprint = {
    ...device,
    countryCode: cc,
    locale: geo.locale,
    languages: geo.languages,
    timezoneId,
    acceptLanguage: geo.acceptLanguage,
    geolocation: {
      latitude: Number((baseLat + latOffset).toFixed(5)),
      longitude: Number((baseLon + lonOffset).toFixed(5)),
      accuracy: 35 + (h % 45),
    },
    secChUa,
    secChUaMobile: '?0',
    secChUaPlatform,
    consistencyScore: 100,
  };

  fp.consistencyScore = auditFingerprintConsistency(fp).score;
  return fp;
}

export function auditFingerprintConsistency(
  fp: Pick<
    CoherentSessionFingerprint,
    | 'osFamily'
    | 'userAgent'
    | 'platform'
    | 'uaPlatform'
    | 'webglRenderer'
    | 'locale'
    | 'timezoneId'
    | 'acceptLanguage'
    | 'viewport'
    | 'screen'
  >
): ConsistencyAuditResult {
  const warnings: string[] = [];
  let score = 100;

  const uaLower = fp.userAgent.toLowerCase();
  const webglLower = fp.webglRenderer.toLowerCase();
  const platformLower = fp.platform.toLowerCase();

  if (fp.osFamily === 'windows') {
    if (!uaLower.includes('windows nt')) {
      warnings.push('Windows profilinde Windows UA eksik');
      score -= 30;
    }
    if (!platformLower.includes('win')) {
      warnings.push('Windows profilinde navigator.platform uyumsuz');
      score -= 25;
    }
    if (webglLower.includes('mesa') || webglLower.includes('apple metal')) {
      warnings.push('Windows UA ile Linux/Apple WebGL imzası çelişiyor');
      score -= 35;
    }
  } else if (fp.osFamily === 'macos') {
    if (!uaLower.includes('macintosh')) {
      warnings.push('macOS profilinde Macintosh UA eksik');
      score -= 30;
    }
    if (!platformLower.includes('mac')) {
      warnings.push('macOS profilinde navigator.platform uyumsuz');
      score -= 25;
    }
    if (webglLower.includes('direct3d') || webglLower.includes('mesa')) {
      warnings.push('macOS UA ile Windows/Linux WebGL imzası çelişiyor');
      score -= 35;
    }
  } else if (fp.osFamily === 'linux') {
    if (!uaLower.includes('linux')) {
      warnings.push('Linux profilinde Linux UA eksik');
      score -= 30;
    }
    if (!platformLower.includes('linux')) {
      warnings.push('Linux profilinde navigator.platform uyumsuz');
      score -= 25;
    }
    if (webglLower.includes('direct3d') || webglLower.includes('apple metal')) {
      warnings.push('Linux UA ile Windows/Apple WebGL imzası çelişiyor');
      score -= 35;
    }
  }

  const localePrefix = fp.locale.split('-')[0].toLowerCase();
  if (!fp.acceptLanguage.toLowerCase().startsWith(localePrefix)) {
    warnings.push('Accept-Language başlığı tarayıcı locale ayarıyla uyuşmuyor');
    score -= 15;
  }

  if (!fp.timezoneId.includes('/')) {
    warnings.push('Geçersiz IANA saat dilimi');
    score -= 10;
  }

  if (fp.viewport.width > fp.screen.width || fp.viewport.height > fp.screen.height) {
    warnings.push('Viewport boyutu fiziksel ekran çözünürlüğünden büyük');
    score -= 15;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    passed: warnings.length === 0,
    warnings,
  };
}
