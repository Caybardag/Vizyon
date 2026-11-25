import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import * as cheerio from 'cheerio';
import type {
  CandidateDecision,
  PlaybackStatus,
  ProfileDiscoveryHit,
  ProfileWarmupState,
  ProxyEndpoint,
  RunConfig,
  SessionExecution,
} from '../src/types/automation';
import {
  buildSearchQueriesForTarget,
  clampMinWatchSeconds,
  computeDHashHammingDistance,
  computeHumanizedWatchTarget,
  computePlaybackAdvance,
  detectTrafficGateFromPage,
  extractYouTubeCandidatesFromJson,
  extractYouTubeSearchContext,
  extractYouTubeVideoId,
  findContinuationTokenInJson,
  hammingToSimilarityPercent,
  isExactTargetMatch,
  isYouTubeWatchTelemetryUrl,
  pickGeoMatchedFingerprint,
  safeJsonParse,
  scoreProfileMatch,
  type ParsedSearchCandidate,
  type TargetMetadataHint,
} from '../src/lib/targetMatcher';
import { createProxyAgent, httpsGetWithAgent, httpsPostJsonWithAgent } from './proxyPool';

const PROOFS_DIR = path.resolve(process.cwd(), 'data', 'proofs');
const PROFILES_DIR = path.resolve(process.cwd(), 'data', 'profiles');

function ensureProofsDir(): void {
  if (!fs.existsSync(PROOFS_DIR)) {
    fs.mkdirSync(PROOFS_DIR, { recursive: true });
  }
}

function ensureProfilesDir(): void {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function getProfileStoragePath(proxyId: string, sessionIndex: number): string {
  const rawKey = proxyId && proxyId !== 'direct-local' ? proxyId : `direct-slot-${((sessionIndex - 1) % 8) + 1}`;
  const safeKey = rawKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(PROFILES_DIR, `${safeKey}.json`);
}

function hasUsableWarmProfile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size < 40) return false;
    // Profiles older than 72 hours are refreshed automatically
    if (Date.now() - stat.mtimeMs > 72 * 60 * 60 * 1000) return false;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { cookies?: unknown[] };
    return Array.isArray(parsed.cookies) && parsed.cookies.length > 0;
  } catch {
    return false;
  }
}

export function getWarmProfilesCount(): number {
  try {
    if (!fs.existsSync(PROFILES_DIR)) return 0;
    return fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

const SESSION_FINGERPRINTS = [
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    viewport: { width: 1536, height: 864 },
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  },
  {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },
  {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 900 },
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
  },
];

export function pickFingerprint(index: number, countryCode?: string | null) {
  return pickGeoMatchedFingerprint(countryCode, index);
}

export async function fetchTargetMetadata(targetUrl: string): Promise<TargetMetadataHint> {
  const clean = targetUrl.trim();
  if (!clean) return {};
  const ytId = extractYouTubeVideoId(clean);

  if (ytId) {
    try {
      const canonical = `https://www.youtube.com/watch?v=${ytId}`;
      const res = await httpsGetWithAgent(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`,
        undefined,
        4500
      );
      if (res.status === 200) {
        const parsed = safeJsonParse<{ title?: string; author_name?: string }>(res.body);
        return {
          title: parsed.title?.trim() || null,
          author: parsed.author_name?.trim() || null,
        };
      }
    } catch {
      // Fallback to direct page title fetch below
    }
  }

  try {
    const res = await httpsGetWithAgent(clean, undefined, 4500);
    if (res.status >= 200 && res.status < 400 && res.body) {
      const $ = cheerio.load(res.body);
      const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
      const docTitle = $('title').text().replace(/\s*-\s*YouTube$/i, '').trim();
      const author =
        $('link[itemprop="name"]').attr('content')?.trim() ||
        $('meta[name="author"]').attr('content')?.trim() ||
        null;
      return {
        title: ogTitle || docTitle || null,
        author,
      };
    }
  } catch {
    // Non-fatal metadata enrichment
  }
  return {};
}

function findChromiumExecutable(): string | undefined {
  const roots = ['/ms-playwright'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const entries = fs.readdirSync(root);
    for (const entry of entries) {
      const candidate1 = path.join(root, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate1)) return candidate1;
      const candidate2 = path.join(root, entry, 'chrome-linux', 'chrome');
      if (fs.existsSync(candidate2)) return candidate2;
    }
  }
  return undefined;
}

let sharedBrowserPromise: Promise<Browser> | null = null;

export async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowserPromise) {
    const executablePath = findChromiumExecutable();
    sharedBrowserPromise = chromium
      .launch({
        executablePath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-networking',
          '--autoplay-policy=no-user-gesture-required',
          '--mute-audio',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-blink-features=AutomationControlled',
        ],
      })
      .then((browser) => {
        browser.on('disconnected', () => {
          sharedBrowserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        sharedBrowserPromise = null;
        throw err;
      });
  }
  return sharedBrowserPromise;
}

function fetchBinaryAsDataUrl(url: string, timeoutMs = 6000): Promise<string | null> {
  if (url.startsWith('data:image/')) return Promise.resolve(url);

  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method: 'GET',
          timeout: timeoutMs,
          headers: {
            'User-Agent': SESSION_FINGERPRINTS[0].userAgent,
            Accept: 'image/*,*/*;q=0.8',
          },
        },
        (res) => {
          if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400 && res.headers.location) {
            const nextUrl = new URL(res.headers.location, url).toString();
            fetchBinaryAsDataUrl(nextUrl, timeoutMs).then(resolve);
            return;
          }
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          const contentType = res.headers['content-type']?.split(';')[0] || 'image/png';
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (c: Buffer) => {
            total += c.length;
            if (total <= 3_000_000) chunks.push(c);
          });
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            if (buf.length === 0) return resolve(null);
            resolve(`data:${contentType};base64,${buf.toString('base64')}`);
          });
        }
      );
      req.on('socket', (sock) => {
        sock.on('error', () => resolve(null));
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.on('error', () => resolve(null));
      req.end();
    } catch {
      resolve(null);
    }
  });
}

export async function computeImageDHash(imageSource: string): Promise<string | null> {
  const dataUrl = await fetchBinaryAsDataUrl(imageSource);
  if (!dataUrl) return null;

  const browser = await getSharedBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const hash = await page.evaluate(async (src: string) => {
      return new Promise<string | null>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 9;
            canvas.height = 8;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(null);
            ctx.drawImage(img, 0, 0, 9, 8);
            const data = ctx.getImageData(0, 0, 9, 8).data;
            let bits = '';
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                const idx1 = (y * 9 + x) * 4;
                const idx2 = (y * 9 + x + 1) * 4;
                const g1 = 0.299 * data[idx1] + 0.587 * data[idx1 + 1] + 0.114 * data[idx1 + 2];
                const g2 = 0.299 * data[idx2] + 0.587 * data[idx2 + 1] + 0.114 * data[idx2 + 2];
                bits += g1 > g2 ? '1' : '0';
              }
            }
            resolve(bits);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      });
    }, dataUrl);
    return hash;
  } finally {
    await context.close();
  }
}

function parseDuckDuckGoCandidates(html: string): {
  candidates: ParsedSearchCandidate[];
  nextFormParams: Record<string, string> | null;
} {
  const $ = cheerio.load(html);
  const candidates: ParsedSearchCandidate[] = [];
  const seen = new Set<string>();

  $('a.result__a, .result__title a').each((_i, el) => {
    const rawHref = $(el).attr('href') || '';
    const title = $(el).text().trim();
    if (!rawHref) return;

    let resolved = rawHref;
    try {
      if (rawHref.includes('uddg=')) {
        const u = new URL(rawHref.startsWith('http') ? rawHref : `https://duckduckgo.com${rawHref}`);
        const target = u.searchParams.get('uddg');
        if (target) resolved = decodeURIComponent(target);
      }
    } catch {
      // Keep rawHref
    }

    if (!resolved.startsWith('http')) return;
    if (seen.has(resolved)) return;
    seen.add(resolved);

    let domain = 'web';
    try {
      domain = new URL(resolved).hostname;
    } catch {
      // ignore
    }

    candidates.push({
      url: resolved,
      title: title || resolved,
      channelOrDomain: domain,
      videoId: extractYouTubeVideoId(resolved),
    });
  });

  // Extract next-page form inputs (DuckDuckGo HTML uses POST/GET form with s, nextParams, vqd, dc)
  let nextFormParams: Record<string, string> | null = null;
  $('div.nav-link form').each((_i, formEl) => {
    const btnText = $(formEl).find('input[type="submit"]').attr('value') || '';
    if (/next|sonraki/i.test(btnText) || $(formEl).find('input[name="s"]').length > 0) {
      const params: Record<string, string> = {};
      $(formEl)
        .find('input[type="hidden"]')
        .each((_j, inp) => {
          const name = $(inp).attr('name');
          const val = $(inp).attr('value') ?? '';
          if (name) params[name] = val;
        });
      if (params.q && params.s) {
        nextFormParams = params;
      }
    }
  });

  return { candidates, nextFormParams };
}

const CONSENT_BUTTON_SELECTORS = [
  'button[aria-label*="Reject all"]',
  'button[aria-label*="Alle ablehnen"]',
  'button[aria-label*="Tümünü reddet"]',
  'button:has-text("Alle ablehnen")',
  'button:has-text("Reject all")',
  'button:has-text("Tümünü reddet")',
  'button:has-text("Refuser tout")',
  'button:has-text("Tout refuser")',
  'button:has-text("Alles afwijzen")',
  '#onetrust-reject-all-handler',
  'form[action*="consent"] button:has-text("Reject")',
  'form[action*="consent"] button:has-text("Alle ablehnen")',
  'button:has-text("Alle akzeptieren")',
  'button:has-text("Accept all")',
  'button:has-text("Tümünü kabul et")',
  'button:has-text("Tout accepter")',
  'button:has-text("Alles accepteren")',
  'button:has-text("I agree")',
  '#onetrust-accept-btn-handler',
];

async function closeContextSafely(context: BrowserContext): Promise<void> {
  await Promise.race([
    context.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ]);
}

function withHardTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function dismissCookieConsentIfPresent(
  page: Page
): Promise<{ dismissed: boolean; label: string | null }> {
  // Quick DOM pre-check (5ms) so clean pages do not iterate 19 selectors sequentially
  const hasPotentialConsent = await page
    .evaluate(() => {
      const url = location.href.toLowerCase();
      if (url.includes('consent.youtube.com') || url.includes('consent.google.com')) return true;
      if (document.querySelector('#onetrust-banner-sdk, form[action*="consent"], ytd-consent-bump-v2-lightbox, tp-yt-paper-dialog')) {
        return true;
      }
      const text = (document.body?.innerText || '').slice(0, 1500).toLowerCase();
      return (
        text.includes('reject all') ||
        text.includes('alle ablehnen') ||
        text.includes('tümünü reddet') ||
        text.includes('accept all') ||
        text.includes('before you continue') ||
        text.includes('bevor sie zu youtube')
      );
    })
    .catch(() => false);

  if (!hasPotentialConsent) {
    return { dismissed: false, label: null };
  }

  for (const selector of CONSENT_BUTTON_SELECTORS) {
    try {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible().catch(() => false);
      if (visible) {
        const text =
          ((await locator.innerText({ timeout: 1200 }).catch(() => '')) ||
            (await locator.getAttribute('aria-label', { timeout: 1200 }).catch(() => '')) ||
            selector).trim();
        await locator.click({ timeout: 2200 }).catch(() => undefined);
        await page.waitForTimeout(550);
        return { dismissed: true, label: text.slice(0, 60) };
      }
    } catch {
      // Try next consent selector
    }
  }
  return { dismissed: false, label: null };
}

async function clickSafeTargetPageButton(
  page: Page,
  customSelector: string,
  isYouTube: boolean
): Promise<string | null> {
  const candidates: string[] = [];
  const trimmedCustom = customSelector.trim();

  if (trimmedCustom) {
    // Reject CAPTCHA / anti-bot widget selectors explicitly
    const lowerCustom = trimmedCustom.toLowerCase();
    const isBlockedSecuritySelector =
      lowerCustom.includes('recaptcha') ||
      lowerCustom.includes('captcha') ||
      lowerCustom.includes('turnstile') ||
      lowerCustom.includes('hcaptcha');
    if (!isBlockedSecuritySelector) {
      if (
        trimmedCustom.startsWith('.') ||
        trimmedCustom.startsWith('#') ||
        trimmedCustom.startsWith('[') ||
        trimmedCustom.includes('button') ||
        trimmedCustom.includes('>')
      ) {
        candidates.push(trimmedCustom);
      } else {
        candidates.push(`button:has-text("${trimmedCustom.replace(/"/g, '')}")`);
        candidates.push(`a:has-text("${trimmedCustom.replace(/"/g, '')}")`);
      }
    }
  }

  if (isYouTube) {
    candidates.push(
      'button.ytp-large-play-button',
      'button.ytp-play-button[data-title-no-tooltip="Play"]',
      'button.ytp-play-button'
    );
  }

  candidates.push(
    'button:has-text("Devam Et")',
    'button:has-text("Continue")',
    'button:has-text("Anladım")',
    'button:has-text("Got it")'
  );

  for (const selector of candidates) {
    try {
      const loc = page.locator(selector).first();
      const visible = await loc.isVisible({ timeout: 600 }).catch(() => false);
      if (visible) {
        const label =
          ((await loc.getAttribute('aria-label').catch(() => '')) ||
            (await loc.innerText().catch(() => '')) ||
            selector).trim();
        await loc.click({ timeout: 2500 }).catch(() => undefined);
        await page.waitForTimeout(450);
        return label.slice(0, 60);
      }
    } catch {
      // Ignore and try next safe control
    }
  }

  return null;
}

const SKIP_AD_SELECTORS = [
  'button.ytp-skip-ad-button',
  'button.ytp-ad-skip-button-modern',
  'button.ytp-ad-skip-button',
  'button:has-text("Reklamı Atla")',
  'button:has-text("Skip Ad")',
  'button:has-text("Skip")',
];

async function ensureVideoPlaybackAndSkipAds(
  page: Page,
  isYouTube: boolean,
  customSelector: string,
  humanizeAudioAndAdDelay = false,
  targetVolume = 0.35
): Promise<{ clickedLabel: string | null; adSkipped: boolean }> {
  let clickedLabel: string | null = null;
  let adSkipped = false;

  if (isYouTube) {
    for (const sel of SKIP_AD_SELECTORS) {
      try {
        const skipBtn = page.locator(sel).first();
        if (await skipBtn.isVisible({ timeout: 250 }).catch(() => false)) {
          if (humanizeAudioAndAdDelay) {
            await page.waitForTimeout(950);
          }
          await skipBtn.click({ timeout: 1200 }).catch(() => undefined);
          adSkipped = true;
          clickedLabel = 'Reklamı Atla';
          await page.waitForTimeout(300);
          break;
        }
      } catch {
        // Ignore invisible skip button
      }
    }
  }

  // Browser stays muted via --mute-audio; when humanized, expose non-muted player volume to telemetry
  const domState = await withHardTimeout(
    page.evaluate(
      ({ keepAudibleLevel, vol }: { keepAudibleLevel: boolean; vol: number }) => {
        const video = document.querySelector('video');
        if (!video) return { hasVideo: false, paused: true, ended: false };
        if (keepAudibleLevel) {
          video.muted = false;
          video.volume = Math.max(0.15, Math.min(0.65, vol));
        } else {
          video.muted = true;
        }
        if (video.paused && !video.ended) {
          try {
            const playPromise = video.play();
            if (playPromise && typeof playPromise.catch === 'function') {
              playPromise.catch(() => {
                video.muted = true;
                video.play().catch(() => undefined);
              });
            }
          } catch {
            // Will fall back to UI play button click below
          }
        }
        return {
          hasVideo: true,
          paused: video.paused,
          ended: video.ended,
        };
      },
      { keepAudibleLevel: humanizeAudioAndAdDelay, vol: targetVolume }
    ),
    2500,
    'play-eval-timeout'
  ).catch(() => ({ hasVideo: false, paused: true, ended: false }));

  if (!domState.hasVideo || (!domState.paused && !domState.ended)) {
    return { clickedLabel, adSkipped };
  }

  // Only click play button controls when video is still confirmed paused
  const playSelectors: string[] = [];
  const trimmedCustom = customSelector.trim();
  if (trimmedCustom) {
    const lowerCustom = trimmedCustom.toLowerCase();
    const blockedSec =
      lowerCustom.includes('recaptcha') ||
      lowerCustom.includes('captcha') ||
      lowerCustom.includes('turnstile') ||
      lowerCustom.includes('hcaptcha');
    if (!blockedSec) {
      if (
        trimmedCustom.startsWith('.') ||
        trimmedCustom.startsWith('#') ||
        trimmedCustom.startsWith('[') ||
        trimmedCustom.includes('button') ||
        trimmedCustom.includes('>')
      ) {
        playSelectors.push(trimmedCustom);
      } else {
        playSelectors.push(`button:has-text("${trimmedCustom.replace(/"/g, '')}")`);
      }
    }
  }

  if (isYouTube) {
    playSelectors.push(
      'button.ytp-large-play-button',
      'button.ytp-play-button[data-title-no-tooltip="Play"]',
      'button.ytp-play-button'
    );
  } else {
    playSelectors.push('button[aria-label*="Play"]', 'button:has-text("Play")', 'button:has-text("Oynat")');
  }

  for (const sel of playSelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 350 }).catch(() => false)) {
        const label =
          ((await loc.getAttribute('aria-label').catch(() => '')) ||
            (await loc.innerText().catch(() => '')) ||
            sel).trim();
        await loc.click({ timeout: 1800 }).catch(() => undefined);
        clickedLabel = clickedLabel || label.slice(0, 60);
        await page.waitForTimeout(300);
        break;
      }
    } catch {
      // Ignore play click errors
    }
  }

  return { clickedLabel, adSkipped };
}

export async function runExactLinkSession(params: {
  runId: string;
  session: SessionExecution;
  proxy: ProxyEndpoint | null;
  config: RunConfig;
  targetMetadata?: TargetMetadataHint;
  signal: AbortSignal;
  onUpdate: (updated: SessionExecution) => void;
}): Promise<SessionExecution> {
  const { runId, proxy, config, targetMetadata, signal, onUpdate } = params;
  const fp = pickGeoMatchedFingerprint(proxy?.countryCode, params.session.sessionIndex);

  let current: SessionExecution = {
    ...params.session,
    userAgent: fp.userAgent,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    networkType: proxy?.networkType ?? params.session.networkType ?? 'unknown',
    status: 'initializing',
    updatedAt: new Date().toISOString(),
  };
  onUpdate(current);

  const startedAt = Date.now();
  const browser = await getSharedBrowser();

  const proxyConfig = proxy
    ? {
        server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
      }
    : undefined;

  const profilePath = getProfileStoragePath(params.session.proxyId, params.session.sessionIndex);
  const loadedWarmProfile = config.enableProfileWarmup !== false && hasUsableWarmProfile(profilePath);
  let profileState: ProfileWarmupState = loadedWarmProfile ? 'reused-warm' : 'cold';

  const context = await browser.newContext({
    proxy: proxyConfig,
    userAgent: fp.userAgent,
    viewport: fp.viewport,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    ignoreHTTPSErrors: true,
    ...(loadedWarmProfile ? { storageState: profilePath } : {}),
    extraHTTPHeaders: {
      'Accept-Language': fp.acceptLanguage,
    },
  });

  await context.addInitScript((lang: string) => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => [lang, lang.split('-')[0] || 'en'] });
      (window as unknown as { chrome?: unknown }).chrome = {
        runtime: {},
        loadTimes: () => ({}),
        csi: () => ({}),
      };
    } catch {
      // Ignore init script errors
    }
  }, fp.locale);

  const maxSearchPages = Math.max(1, Math.min(5, config.maxSearchPages ?? 3));
  const minWatchSeconds = clampMinWatchSeconds(config.minWatchSeconds, 60);
  const humanizeWatchCurve = config.humanizeWatchCurve !== false;
  const effectiveWatchTarget = computeHumanizedWatchTarget(
    minWatchSeconds,
    params.session.sessionIndex,
    humanizeWatchCurve
  );
  const targetVolume = 0.25 + ((params.session.sessionIndex % 4) * 0.05);
  const sessionHardTimeoutMs = 140000 + effectiveWatchTarget * 1000;
  let hardTimedOut = false;

  try {
    return await withHardTimeout(
      (async () => {
        if (signal.aborted || hardTimedOut) {
          throw new Error('Görev kullanıcı tarafından durduruldu');
        }

        const searchDeadlineAt = startedAt + 34000;
        const page = await context.newPage();
        page.setDefaultTimeout(8500);

        let watchtimePingCount = 0;
        let lastWatchtimePingStatus: number | null = null;
        page.on('response', (res) => {
          try {
            if (isYouTubeWatchTelemetryUrl(res.url())) {
              const status = res.status();
              if (status >= 200 && status < 400) {
                watchtimePingCount++;
                lastWatchtimePingStatus = status;
              }
            }
          } catch {
            // Ignore response listener errors
          }
        });

        const isYouTubeTarget = Boolean(extractYouTubeVideoId(config.targetUrl));
        if (isYouTubeTarget && !loadedWarmProfile) {
          await context.addCookies([
            {
              name: 'SOCS',
              value: 'CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzEaAmRlIAEaBgiA_LyaBg',
              domain: '.youtube.com',
              path: '/',
            },
            {
              name: 'CONSENT',
              value: 'YES+cb.20210328-17-p0.en+FX+999',
              domain: '.youtube.com',
              path: '/',
            },
          ]);
        }

        // Block fonts always; block media & images during search discovery so free proxies stay fast
        let allowMediaForPlayback = false;
        await page.route('**/*', (route) => {
          const type = route.request().resourceType();
          if (type === 'font') {
            return route.abort().catch(() => undefined);
          }
          if (!allowMediaForPlayback && (type === 'media' || type === 'image')) {
            return route.abort().catch(() => undefined);
          }
          return route.continue().catch(() => undefined);
        });

        // Organic warm-up visit on cold profiles so YouTube issues visitor/session cookies before target search
        if (isYouTubeTarget && config.enableProfileWarmup !== false && !loadedWarmProfile) {
          try {
            await page.goto('https://www.youtube.com/', {
              waitUntil: 'domcontentloaded',
              timeout: 7500,
            });
            await page.waitForTimeout(700);
            if (config.autoDismissCookies) {
              const warmConsent = await dismissCookieConsentIfPresent(page);
              if (warmConsent.dismissed) {
                current = {
                  ...current,
                  consentDismissed: true,
                  consentButtonLabel: warmConsent.label,
                  trafficStatus: 'consent-passed',
                };
              }
            }
            await page.mouse.wheel(0, 420).catch(() => undefined);
            await page.waitForTimeout(1100);
            profileState = 'warmed';
          } catch {
            // Warm-up failure is non-fatal; continue directly to target search
          }
        }

        current = {
          ...current,
          profileState,
          targetWatchSeconds: effectiveWatchTarget,
        };

        const queries = buildSearchQueriesForTarget(
          config.targetUrl,
          config.searchQuery,
          config.autoEnrichQuery !== false ? targetMetadata : undefined
        );

        current = {
          ...current,
          status: 'searching',
          searchQuery: queries[0] || config.targetUrl,
          updatedAt: new Date().toISOString(),
        };
        onUpdate(current);

        const decisions: CandidateDecision[] = [];
        const seenCandidateUrls = new Set<string>();
        const matchState: {
          candidate: ParsedSearchCandidate | null;
          query: string | null;
          page: number | null;
          rank: number | null;
        } = {
          candidate: null,
          query: null,
          page: null,
          rank: null,
        };

        const inspectBatch = (
          batch: ParsedSearchCandidate[],
          pageNumber: number,
          queryRankOffset: number,
          activeQuery: string
        ): boolean => {
          for (let idx = 0; idx < batch.length; idx++) {
            const candidate = batch[idx];
            if (seenCandidateUrls.has(candidate.url)) continue;
            seenCandidateUrls.add(candidate.url);

            const globalRank = queryRankOffset + idx + 1;
            const check = isExactTargetMatch(candidate.url, config.targetUrl);
            if (check.matched) {
              decisions.push({
                url: candidate.url,
                title: candidate.title,
                channelOrDomain: candidate.channelOrDomain,
                videoId: candidate.videoId,
                pageNumber,
                rank: globalRank,
                decision: 'clicked-exact-match',
                reason: `${check.reason} (Sayfa ${pageNumber} · Sıra #${globalRank})`,
                timestamp: new Date().toISOString(),
              });
              matchState.candidate = candidate;
              matchState.query = activeQuery;
              matchState.page = pageNumber;
              matchState.rank = globalRank;
              return true;
            }

            decisions.push({
              url: candidate.url,
              title: candidate.title,
              channelOrDomain: candidate.channelOrDomain,
              videoId: candidate.videoId,
              pageNumber,
              rank: globalRank,
              decision: 'skipped-mismatch',
              reason: check.reason,
              timestamp: new Date().toISOString(),
            });
          }
          return false;
        };

        for (let queryIdx = 0; queryIdx < queries.length; queryIdx++) {
          const query = queries[queryIdx];
          if (signal.aborted || hardTimedOut || matchState.candidate || Date.now() > searchDeadlineAt) break;

          current = {
            ...current,
            searchQuery: query,
            updatedAt: new Date().toISOString(),
          };
          onUpdate(current);

          let queryRankCursor = 0;

          if (isYouTubeTarget) {
            const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
            let apiKey: string | null = null;
            let clientVersion: string | null = null;
            let continuationToken: string | null = null;
            let page1Candidates: ParsedSearchCandidate[] = [];

            const shouldUseChromiumForSearch = queryIdx === 0 || Date.now() - startedAt < 11000;

            // Attempt 1: Real Chromium browser load on YouTube search (primary query / early budget)
            if (shouldUseChromiumForSearch) {
              try {
                await page.goto(ytSearchUrl, { waitUntil: 'domcontentloaded', timeout: 8500 });
                await page.waitForTimeout(350);
                if (config.autoDismissCookies) {
                  const consentRes = await dismissCookieConsentIfPresent(page);
                  if (consentRes.dismissed) {
                    current = {
                      ...current,
                      consentDismissed: true,
                      consentButtonLabel: consentRes.label,
                      trafficStatus: 'consent-passed',
                    };
                  }
                }
                await page.waitForTimeout(350);
                const html = await page.content();
                const ctx = extractYouTubeSearchContext(html);
                page1Candidates = ctx.candidates;
                continuationToken = ctx.continuationToken;
                apiKey = ctx.apiKey;
                clientVersion = ctx.clientVersion;

                if (page1Candidates.length === 0) {
                  const domLinks = await page.evaluate(() => {
                    const anchors = Array.from(document.querySelectorAll('a#video-title, a[href*="/watch?v="]'));
                    return anchors.slice(0, 35).map((a) => ({
                      href: (a as HTMLAnchorElement).href,
                      title: (a.textContent || '').trim(),
                    }));
                  });
                  for (const link of domLinks) {
                    const vid = extractYouTubeVideoId(link.href);
                    if (vid) {
                      page1Candidates.push({
                        url: `https://www.youtube.com/watch?v=${vid}`,
                        title: link.title || `YouTube Video (${vid})`,
                        channelOrDomain: 'YouTube',
                        videoId: vid,
                      });
                    }
                  }
                }
              } catch {
                // Chromium timed out on YouTube JS; proxy HTTPS search fallback runs below
              }
            }

            // Attempt 2: Proxy-tunneled HTTPS YouTube SERP fetch if Chromium yielded 0 candidates or skipped for fallback query
            if (page1Candidates.length === 0 && !hardTimedOut && Date.now() < searchDeadlineAt) {
              const agent = proxy ? createProxyAgent(proxy, 5500) : undefined;
              try {
                const res = await httpsGetWithAgent(ytSearchUrl, agent, 6500, {
                  'User-Agent': fp.userAgent,
                  'Accept-Language': fp.acceptLanguage,
                  Cookie:
                    'SOCS=CAESHAgBEhJnd3NfMjAyMzA4MTAtMF9SQzEaAmRlIAEaBgiA_LyaBg; CONSENT=YES+cb.20210328-17-p0.en+FX+999',
                });
                const ctx = extractYouTubeSearchContext(res.body);
                page1Candidates = ctx.candidates;
                continuationToken = ctx.continuationToken;
                apiKey = ctx.apiKey;
                clientVersion = ctx.clientVersion;
              } catch {
                // Ignore and fall back to DuckDuckGo below if still empty
              } finally {
                agent?.destroy();
              }
            }

            if (page1Candidates.length > 0) {
              const foundOnP1 = inspectBatch(page1Candidates, 1, queryRankCursor, query);
              queryRankCursor += page1Candidates.length;

              // Deep multi-page pagination across YouTube pages 2..maxSearchPages via InnerTube + Chromium scroll
              if (!foundOnP1 && maxSearchPages > 1 && Date.now() < searchDeadlineAt) {
                if (continuationToken && apiKey) {
                  const agent = proxy ? createProxyAgent(proxy, 5000) : undefined;
                  try {
                    for (let pageNum = 2; pageNum <= maxSearchPages; pageNum++) {
                      if (!continuationToken || signal.aborted || Date.now() > searchDeadlineAt) break;
                      const contRes = await httpsPostJsonWithAgent(
                        `https://www.youtube.com/youtubei/v1/search?key=${encodeURIComponent(apiKey)}`,
                        {
                          context: {
                            client: {
                              clientName: 'WEB',
                              clientVersion: clientVersion || '2.20261123.00.00',
                              hl: fp.locale.split('-')[0] || 'en',
                              gl: (proxy?.countryCode || 'US').toUpperCase(),
                            },
                          },
                          continuation: continuationToken,
                        },
                        agent,
                        5000,
                        {
                          'User-Agent': fp.userAgent,
                          'Accept-Language': fp.acceptLanguage,
                        }
                      );
                      if (contRes.status !== 200) break;
                      const contJson = safeJsonParse<unknown>(contRes.body);
                      const nextBatch = extractYouTubeCandidatesFromJson(contJson);
                      continuationToken = findContinuationTokenInJson(contJson);
                      if (nextBatch.length === 0) break;

                      const hit = inspectBatch(nextBatch, pageNum, queryRankCursor, query);
                      queryRankCursor += nextBatch.length;
                      if (hit) break;
                    }
                  } catch {
                    // Fallback to Chromium scroll if InnerTube pagination failed
                  } finally {
                    agent?.destroy();
                  }
                } else {
                  // Scroll inside Chromium when continuation token wasn't extracted
                  for (let pageNum = 2; pageNum <= maxSearchPages; pageNum++) {
                    if (signal.aborted || Date.now() > searchDeadlineAt) break;
                    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 3)).catch(() => undefined);
                    await page.waitForTimeout(650);
                    const scrolledLinks = await page
                      .evaluate(() => {
                        const anchors = Array.from(document.querySelectorAll('a#video-title, a[href*="/watch?v="]'));
                        return anchors.slice(0, 120).map((a) => ({
                          href: (a as HTMLAnchorElement).href,
                          title: (a.textContent || '').trim(),
                        }));
                      })
                      .catch(() => []);
                    const batch: ParsedSearchCandidate[] = [];
                    for (const link of scrolledLinks) {
                      const vid = extractYouTubeVideoId(link.href);
                      if (vid) {
                        batch.push({
                          url: `https://www.youtube.com/watch?v=${vid}`,
                          title: link.title || `YouTube Video (${vid})`,
                          channelOrDomain: 'YouTube',
                          videoId: vid,
                        });
                      }
                    }
                    if (inspectBatch(batch, pageNum, queryRankCursor, query)) break;
                    queryRankCursor = decisions.length;
                  }
                }
              }
            }

            // Secondary web index fallback if YouTube returned 0 candidates on that proxy
            if (!matchState.candidate && page1Candidates.length === 0 && Date.now() < searchDeadlineAt) {
              const agent = proxy ? createProxyAgent(proxy, 5500) : undefined;
              try {
                const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:youtube.com ${query}`)}`;
                const res = await httpsGetWithAgent(ddgUrl, agent, 6500, {
                  'User-Agent': fp.userAgent,
                  'Accept-Language': fp.acceptLanguage,
                });
                const parsedDdg = parseDuckDuckGoCandidates(res.body);
                if (parsedDdg.candidates.length > 0) {
                  inspectBatch(parsedDdg.candidates, 1, queryRankCursor, query);
                }
              } catch {
                // Ignore DDG fallback failure
              } finally {
                agent?.destroy();
              }
            }
          } else {
            // Non-YouTube web URL multi-page search via DuckDuckGo HTML
            const ddgSearchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            let nextParams: Record<string, string> | null = null;
            let page1List: ParsedSearchCandidate[] = [];

            try {
              await page.goto(ddgSearchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
              const html = await page.content();
              const parsed = parseDuckDuckGoCandidates(html);
              page1List = parsed.candidates;
              nextParams = parsed.nextFormParams;
            } catch {
              const agent = proxy ? createProxyAgent(proxy, 6000) : undefined;
              try {
                const res = await httpsGetWithAgent(ddgSearchUrl, agent, 7000, {
                  'User-Agent': fp.userAgent,
                  'Accept-Language': fp.acceptLanguage,
                });
                const parsed = parseDuckDuckGoCandidates(res.body);
                page1List = parsed.candidates;
                nextParams = parsed.nextFormParams;
              } catch {
                // Ignore
              } finally {
                agent?.destroy();
              }
            }

            if (page1List.length > 0) {
              const hit = inspectBatch(page1List, 1, queryRankCursor, query);
              queryRankCursor += page1List.length;

              if (!hit && nextParams && maxSearchPages > 1 && Date.now() < searchDeadlineAt) {
                const agent = proxy ? createProxyAgent(proxy, 5500) : undefined;
                try {
                  for (let pageNum = 2; pageNum <= maxSearchPages; pageNum++) {
                    if (!nextParams || signal.aborted || Date.now() > searchDeadlineAt) break;
                    const qs = new URLSearchParams(nextParams).toString();
                    const res = await httpsGetWithAgent(
                      `https://html.duckduckgo.com/html/?${qs}`,
                      agent,
                      6000,
                      {
                        'User-Agent': fp.userAgent,
                        'Accept-Language': fp.acceptLanguage,
                      }
                    );
                    const parsedNext = parseDuckDuckGoCandidates(res.body);
                    nextParams = parsedNext.nextFormParams;
                    if (parsedNext.candidates.length === 0) break;
                    if (inspectBatch(parsedNext.candidates, pageNum, queryRankCursor, query)) break;
                    queryRankCursor += parsedNext.candidates.length;
                  }
                } catch {
                  // Ignore DDG pagination failure
                } finally {
                  agent?.destroy();
                }
              }
            }
          }

          current = {
            ...current,
            matchedQuery: matchState.query,
            foundAtPage: matchState.page,
            foundAtRank: matchState.rank,
            candidatesInspected: decisions.length,
            candidatesSkipped: decisions.filter((d) => d.decision !== 'clicked-exact-match').length,
            decisions: [...decisions],
            updatedAt: new Date().toISOString(),
          };
          onUpdate(current);
        }

        const matchedCandidate = matchState.candidate;
        if (!matchedCandidate) {
          current = {
            ...current,
            status: 'not-found',
            durationMs: Date.now() - startedAt,
            error:
              decisions.length > 0
                ? `${maxSearchPages} arama sayfasında (${decisions.length} sonuç) birebir hedef link bulunamadı; hiçbir ilgisiz link açılmadı.`
                : 'Arama motoru bu proxy üzerinden sonuç döndürmedi; hiçbir ilgisiz link açılmadı.',
            updatedAt: new Date().toISOString(),
          };
          onUpdate(current);
          return current;
        }

        // Exact match found! ONLY NOW click/navigate to the target URL
        current = {
          ...current,
          status: 'navigating-match',
          matchedUrl: matchedCandidate.url,
          matchedQuery: matchState.query,
          foundAtPage: matchState.page,
          foundAtRank: matchState.rank,
          updatedAt: new Date().toISOString(),
        };
        onUpdate(current);

        allowMediaForPlayback = true;

        if (isYouTubeTarget && minWatchSeconds > 0) {
          // Hint 240p/360p stream bitrate so free proxies play smoothly without stalling
          await page
            .evaluate(() => {
              try {
                const payload = JSON.stringify({
                  data: JSON.stringify({ quality: 240, previousQuality: 240 }),
                  expiration: Date.now() + 86400000,
                  creation: Date.now(),
                });
                localStorage.setItem('yt-player-quality', payload);
              } catch {
                // Ignore origin storage errors
              }
            })
            .catch(() => undefined);
        }

        let httpStatus: number | null = null;
        let resolvedTitle = matchedCandidate.title;
        let screenshotUrl: string | null = null;
        let watchSecondsActual = 0;
        let videoDurationSeconds: number | null = null;
        let playbackStatus: PlaybackStatus = 'idle';
        let sessionDepthUrl: string | null = null;
        let sessionDepthTitle: string | null = null;

        try {
          const clickableSelector = isYouTubeTarget
            ? `a[href*="${matchedCandidate.videoId}"]`
            : `a[href="${matchedCandidate.url}"]`;
          const locator = page.locator(clickableSelector).first();
          const isVisibleOnPage = await locator.isVisible().catch(() => false);

          if (isVisibleOnPage) {
            const [response] = await Promise.all([
              page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 14000 }).catch(() => null),
              locator.click({ timeout: 4500 }).catch(() => null),
            ]);
            httpStatus = response ? response.status() : 200;
          } else {
            const response = await page.goto(matchedCandidate.url, {
              waitUntil: 'domcontentloaded',
              timeout: 14000,
            });
            httpStatus = response ? response.status() : 200;
          }

          await page.waitForTimeout(1000);

          if (config.autoDismissCookies) {
            const targetConsent = await dismissCookieConsentIfPresent(page);
            if (targetConsent.dismissed) {
              current = {
                ...current,
                consentDismissed: true,
                consentButtonLabel: targetConsent.label,
                trafficStatus: 'consent-passed',
              };
            }
          }

          const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '').catch(() => '');
          const liveTitle = (await page.title().catch(() => '')) || matchedCandidate.title;
          resolvedTitle = liveTitle.trim() || matchedCandidate.title;

          const gate = detectTrafficGateFromPage(bodyText, page.url(), resolvedTitle);
          if (gate.blocked) {
            playbackStatus = 'blocked';
            current = {
              ...current,
              trafficStatus: 'bot-gate-detected',
              trafficGateReason: gate.reason,
            };
          } else if (current.trafficStatus === 'unknown') {
            current = {
              ...current,
              trafficStatus: current.consentDismissed ? 'consent-passed' : 'clear',
              trafficGateReason: null,
            };
          }

          if (!gate.blocked) {
            if (effectiveWatchTarget > 0) {
              await page.waitForSelector('video', { timeout: 6000 }).catch(() => null);
              const hasVideo = await page.evaluate(() => Boolean(document.querySelector('video'))).catch(() => false);

              if (!hasVideo) {
                playbackStatus = 'no-video';
                if (config.autoClickActionButton) {
                  const clickedLabel = await clickSafeTargetPageButton(
                    page,
                    config.actionButtonSelector,
                    isYouTubeTarget
                  );
                  if (clickedLabel) {
                    current = { ...current, actionButtonClicked: clickedLabel };
                  }
                }
              } else {
                if (isYouTubeTarget) {
                  await page
                    .evaluate(() => {
                      const mp = document.getElementById('movie_player') as
                        | (HTMLElement & { setPlaybackQualityRange?: (min: string, max: string) => void })
                        | null;
                      mp?.setPlaybackQualityRange?.('tiny', 'small');
                    })
                    .catch(() => undefined);
                }

                if (config.autoClickActionButton || isYouTubeTarget) {
                  const kick = await ensureVideoPlaybackAndSkipAds(
                    page,
                    isYouTubeTarget,
                    config.actionButtonSelector,
                    humanizeWatchCurve,
                    targetVolume
                  );
                  if (kick.clickedLabel) {
                    current = { ...current, actionButtonClicked: kick.clickedLabel };
                  }
                }

                if (hardTimedOut || signal.aborted) {
                  return current;
                }

                playbackStatus = 'playing';
                current = {
                  ...current,
                  status: 'watching',
                  resolvedTitle,
                  httpStatus,
                  watchSecondsActual: 0,
                  targetWatchSeconds: effectiveWatchTarget,
                  videoDurationSeconds: null,
                  playbackStatus: 'playing',
                  profileState,
                  watchtimePingCount,
                  lastWatchtimePingStatus,
                  updatedAt: new Date().toISOString(),
                };
                onUpdate(current);

                let watchedSeconds = 0;
                let maxObservedVideoTime = 0;
                let recoveryCount = 0;
                let lastSampleTime: number | null = null;
                let lastAdShowing = false;
                let endedReached = false;
                let tickCount = 0;
                const watchStartedAt = Date.now();
                const watchDeadlineAt = watchStartedAt + (effectiveWatchTarget + 75) * 1000;

                while (!signal.aborted && !hardTimedOut && Date.now() < watchDeadlineAt) {
                  await page.waitForTimeout(1500);
                  if (signal.aborted || hardTimedOut) break;
                  tickCount++;

                  // Humanized engagement micro-behaviors: gentle comment scroll & natural cursor presence
                  if (humanizeWatchCurve && isYouTubeTarget) {
                    if (tickCount === 4) {
                      await page.mouse.wheel(0, 240).catch(() => undefined);
                    } else if (tickCount === 9) {
                      await page.mouse.wheel(0, -240).catch(() => undefined);
                    } else if (tickCount % 8 === 0) {
                      await page.mouse
                        .move(280 + ((tickCount * 19) % 240), 220 + ((tickCount * 13) % 120))
                        .catch(() => undefined);
                    }
                  }

                  if (tickCount % 6 === 1) {
                    if (config.autoDismissCookies) {
                      const midConsent = await dismissCookieConsentIfPresent(page);
                      if (midConsent.dismissed) {
                        current = {
                          ...current,
                          consentDismissed: true,
                          consentButtonLabel: midConsent.label,
                          trafficStatus: 'consent-passed',
                        };
                      }
                    }

                    const midBodyText = await withHardTimeout(
                      page.evaluate(() => document.body?.innerText?.slice(0, 2000) || ''),
                      2500,
                      'body-eval-timeout'
                    ).catch(() => '');
                    const midTitle =
                      (await withHardTimeout(page.title(), 2500, 'title-timeout').catch(() => '')) ||
                      resolvedTitle;
                    const midGate = detectTrafficGateFromPage(midBodyText, page.url(), midTitle);
                    if (midGate.blocked) {
                      playbackStatus = 'blocked';
                      current = {
                        ...current,
                        trafficStatus: 'bot-gate-detected',
                        trafficGateReason: midGate.reason,
                      };
                      break;
                    }
                  }

                  const sample = await withHardTimeout(
                    page.evaluate(() => {
                      const v = document.querySelector('video');
                      if (!v) return null;
                      const player = document.querySelector('.html5-video-player');
                      const adShowing = Boolean(
                        player?.classList.contains('ad-showing') ||
                          player?.classList.contains('ad-interrupting')
                      );
                      const playerError = Boolean(
                        document
                          .querySelector('.ytp-error-content-wrap-reason, ytd-player-error-message-renderer')
                          ?.textContent?.trim()
                      );
                      return {
                        paused: v.paused,
                        currentTime: v.currentTime,
                        duration: v.duration,
                        ended: v.ended,
                        readyState: v.readyState,
                        adShowing,
                        playerError,
                      };
                    }),
                    3500,
                    'sample-eval-timeout'
                  ).catch(() => null);

                  if (signal.aborted || hardTimedOut) break;
                  if (!sample) continue;

                  // If YouTube drops buffered stream past ~58s ("Something went wrong. Refresh..."), reload at exact timestamp
                  if (
                    isYouTubeTarget &&
                    matchedCandidate.videoId &&
                    recoveryCount < 2 &&
                    watchedSeconds < effectiveWatchTarget &&
                    (sample.playerError ||
                      (sample.readyState === 0 && sample.currentTime === 0 && maxObservedVideoTime >= 15))
                  ) {
                    recoveryCount++;
                    lastSampleTime = null;
                    const resumeAt = Math.max(1, Math.floor(maxObservedVideoTime));
                    await page
                      .goto(
                        `https://www.youtube.com/watch?v=${matchedCandidate.videoId}&t=${resumeAt}s`,
                        { waitUntil: 'domcontentloaded', timeout: 14000 }
                      )
                      .catch(() => null);
                    await page.waitForSelector('video', { timeout: 6000 }).catch(() => null);
                    await ensureVideoPlaybackAndSkipAds(
                      page,
                      isYouTubeTarget,
                      config.actionButtonSelector,
                      humanizeWatchCurve,
                      targetVolume
                    );
                    continue;
                  }

                  if (sample.adShowing || sample.paused) {
                    const kick = await ensureVideoPlaybackAndSkipAds(
                      page,
                      isYouTubeTarget,
                      config.actionButtonSelector,
                      humanizeWatchCurve,
                      targetVolume
                    );
                    if (kick.clickedLabel && !current.actionButtonClicked) {
                      current = { ...current, actionButtonClicked: kick.clickedLabel };
                    }
                  }

                  if (sample.adShowing) {
                    lastAdShowing = true;
                    lastSampleTime = null;
                  } else {
                    if (lastAdShowing) {
                      lastAdShowing = false;
                      lastSampleTime = sample.currentTime;
                    }
                    if (Number.isFinite(sample.currentTime) && sample.currentTime > maxObservedVideoTime) {
                      maxObservedVideoTime = sample.currentTime;
                    }
                    if (Number.isFinite(sample.duration) && sample.duration > 0) {
                      videoDurationSeconds = Math.round(sample.duration);
                    }
                    if (lastSampleTime !== null) {
                      watchedSeconds += computePlaybackAdvance(
                        lastSampleTime,
                        sample.currentTime,
                        sample.paused,
                        sample.readyState
                      );
                    }
                    lastSampleTime = sample.currentTime;
                    if (sample.ended) {
                      endedReached = true;
                    }
                  }

                  if (signal.aborted || hardTimedOut) break;

                  watchSecondsActual = Math.floor(watchedSeconds);
                  current = {
                    ...current,
                    status: 'watching',
                    playbackStatus: 'playing',
                    watchSecondsActual,
                    targetWatchSeconds: effectiveWatchTarget,
                    videoDurationSeconds,
                    profileState,
                    watchtimePingCount,
                    lastWatchtimePingStatus,
                    updatedAt: new Date().toISOString(),
                  };
                  onUpdate(current);

                  if (watchedSeconds >= effectiveWatchTarget || (endedReached && watchedSeconds > 0)) {
                    break;
                  }

                  if (Date.now() - watchStartedAt > 36000 && watchedSeconds < 2) {
                    break;
                  }
                }

                watchSecondsActual = Math.floor(watchedSeconds);
                if (playbackStatus !== 'blocked') {
                  if (watchedSeconds >= effectiveWatchTarget || (endedReached && watchedSeconds > 0)) {
                    playbackStatus = 'completed';
                  } else {
                    playbackStatus = 'stalled';
                  }
                }
              }
            } else if (config.autoClickActionButton) {
              const clickedLabel = await clickSafeTargetPageButton(
                page,
                config.actionButtonSelector,
                isYouTubeTarget
              );
              if (clickedLabel) {
                current = {
                  ...current,
                  actionButtonClicked: clickedLabel,
                };
              }
            }
          }

          if (config.captureProofScreenshot) {
            ensureProofsDir();
            if (isYouTubeTarget) {
              await page.locator('#movie_player').hover({ timeout: 1000 }).catch(() => undefined);
              await page.waitForTimeout(250);
            }
            const fileName = `${runId}-s${current.sessionIndex}.png`;
            const outPath = path.join(PROOFS_DIR, fileName);
            await page.screenshot({ path: outPath, fullPage: false, timeout: 8500 });
            screenshotUrl = `/api/proofs/${fileName}`;
          }

          // Session depth: after completing target watch + capturing proof, organically transition to 1 related video
          if (
            isYouTubeTarget &&
            config.enableSessionDepth !== false &&
            playbackStatus === 'completed' &&
            !gate.blocked &&
            !hardTimedOut &&
            !signal.aborted
          ) {
            try {
              const nextCandidate = await withHardTimeout(
                page.evaluate((excludeVid: string) => {
                  const links = Array.from(
                    document.querySelectorAll(
                      '#related a[href*="/watch?v="], ytd-compact-video-renderer a[href*="/watch?v="], yt-lockup-view-model a[href*="/watch?v="]'
                    )
                  );
                  for (const el of links) {
                    const href = (el as HTMLAnchorElement).href || '';
                    const m = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
                    if (m && m[1] !== excludeVid) {
                      const title =
                        el.getAttribute('title') ||
                        el.textContent?.replace(/\s+/g, ' ').trim() ||
                        `YouTube (${m[1]})`;
                      return { url: `https://www.youtube.com/watch?v=${m[1]}`, title: title.slice(0, 100) };
                    }
                  }
                  return null;
                }, matchedCandidate.videoId || ''),
                2500,
                'depth-eval-timeout'
              ).catch(() => null);

              if (nextCandidate) {
                await page
                  .goto(nextCandidate.url, { waitUntil: 'domcontentloaded', timeout: 8500 })
                  .catch(() => null);
                await page.waitForSelector('video', { timeout: 3500 }).catch(() => null);
                await ensureVideoPlaybackAndSkipAds(
                  page,
                  true,
                  '',
                  humanizeWatchCurve,
                  targetVolume
                );
                await page.waitForTimeout(4200);
                sessionDepthUrl = nextCandidate.url;
                sessionDepthTitle = nextCandidate.title;
              }
            } catch {
              // Session depth continuation failure is non-fatal
            }
          }

          // Persist warmed browser cookies/storage for future runs if session stayed unblocked
          if (config.enableProfileWarmup !== false && !gate.blocked) {
            try {
              ensureProfilesDir();
              await context.storageState({ path: profilePath });
              if (profileState === 'cold') {
                profileState = 'warmed';
              }
            } catch {
              // Ignore non-fatal storage save errors
            }
          }
        } catch (navErr) {
          if (hardTimedOut || signal.aborted) {
            return current;
          }
          const agent = proxy ? createProxyAgent(proxy, 6500) : undefined;
          try {
            const res = await httpsGetWithAgent(matchedCandidate.url, agent, 7500, {
              'User-Agent': fp.userAgent,
              'Accept-Language': fp.acceptLanguage,
            });
            httpStatus = res.status;
            const $ = cheerio.load(res.body);
            resolvedTitle = $('title').text().trim() || matchedCandidate.title;
            playbackStatus = 'no-video';
            if (!httpStatus) {
              throw navErr;
            }
          } finally {
            agent?.destroy();
          }
        }

        if (hardTimedOut || signal.aborted) {
          return current;
        }

        current = {
          ...current,
          status: 'matched',
          error: null,
          matchedUrl: matchedCandidate.url,
          matchedQuery: matchState.query,
          foundAtPage: matchState.page,
          foundAtRank: matchState.rank,
          resolvedTitle,
          httpStatus,
          screenshotUrl,
          watchSecondsActual,
          targetWatchSeconds: effectiveWatchTarget,
          videoDurationSeconds,
          playbackStatus,
          profileState,
          watchtimePingCount,
          lastWatchtimePingStatus,
          sessionDepthUrl,
          sessionDepthTitle,
          durationMs: Date.now() - startedAt,
          updatedAt: new Date().toISOString(),
        };
        onUpdate(current);
        return current;
      })(),
      sessionHardTimeoutMs,
      'Oturum zaman aşımı (proxy yanıt vermedi)'
    );
  } catch (err) {
    hardTimedOut = true;
    current = {
      ...current,
      status: 'proxy-error',
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Oturum/proxy bağlantı hatası',
      updatedAt: new Date().toISOString(),
    };
    onUpdate(current);
    return current;
  } finally {
    await closeContextSafely(context);
  }
}

interface OsintPlatformProbe {
  platform: string;
  probe: (
    username: string,
    agent: http.Agent | undefined,
    userAgent: string
  ) => Promise<{
    found: boolean;
    httpStatus: number;
    profileUrl: string;
    usernameFound: string;
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
  } | null>;
}

const OSINT_PLATFORMS: OsintPlatformProbe[] = [
  {
    platform: 'GitHub',
    probe: async (username, agent, userAgent) => {
      const url = `https://api.github.com/users/${encodeURIComponent(username)}`;
      const res = await httpsGetWithAgent(url, agent, 6500, { 'User-Agent': userAgent });
      if (res.status !== 200) return null;
      const json = safeJsonParse(res.body) as {
        login?: string;
        name?: string;
        bio?: string;
        avatar_url?: string;
        html_url?: string;
      };
      return {
        found: true,
        httpStatus: res.status,
        profileUrl: json.html_url || `https://github.com/${username}`,
        usernameFound: json.login || username,
        displayName: json.name || null,
        bio: json.bio || null,
        avatarUrl: json.avatar_url || null,
      };
    },
  },
  {
    platform: 'Reddit',
    probe: async (username, agent, userAgent) => {
      const url = `https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`;
      const res = await httpsGetWithAgent(url, agent, 6500, { 'User-Agent': userAgent });
      if (res.status !== 200) return null;
      const json = safeJsonParse(res.body) as {
        data?: {
          name?: string;
          icon_img?: string;
          snoovatar_img?: string;
          subreddit?: { title?: string; public_description?: string };
        };
      };
      if (!json.data?.name) return null;
      const avatar = (json.data.icon_img || json.data.snoovatar_img || '').split('?')[0] || null;
      return {
        found: true,
        httpStatus: res.status,
        profileUrl: `https://www.reddit.com/user/${json.data.name}`,
        usernameFound: json.data.name,
        displayName: json.data.subreddit?.title || json.data.name,
        bio: json.data.subreddit?.public_description || null,
        avatarUrl: avatar,
      };
    },
  },
  {
    platform: 'Dev.to',
    probe: async (username, agent, userAgent) => {
      const url = `https://dev.to/api/users/by_username?url=${encodeURIComponent(username)}`;
      const res = await httpsGetWithAgent(url, agent, 6500, { 'User-Agent': userAgent });
      if (res.status !== 200) return null;
      const json = safeJsonParse(res.body) as {
        username?: string;
        name?: string;
        summary?: string;
        profile_image?: string;
      };
      if (!json.username) return null;
      return {
        found: true,
        httpStatus: res.status,
        profileUrl: `https://dev.to/${json.username}`,
        usernameFound: json.username,
        displayName: json.name || null,
        bio: json.summary || null,
        avatarUrl: json.profile_image || null,
      };
    },
  },
  {
    platform: 'GitLab',
    probe: async (username, agent, userAgent) => {
      const url = `https://gitlab.com/api/v4/users?username=${encodeURIComponent(username)}`;
      const res = await httpsGetWithAgent(url, agent, 6500, { 'User-Agent': userAgent });
      if (res.status !== 200) return null;
      const list = safeJsonParse(res.body) as Array<{
        username?: string;
        name?: string;
        bio?: string;
        avatar_url?: string;
        web_url?: string;
      }>;
      const first = list[0];
      if (!first?.username) return null;
      return {
        found: true,
        httpStatus: res.status,
        profileUrl: first.web_url || `https://gitlab.com/${first.username}`,
        usernameFound: first.username,
        displayName: first.name || null,
        bio: first.bio || null,
        avatarUrl: first.avatar_url || null,
      };
    },
  },
  {
    platform: 'HackerNews',
    probe: async (username, agent, userAgent) => {
      const url = `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(username)}.json`;
      const res = await httpsGetWithAgent(url, agent, 6500, { 'User-Agent': userAgent });
      if (res.status !== 200 || res.body.trim() === 'null') return null;
      const json = safeJsonParse(res.body) as { id?: string; about?: string };
      if (!json.id) return null;
      return {
        found: true,
        httpStatus: res.status,
        profileUrl: `https://news.ycombinator.com/user?id=${json.id}`,
        usernameFound: json.id,
        displayName: json.id,
        bio: json.about ? cheerio.load(json.about).text() : null,
        avatarUrl: null,
      };
    },
  },
  {
    platform: 'Mastodon.social',
    probe: async (username, agent, userAgent) => {
      const url = `https://mastodon.social/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`;
      const res = await httpsGetWithAgent(url, agent, 6500, { 'User-Agent': userAgent });
      if (res.status !== 200) return null;
      const json = safeJsonParse(res.body) as {
        username?: string;
        display_name?: string;
        note?: string;
        avatar?: string;
        url?: string;
      };
      if (!json.username) return null;
      return {
        found: true,
        httpStatus: res.status,
        profileUrl: json.url || `https://mastodon.social/@${json.username}`,
        usernameFound: json.username,
        displayName: json.display_name || null,
        bio: json.note ? cheerio.load(json.note).text() : null,
        avatarUrl: json.avatar || null,
      };
    },
  },
  {
    platform: 'YouTube Kanal',
    probe: async (username, agent, userAgent) => {
      const url = `https://www.youtube.com/@${encodeURIComponent(username)}`;
      const res = await httpsGetWithAgent(url, agent, 7500, { 'User-Agent': userAgent });
      if (res.status !== 200) return null;
      const $ = cheerio.load(res.body);
      const title = $('meta[property="og:title"]').attr('content')?.trim() || null;
      const desc = $('meta[property="og:description"]').attr('content')?.trim() || null;
      const image = $('meta[property="og:image"]').attr('content')?.trim() || null;
      if (!title) return null;
      return {
        found: true,
        httpStatus: res.status,
        profileUrl: url,
        usernameFound: username,
        displayName: title,
        bio: desc,
        avatarUrl: image,
      };
    },
  },
  {
    platform: 'Keybase',
    probe: async (username, agent, userAgent) => {
      const url = `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${encodeURIComponent(username)}`;
      const res = await httpsGetWithAgent(url, agent, 6500, { 'User-Agent': userAgent });
      if (res.status !== 200) return null;
      const json = safeJsonParse(res.body) as {
        them?: Array<{
          basics?: { username?: string };
          profile?: { full_name?: string; bio?: string };
          pictures?: { primary?: { url?: string } };
        } | null>;
      };
      const hit = json.them?.[0];
      if (!hit?.basics?.username) return null;
      return {
        found: true,
        httpStatus: res.status,
        profileUrl: `https://keybase.io/${hit.basics.username}`,
        usernameFound: hit.basics.username,
        displayName: hit.profile?.full_name || null,
        bio: hit.profile?.bio || null,
        avatarUrl: hit.pictures?.primary?.url || null,
      };
    },
  },
  {
    platform: 'Vimeo',
    probe: async (username, agent, userAgent) => {
      const url = `https://vimeo.com/${encodeURIComponent(username)}`;
      const res = await httpsGetWithAgent(url, agent, 6500, { 'User-Agent': userAgent });
      if (res.status !== 200) return null;
      const $ = cheerio.load(res.body);
      const title = $('meta[property="og:title"]').attr('content')?.trim() || null;
      const desc = $('meta[property="og:description"]').attr('content')?.trim() || null;
      const image = $('meta[property="og:image"]').attr('content')?.trim() || null;
      if (!title || title.toLowerCase().includes('page not found')) return null;
      return {
        found: true,
        httpStatus: res.status,
        profileUrl: url,
        usernameFound: username,
        displayName: title,
        bio: desc,
        avatarUrl: image,
      };
    },
  },
  {
    platform: 'Gravatar',
    probe: async (username, agent, userAgent) => {
      const hash = crypto.createHash('md5').update(username.trim().toLowerCase()).digest('hex');
      const url = `https://en.gravatar.com/${hash}.json`;
      const res = await httpsGetWithAgent(url, agent, 6000, { 'User-Agent': userAgent });
      if (res.status !== 200) return null;
      const json = safeJsonParse(res.body) as {
        entry?: Array<{
          preferredUsername?: string;
          displayName?: string;
          aboutMe?: string;
          thumbnailUrl?: string;
          profileUrl?: string;
        }>;
      };
      const entry = json.entry?.[0];
      if (!entry) return null;
      return {
        found: true,
        httpStatus: res.status,
        profileUrl: entry.profileUrl || `https://gravatar.com/${hash}`,
        usernameFound: entry.preferredUsername || username,
        displayName: entry.displayName || null,
        bio: entry.aboutMe || null,
        avatarUrl: entry.thumbnailUrl || null,
      };
    },
  },
];

export async function runOsintPlatformCheck(params: {
  runId: string;
  platformIndex: number;
  session: SessionExecution;
  proxy: ProxyEndpoint | null;
  config: RunConfig;
  referenceDHash: string | null;
  onUpdateSession: (s: SessionExecution) => void;
  onOsintHit: (hit: ProfileDiscoveryHit) => void;
}): Promise<SessionExecution> {
  const { runId, platformIndex, proxy, config, referenceDHash, onUpdateSession, onOsintHit } = params;
  const cleanUser = config.username.trim().replace(/^@/, '');
  const clues = config.clues
    .split(/[,;\n]+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const probeDef = OSINT_PLATFORMS[platformIndex % OSINT_PLATFORMS.length];
  let current: SessionExecution = {
    ...params.session,
    status: 'searching',
    searchQuery: `${probeDef.platform}: @${cleanUser}`,
    updatedAt: new Date().toISOString(),
  };
  onUpdateSession(current);

  const startedAt = Date.now();
  const fp = pickFingerprint(current.sessionIndex, proxy?.countryCode);

  try {
    // Try via assigned verified proxy first; if a free public proxy rejects a specific host TLS, fall back to another verified proxy or report error honestly
    const agent = proxy ? createProxyAgent(proxy) : undefined;
    let result;
    try {
      result = await probeDef.probe(cleanUser, agent, fp.userAgent);
    } finally {
      agent?.destroy();
    }

    if (!result) {
      current = {
        ...current,
        status: 'not-found',
        candidatesInspected: 1,
        candidatesSkipped: 1,
        durationMs: Date.now() - startedAt,
        decisions: [
          {
            url: `${probeDef.platform}/${cleanUser}`,
            title: `${probeDef.platform} profil taraması`,
            channelOrDomain: probeDef.platform,
            decision: 'skipped-mismatch',
            reason: 'Kullanıcı bulunamadı veya profil mevcut değil',
            timestamp: new Date().toISOString(),
          },
        ],
        updatedAt: new Date().toISOString(),
      };
      onUpdateSession(current);
      return current;
    }

    let imageSimilarityPercent: number | null = null;
    if (referenceDHash && result.avatarUrl) {
      const avatarHash = await computeImageDHash(result.avatarUrl);
      if (avatarHash) {
        const dist = computeDHashHammingDistance(referenceDHash, avatarHash);
        imageSimilarityPercent = hammingToSimilarityPercent(dist, 64);
      }
    }

    const scored = scoreProfileMatch({
      targetUsername: cleanUser,
      foundUsername: result.usernameFound,
      displayName: result.displayName,
      bio: result.bio,
      clues,
      imageSimilarityPercent,
    });

    let screenshotUrl: string | null = null;
    if (config.captureProofScreenshot && scored.isExactTarget) {
      try {
        ensureProofsDir();
        const browser = await getSharedBrowser();
        const ctx = await browser.newContext({
          proxy: proxy ? { server: `${proxy.protocol}://${proxy.host}:${proxy.port}` } : undefined,
          userAgent: fp.userAgent,
          viewport: fp.viewport,
          ignoreHTTPSErrors: true,
        });
        try {
          const page = await ctx.newPage();
          await page.goto(result.profileUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
          const fileName = `${runId}-osint-${current.sessionIndex}.png`;
          await page.screenshot({ path: path.join(PROOFS_DIR, fileName), timeout: 7000 });
          screenshotUrl = `/api/proofs/${fileName}`;
        } finally {
          await closeContextSafely(ctx);
        }
      } catch {
        // Screenshot optional if proxy rejects Chromium CONNECT
      }
    }

    const hit: ProfileDiscoveryHit = {
      platform: probeDef.platform,
      profileUrl: result.profileUrl,
      usernameFound: result.usernameFound,
      displayName: result.displayName,
      bio: result.bio,
      avatarUrl: result.avatarUrl,
      httpStatus: result.httpStatus,
      clueMatches: scored.clueMatches,
      imageSimilarityPercent,
      confidenceScore: scored.confidenceScore,
      verifiedByExitIp: current.exitIp,
      sessionId: current.sessionId,
      screenshotUrl,
      isExactTarget: scored.isExactTarget,
    };

    onOsintHit(hit);

    current = {
      ...current,
      status: scored.isExactTarget ? 'matched' : 'not-found',
      candidatesInspected: 1,
      candidatesSkipped: scored.isExactTarget ? 0 : 1,
      matchedUrl: scored.isExactTarget ? result.profileUrl : null,
      resolvedTitle: result.displayName || result.usernameFound,
      httpStatus: result.httpStatus,
      screenshotUrl,
      durationMs: Date.now() - startedAt,
      decisions: [
        {
          url: result.profileUrl,
          title: result.displayName || result.usernameFound,
          channelOrDomain: probeDef.platform,
          decision: scored.isExactTarget ? 'clicked-exact-match' : 'skipped-mismatch',
          reason: scored.isExactTarget
            ? `Doğrulandı (%${scored.confidenceScore} güven${
                imageSimilarityPercent !== null ? `, %${imageSimilarityPercent} görsel benzerlik` : ''
              })`
            : `Eşleşme skoru yetersiz (%${scored.confidenceScore})`,
          timestamp: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    onUpdateSession(current);
    return current;
  } catch (err) {
    current = {
      ...current,
      status: 'proxy-error',
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : 'Platform tarama hatası',
      updatedAt: new Date().toISOString(),
    };
    onUpdateSession(current);
    return current;
  }
}
