import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import type { ProxyEndpoint } from '../../src/types/automation';
import type { CoherentSessionFingerprint } from '../../src/lib/fingerprintLayer';
import { injectCoherentFingerprintScript } from './fingerprintLayer';
import type { IsolatedProfileUnit } from './profilePoolLayer';
import { buildChromeAlignedHeaders } from './networkLayer';

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

/**
 * Launches Chromium with automation signals stripped (`--enable-automation` excluded,
 * `AutomationControlled` disabled) so the browser context layer aligns cleanly with
 * the fingerprint and network layers.
 */
export async function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowserPromise) {
    const executablePath = findChromiumExecutable();
    sharedBrowserPromise = chromium
      .launch({
        executablePath,
        headless: true,
        ignoreDefaultArgs: ['--enable-automation'],
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
          '--disable-infobars',
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

export async function createHardenedContext(params: {
  proxy: ProxyEndpoint | null;
  fingerprint: CoherentSessionFingerprint;
  profileUnit?: IsolatedProfileUnit;
}): Promise<BrowserContext> {
  const { proxy, fingerprint, profileUnit } = params;
  const browser = await getSharedBrowser();

  const proxyConfig = proxy
    ? {
        server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
      }
    : undefined;

  const useWarmState = profileUnit?.state === 'reused-warm' && fs.existsSync(profileUnit.storagePath);

  const context = await browser.newContext({
    proxy: proxyConfig,
    userAgent: fingerprint.userAgent,
    viewport: fingerprint.viewport,
    deviceScaleFactor: fingerprint.screen.pixelRatio,
    locale: fingerprint.locale,
    timezoneId: fingerprint.timezoneId,
    geolocation: fingerprint.geolocation,
    permissions: ['geolocation'],
    ignoreHTTPSErrors: true,
    ...(useWarmState ? { storageState: profileUnit.storagePath } : {}),
    extraHTTPHeaders: buildChromeAlignedHeaders(fingerprint),
  });

  await injectCoherentFingerprintScript(context, fingerprint);
  return context;
}

export async function closeContextSafely(context: BrowserContext): Promise<void> {
  await Promise.race([
    context.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ]);
}
