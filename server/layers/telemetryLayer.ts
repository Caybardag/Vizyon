import type { Page } from 'playwright-core';
import {
  detectTrafficGateFromPage,
  isYouTubeWatchTelemetryUrl,
  type TrafficGateInspection,
} from '../../src/lib/targetMatcher';

export interface SessionTelemetryTracker {
  watchtimePingCount: number;
  lastWatchtimePingStatus: number | null;
  blockedHttpStatus: number | null;
  blockedHttpUrl: string | null;
  detach: () => void;
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

/**
 * Attaches passive telemetry listeners to capture YouTube watchtime/playback pings
 * and detect HTTP 403/429 WAF/rate-limit blocks on the target host.
 */
export function attachSessionTelemetry(page: Page, targetHostHint: string): SessionTelemetryTracker {
  const tracker: SessionTelemetryTracker = {
    watchtimePingCount: 0,
    lastWatchtimePingStatus: null,
    blockedHttpStatus: null,
    blockedHttpUrl: null,
    detach: () => undefined,
  };

  const onResponse = (res: { url: () => string; status: () => number; request: () => { resourceType: () => string } }) => {
    try {
      const url = res.url();
      const status = res.status();
      if (isYouTubeWatchTelemetryUrl(url) && status >= 200 && status < 400) {
        tracker.watchtimePingCount++;
        tracker.lastWatchtimePingStatus = status;
      }

      if (status === 403 || status === 429) {
        const resType = res.request().resourceType();
        if (resType === 'document' && (!targetHostHint || url.toLowerCase().includes(targetHostHint))) {
          tracker.blockedHttpStatus = status;
          tracker.blockedHttpUrl = url;
        }
      }
    } catch {
      // Ignore response listener errors
    }
  };

  page.on('response', onResponse);
  tracker.detach = () => {
    page.off('response', onResponse);
  };
  return tracker;
}

export async function inspectLiveTrafficGate(
  page: Page,
  fallbackTitle: string,
  telemetry?: SessionTelemetryTracker
): Promise<{ gate: TrafficGateInspection; bodyText: string; liveTitle: string }> {
  if (telemetry?.blockedHttpStatus === 403 || telemetry?.blockedHttpStatus === 429) {
    return {
      gate: {
        blocked: true,
        gateType: 'rate-limit',
        reason: `Hedef sunucu HTTP ${telemetry.blockedHttpStatus} engeli döndürdü (otomatik profil/IP rotasyonu)`,
      },
      bodyText: '',
      liveTitle: fallbackTitle,
    };
  }

  const domSnap = await withHardTimeout(
    page.evaluate(() => {
      const playerLoginWall = Boolean(
        document.querySelector(
          '#movie_player .ytp-error a[href*="ServiceLogin"], yt-player-error-message-renderer a[href*="ServiceLogin"], #error-screen a[href*="ServiceLogin"], #movie_player .ytp-error a[href*="3037019"], yt-player-error-message-renderer a[href*="3037019"]'
        )
      );
      return {
        bodyText: document.body?.innerText?.slice(0, 3000) || '',
        url: location.href,
        title: document.title || '',
        playerLoginWall,
      };
    }),
    2500,
    'gate-eval-timeout'
  ).catch(() => ({
    bodyText: '',
    url: page.url(),
    title: fallbackTitle,
    playerLoginWall: false,
  }));

  const liveTitle = (domSnap.title || fallbackTitle).trim();
  const textGate = detectTrafficGateFromPage(domSnap.bodyText, domSnap.url, liveTitle);
  if (!textGate.blocked && domSnap.playerLoginWall) {
    return {
      gate: {
        blocked: true,
        gateType: 'signin-bot-check',
        reason: 'YouTube bot kontrolü / Google oturum doğrulaması istedi',
      },
      bodyText: domSnap.bodyText,
      liveTitle,
    };
  }

  return {
    gate: textGate,
    bodyText: domSnap.bodyText,
    liveTitle,
  };
}
