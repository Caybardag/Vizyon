import type { BrowserContext } from 'playwright-core';
import {
  auditFingerprintConsistency,
  buildCoherentFingerprint,
  type CoherentSessionFingerprint,
  type ProxyGeoContext,
} from '../../src/lib/fingerprintLayer';

export { auditFingerprintConsistency, buildCoherentFingerprint, type CoherentSessionFingerprint };

export function createSessionFingerprint(
  seedKey: string | number,
  geoContext?: ProxyGeoContext
): CoherentSessionFingerprint {
  return buildCoherentFingerprint(seedKey, geoContext);
}

/**
 * Injects coherent, cross-layer browser fingerprint properties so UA, navigator.platform,
 * UserAgentData Client Hints, WebGL vendor/renderer, hardware specs, screen metrics,
 * and languages never contradict one another.
 */
export async function injectCoherentFingerprintScript(
  context: BrowserContext,
  fp: CoherentSessionFingerprint
): Promise<void> {
  const payload = {
    platform: fp.platform,
    uaPlatform: fp.uaPlatform,
    uaPlatformVersion: fp.uaPlatformVersion,
    architecture: fp.architecture,
    bitness: fp.bitness,
    chromeMajor: fp.chromeMajor,
    languages: fp.languages,
    hardwareConcurrency: fp.hardwareConcurrency,
    deviceMemory: fp.deviceMemory,
    webglVendor: fp.webglVendor,
    webglRenderer: fp.webglRenderer,
    screen: fp.screen,
  };

  await context.addInitScript((cfg) => {
    try {
      // Mask automation flag
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'platform', { get: () => cfg.platform });
      Object.defineProperty(navigator, 'languages', { get: () => cfg.languages });
      Object.defineProperty(navigator, 'language', { get: () => cfg.languages[0] || 'en-US' });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cfg.hardwareConcurrency });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => cfg.deviceMemory });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        ],
      });

      // Coherent User-Agent Client Hints (navigator.userAgentData)
      const brands = [
        { brand: 'Google Chrome', version: cfg.chromeMajor },
        { brand: 'Chromium', version: cfg.chromeMajor },
        { brand: 'Not_A Brand', version: '24' },
      ];
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands,
          mobile: false,
          platform: cfg.uaPlatform,
          toJSON: () => ({ brands, mobile: false, platform: cfg.uaPlatform }),
          getHighEntropyValues: async () => ({
            architecture: cfg.architecture,
            bitness: cfg.bitness,
            brands,
            mobile: false,
            model: '',
            platform: cfg.uaPlatform,
            platformVersion: cfg.uaPlatformVersion,
            uaFullVersion: `${cfg.chromeMajor}.0.0.0`,
          }),
        }),
      });

      // Coherent screen geometry matching OS/device profile
      Object.defineProperty(screen, 'width', { get: () => cfg.screen.width });
      Object.defineProperty(screen, 'height', { get: () => cfg.screen.height });
      Object.defineProperty(screen, 'availWidth', { get: () => cfg.screen.width });
      Object.defineProperty(screen, 'availHeight', { get: () => cfg.screen.availHeight });
      Object.defineProperty(screen, 'colorDepth', { get: () => cfg.screen.colorDepth });
      Object.defineProperty(screen, 'pixelDepth', { get: () => cfg.screen.colorDepth });

      // Coherent WebGL Vendor & Renderer matching OS GPU stack
      const patchWebGL = (proto: WebGLRenderingContext | WebGL2RenderingContext | undefined) => {
        if (!proto || typeof proto.getParameter !== 'function') return;
        const origGetParameter = proto.getParameter;
        proto.getParameter = function (parameter: number) {
          if (parameter === 37445) return cfg.webglVendor; // UNMASKED_VENDOR_WEBGL
          if (parameter === 37446) return cfg.webglRenderer; // UNMASKED_RENDERER_WEBGL
          return origGetParameter.apply(this, arguments as unknown as [number]);
        };
      };
      if (typeof WebGLRenderingContext !== 'undefined') {
        patchWebGL(WebGLRenderingContext.prototype);
      }
      if (typeof WebGL2RenderingContext !== 'undefined') {
        patchWebGL(WebGL2RenderingContext.prototype);
      }

      // Clean window.chrome presence
      if (!(window as unknown as { chrome?: unknown }).chrome) {
        (window as unknown as { chrome?: unknown }).chrome = {
          runtime: {},
          loadTimes: () => ({}),
          csi: () => ({}),
        };
      }
    } catch {
      // Non-fatal init script guard
    }
  }, payload);
}
