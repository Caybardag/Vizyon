import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYouTubeVideoId,
  normalizeTargetUrl,
  isExactTargetMatch,
  parseProxyLines,
  computeDHashHammingDistance,
  hammingToSimilarityPercent,
  scoreProfileMatch,
  extractYouTubeCandidatesFromHtml,
  extractYouTubeSearchContext,
  buildSearchQueriesForTarget,
  classifyNetworkType,
  pickGeoMatchedFingerprint,
  detectTrafficGateFromPage,
  isRetryableProxyErrorMessage,
  safeJsonParse,
} from './targetMatcher';

test('extractYouTubeVideoId extracts 11-char IDs from all YouTube URL formats', () => {
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc123'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), 'dQw4w9WgXcQ');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/shorts/9bZkp7q19f0'), '9bZkp7q19f0');
  assert.equal(extractYouTubeVideoId('https://www.youtube.com/embed/jNQXAC9IVRw'), 'jNQXAC9IVRw');
  assert.equal(extractYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
});

test('isExactTargetMatch only clicks exact matching video or canonical URL and rejects others', () => {
  const target = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s';

  const exact = isExactTargetMatch('https://youtu.be/dQw4w9WgXcQ?si=xyz', target);
  assert.equal(exact.matched, true);
  assert.equal(exact.matchType, 'youtube-id');

  const wrongVideo = isExactTargetMatch('https://www.youtube.com/watch?v=9bZkp7q19f0', target);
  assert.equal(wrongVideo.matched, false);
  assert.equal(wrongVideo.matchType, 'mismatch');

  const webTarget = 'https://github.com/torvalds/linux/?utm_source=test';
  assert.equal(
    isExactTargetMatch('http://www.github.com/torvalds/linux', webTarget).matched,
    true
  );
  assert.equal(
    isExactTargetMatch('https://github.com/torvalds/subsurface', webTarget).matched,
    false
  );
});

test('normalizeTargetUrl strips tracking parameters and trailing slashes', () => {
  assert.equal(
    normalizeTargetUrl('http://www.example.com/path/?utm_source=foo&id=42&si=bar/'),
    'https://example.com/path?id=42'
  );
  assert.equal(
    normalizeTargetUrl('https://example.com/article/?utm_medium=social'),
    'https://example.com/article'
  );
});

test('parseProxyLines parses mixed protocols, deduplicates, and rejects invalid lines', () => {
  const raw = `
    # comment line
    192.168.1.10:8080
    socks5://45.12.34.56:1080
    http://45.12.34.56:80
    socks4://99.88.77.66:4145
    192.168.1.10:8080
    999.1.1.1:8080
    not-a-proxy
    10.0.0.1:99999
  `;
  const parsed = parseProxyLines(raw, 'http');
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].raw, 'http://192.168.1.10:8080');
  assert.equal(parsed[1].raw, 'socks5://45.12.34.56:1080');
  assert.equal(parsed[2].raw, 'http://45.12.34.56:80');
  assert.equal(parsed[3].raw, 'socks4://99.88.77.66:4145');
});

test('perceptual dHash Hamming distance and similarity percent are accurate', () => {
  const h1 = '10101010'.repeat(8);
  const h2 = '10101010'.repeat(8);
  const h3 = '01010101'.repeat(8);
  assert.equal(computeDHashHammingDistance(h1, h2), 0);
  assert.equal(hammingToSimilarityPercent(0, 64), 100);
  assert.equal(computeDHashHammingDistance(h1, h3), 64);
  assert.equal(hammingToSimilarityPercent(64, 64), 0);
  assert.equal(hammingToSimilarityPercent(16, 64), 75);
});

test('scoreProfileMatch rewards exact username, clues, and image similarity', () => {
  const res = scoreProfileMatch({
    targetUsername: '@torvalds',
    foundUsername: 'torvalds',
    displayName: 'Linus Torvalds',
    bio: 'Creator of Linux and Git in Portland',
    clues: ['Linux', 'Portland'],
    imageSimilarityPercent: 92,
  });
  assert.equal(res.clueMatches.length, 2);
  assert.equal(res.isExactTarget, true);
  assert.ok(res.confidenceScore >= 90);
});

test('extractYouTubeCandidatesFromHtml extracts videoRenderer, shortsLockupViewModel, lockupViewModel, and continuation token', () => {
  const fakeHtml = `<html><script>var ytInitialData = {"contents":{"a":[{"videoRenderer":{"videoId":"dQw4w9WgXcQ","title":{"runs":[{"text":"Target Video"}]},"ownerText":{"runs":[{"text":"Official"}]}}},{"shortsLockupViewModel":{"accessibilityText":"Quick Nutella Short, 100 views","onTap":{"innertubeCommand":{"reelWatchEndpoint":{"videoId":"short123456"}}}}},{"lockupViewModel":{"contentId":"lockup12345","metadata":{"lockupMetadataViewModel":{"title":{"content":"Modern Lockup Video"}}}}},{"continuationItemRenderer":{"continuationEndpoint":{"continuationCommand":{"token":"CONT_TOKEN_SAMPLE_1234567890"}}}}]}};</script><script>"INNERTUBE_API_KEY":"AIzaTestKey123","INNERTUBE_CLIENT_VERSION":"2.20261123"</script></html>`;
  const ctx = extractYouTubeSearchContext(fakeHtml);
  assert.equal(ctx.candidates.length, 3);
  assert.equal(ctx.candidates[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(ctx.candidates[1].videoId, 'short123456');
  assert.equal(ctx.candidates[2].videoId, 'lockup12345');
  assert.equal(ctx.candidates[2].title, 'Modern Lockup Video');
  assert.equal(ctx.continuationToken, 'CONT_TOKEN_SAMPLE_1234567890');
  assert.equal(ctx.apiKey, 'AIzaTestKey123');
});

test('buildSearchQueriesForTarget splits comma-separated queries and enriches with target metadata', () => {
  const queries = buildSearchQueriesForTarget(
    'https://www.youtube.com/watch?v=u0bX9TvP_WI',
    'Nutella ,Prowlj, PROWLJ music youtube',
    { title: 'PROWLJ - NUTELLA ( Strip Club Trap Type Beat)', author: 'ProwLJ' }
  );
  assert.ok(queries.some((q) => q === 'Nutella Prowlj PROWLJ music'));
  assert.ok(queries.some((q) => q === 'Nutella Prowlj'));
  assert.ok(queries.some((q) => q.includes('PROWLJ - NUTELLA')));
  assert.equal(queries[queries.length - 1], 'u0bX9TvP_WI');
});

test('classifyNetworkType and pickGeoMatchedFingerprint match residential vs datacenter and country locales', () => {
  assert.equal(classifyNetworkType(false, 'Comunicación por Fibra SA de CV', 'Fibra'), 'residential-isp');
  assert.equal(classifyNetworkType(true, 'Google LLC', 'Google'), 'datacenter');
  assert.equal(classifyNetworkType(undefined, 'Hetzner Online GmbH', null), 'datacenter');

  const deFp = pickGeoMatchedFingerprint('DE', 0);
  assert.equal(deFp.locale, 'de-DE');
  assert.equal(deFp.timezoneId, 'Europe/Berlin');

  const mxFp = pickGeoMatchedFingerprint('MX', 1);
  assert.equal(mxFp.locale, 'es-MX');
  assert.equal(mxFp.timezoneId, 'America/Mexico_City');
});

test('detectTrafficGateFromPage distinguishes consent, bot sign-in gate, sorry page, and clean traffic', () => {
  assert.equal(
    detectTrafficGateFromPage('Bevor Sie zu YouTube weitergehen', 'https://www.youtube.com/watch?v=123', 'YouTube').gateType,
    'consent'
  );
  assert.equal(
    detectTrafficGateFromPage("Sign in to confirm you're not a bot", 'https://www.youtube.com/watch?v=123', 'YouTube').blocked,
    true
  );
  assert.equal(
    detectTrafficGateFromPage(
      "Connectez-vous pour confirmer que vous n'êtes pas un robot",
      'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      'Me at the zoo - YouTube'
    ).gateType,
    'signin-bot-check'
  );
  assert.equal(
    detectTrafficGateFromPage('Our systems have detected unusual traffic', 'https://www.google.com/sorry/index', 'Sorry').gateType,
    'captcha-sorry'
  );
  assert.equal(
    detectTrafficGateFromPage('Me at the zoo - 19 seconds', 'https://www.youtube.com/watch?v=jNQXAC9IVRw', 'Me at the zoo - YouTube').gateType,
    'none'
  );
});

test('isRetryableProxyErrorMessage and safeJsonParse catch dead/proxy-judge proxies', () => {
  assert.equal(isRetryableProxyErrorMessage('connect ECONNREFUSED 78.142.217.197:1080'), true);
  assert.equal(isRetryableProxyErrorMessage('connect ETIMEDOUT 78.40.198.4:8443'), true);
  assert.equal(isRetryableProxyErrorMessage('socket hang up'), true);
  assert.equal(isRetryableProxyErrorMessage('Proxy connection ended before receiving CONNECT response'), true);
  assert.equal(isRetryableProxyErrorMessage('write EPROTO C09C80A8877F0000:error:0A00010B:SSL routines:tls_validate_record_header:wrong version number'), true);
  assert.equal(isRetryableProxyErrorMessage('Socks5 proxy rejected connection - HostUnreachable'), true);
  assert.equal(isRetryableProxyErrorMessage('Socks5 proxy rejected connection - NetworkUnreachable'), true);
  assert.equal(isRetryableProxyErrorMessage('Socks4 Proxy rejected connection - (Failed)'), true);
  assert.equal(isRetryableProxyErrorMessage('Görev kullanıcı tarafından durduruldu'), false);

  assert.throws(
    () => safeJsonParse('REMOTE_ADDR = 52.56.143.248'),
    /proxy-judge/
  );
  assert.deepEqual(safeJsonParse<{ ok: boolean }>('{"ok":true}'), { ok: true });
});

import {
  clampMinWatchSeconds,
  computePlaybackAdvance,
  formatClockSeconds,
  isYouTubeWatchTelemetryUrl,
  computeHumanizedWatchTarget,
  buildRankTrendSeries,
} from './targetMatcher';

test('clampMinWatchSeconds, formatClockSeconds, and computePlaybackAdvance validate real playback progress', () => {
  assert.equal(clampMinWatchSeconds(undefined), 60);
  assert.equal(clampMinWatchSeconds(60), 60);
  assert.equal(clampMinWatchSeconds(-5), 0);
  assert.equal(clampMinWatchSeconds(999), 300);

  assert.equal(formatClockSeconds(0), '0:00');
  assert.equal(formatClockSeconds(65), '1:05');
  assert.equal(formatClockSeconds(207), '3:27');
  assert.equal(formatClockSeconds(null), '—');

  assert.equal(computePlaybackAdvance(0, 0, false, 4), 0);
  assert.equal(computePlaybackAdvance(0, 2, true, 4), 0);
  assert.equal(computePlaybackAdvance(0, 2, false, 1), 0);
  assert.equal(computePlaybackAdvance(4, 6.2, false, 4), 2.2);
  assert.equal(computePlaybackAdvance(10, 80, false, 4), 5);
});

test('isYouTubeWatchTelemetryUrl, computeHumanizedWatchTarget, and buildRankTrendSeries compute real telemetry and trend metrics', () => {
  assert.equal(
    isYouTubeWatchTelemetryUrl('https://www.youtube.com/api/stats/watchtime?ns=yt&el=detailpage'),
    true
  );
  assert.equal(
    isYouTubeWatchTelemetryUrl('https://www.youtube.com/api/stats/playback?ver=2'),
    true
  );
  assert.equal(isYouTubeWatchTelemetryUrl('https://www.youtube.com/ptracking?video_id=123'), true);
  assert.equal(isYouTubeWatchTelemetryUrl('https://www.youtube.com/s/player/base.js'), false);

  assert.equal(computeHumanizedWatchTarget(0, 1, true), 0);
  assert.equal(computeHumanizedWatchTarget(60, 1, false), 60);
  const h1 = computeHumanizedWatchTarget(60, 1, true);
  const h2 = computeHumanizedWatchTarget(60, 2, true);
  assert.ok(h1 >= 64 && h1 <= 81);
  assert.ok(h2 >= 64 && h2 <= 81);
  assert.notEqual(h1, h2);
  assert.equal(computeHumanizedWatchTarget(295, 3, true), 300);

  const series = buildRankTrendSeries([
    {
      id: 'run-newer',
      createdAt: '2026-11-25T10:00:00.000Z',
      resolvedTargetTitle: 'Target Video',
      config: { mode: 'exact-link', targetUrl: 'https://youtube.com/watch?v=abc', username: '' },
      totalSessionsPlanned: 4,
      matchedSessionsCount: 3,
      sessions: [
        { status: 'matched', foundAtRank: 4, watchtimePingCount: 3, networkType: 'residential-isp' },
        { status: 'matched', foundAtRank: 2, watchtimePingCount: 2, networkType: 'residential-isp' },
        { status: 'matched', foundAtRank: 6, watchtimePingCount: 0, networkType: 'datacenter' },
        { status: 'not-found', foundAtRank: null, watchtimePingCount: 0, networkType: 'datacenter' },
      ],
    },
    {
      id: 'run-older',
      createdAt: '2026-11-24T10:00:00.000Z',
      resolvedTargetTitle: 'Target Video',
      config: { mode: 'exact-link', targetUrl: 'https://youtube.com/watch?v=abc', username: '' },
      totalSessionsPlanned: 2,
      matchedSessionsCount: 1,
      sessions: [
        { status: 'matched', foundAtRank: 12, watchtimePingCount: 1, networkType: 'datacenter' },
        { status: 'proxy-error', foundAtRank: null, watchtimePingCount: 0, networkType: 'datacenter' },
      ],
    },
  ]);

  assert.equal(series.length, 2);
  assert.equal(series[0].runId, 'run-older');
  assert.equal(series[0].bestRank, 12);
  assert.equal(series[1].runId, 'run-newer');
  assert.equal(series[1].bestRank, 2);
  assert.equal(series[1].avgRank, 4);
  assert.equal(series[1].matchRatePercent, 75);
  assert.equal(series[1].telemetryPingSessions, 2);
  assert.equal(series[1].telemetryRatePercent, 67);
  assert.equal(series[1].ispMatchedCount, 2);
});

import { isDirectYouTubeWatchHref } from './targetMatcher';

test('isDirectYouTubeWatchHref rejects YouTube Mix/Radio, ad redirects, and wrong video IDs', () => {
  assert.equal(isDirectYouTubeWatchHref('/watch?v=E4tAzCROfko&pp=ygUIdGVzdA%3D%3D', 'E4tAzCROfko'), true);
  assert.equal(isDirectYouTubeWatchHref('https://www.youtube.com/shorts/E4tAzCROfko', 'E4tAzCROfko'), true);
  assert.equal(
    isDirectYouTubeWatchHref('/watch?v=E4tAzCROfko&list=RDE4tAzCROfko&start_radio=1', 'E4tAzCROfko'),
    false
  );
  assert.equal(
    isDirectYouTubeWatchHref('/watch?v=BLACKPINK11&list=RDE4tAzCROfko&start_radio=1', 'E4tAzCROfko'),
    false
  );
  assert.equal(
    isDirectYouTubeWatchHref('https://www.googleadservices.com/pagead/aclk?v=E4tAzCROfko', 'E4tAzCROfko'),
    false
  );
  assert.equal(isDirectYouTubeWatchHref('/watch?v=OTHERVIDEO1', 'E4tAzCROfko'), false);
});

test('extractYouTubeCandidatesFromHtml skips ad renderers, radioRenderer mixes, and RD mix lockups', () => {
  const fakeHtml = `<html><script>var ytInitialData = {"contents":{"a":[
    {"adSlotRenderer":{"videoId":"AdVideo12345"}},
    {"promotedVideoRenderer":{"videoId":"Promo123456"}},
    {"radioRenderer":{"playlistId":"RDE4tAzCROfko","videos":[{"childVideoRenderer":{"videoId":"E4tAzCROfko"}}]}},
    {"lockupViewModel":{"contentId":"RDE4tAzCROfko","contentType":"LOCKUP_CONTENT_TYPE_PLAYLIST","metadata":{"lockupMetadataViewModel":{"title":{"content":"Mix - Target"}}}}},
    {"videoRenderer":{"videoId":"E4tAzCROfko","title":{"runs":[{"text":"Real Target Video"}]}}}
  ]}};</script></html>`;
  const ctx = extractYouTubeSearchContext(fakeHtml);
  assert.equal(ctx.candidates.length, 1);
  assert.equal(ctx.candidates[0].videoId, 'E4tAzCROfko');
  assert.equal(ctx.candidates[0].title, 'Real Target Video');
});

test('detectTrafficGateFromPage catches Polish and Chinese bot-login gates and isRetryableProxyErrorMessage catches Playwright net errors', () => {
  assert.equal(
    detectTrafficGateFromPage(
      'Zaloguj się, by potwierdzić, że nie jesteś botem. Pomaga to chronić naszą społeczność.',
      'https://www.youtube.com/watch?v=E4tAzCROfko',
      'YouTube'
    ).gateType,
    'signin-bot-check'
  );
  assert.equal(
    detectTrafficGateFromPage(
      '請登入以確認你並非機械人 登入',
      'https://www.youtube.com/watch?v=E4tAzCROfko',
      'YouTube'
    ).gateType,
    'signin-bot-check'
  );
  assert.equal(isRetryableProxyErrorMessage('page.goto: net::ERR_PROXY_CONNECTION_FAILED at https://www.youtube.com/'), true);
  assert.equal(isRetryableProxyErrorMessage('page.goto: Timeout 18000ms exceeded.'), true);
  assert.equal(isRetryableProxyErrorMessage('net::ERR_TUNNEL_CONNECTION_FAILED'), true);
});

