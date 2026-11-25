import type { ParsedProxyEndpoint, ProxyNetworkType, ProxyProtocol } from '../types/automation';
import {
  buildCoherentFingerprint,
  type CoherentSessionFingerprint,
  type ProxyGeoContext,
} from './fingerprintLayer';

const YOUTUBE_TRACKING_PARAMS = new Set([
  'si',
  'pp',
  'feature',
  'ab_channel',
  't',
  'start',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
]);

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  // Accept bare 11-char YouTube video IDs only if explicitly formatted as a YouTube URL
  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');

  if (host === 'youtu.be') {
    const seg = parsed.pathname.split('/').filter(Boolean)[0];
    return seg && /^[a-zA-Z0-9_-]{11}$/.test(seg) ? seg : null;
  }

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'music.youtube.com') {
    const vParam = parsed.searchParams.get('v');
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
      return vParam;
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live' || parts[0] === 'v')) {
      return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
    }
  }

  return null;
}

export function normalizeTargetUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  const ytId = extractYouTubeVideoId(trimmed);
  if (ytId) {
    return `https://www.youtube.com/watch?v=${ytId}`;
  }

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const cleanParams = new URLSearchParams();

    const entries = Array.from(url.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    for (const [key, val] of entries) {
      if (!YOUTUBE_TRACKING_PARAMS.has(key.toLowerCase())) {
        cleanParams.append(key, val);
      }
    }

    let pathname = url.pathname.replace(/\/+$/, '');
    if (!pathname) pathname = '';

    const query = cleanParams.toString();
    return `https://${hostname}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export interface TargetMatchResult {
  matched: boolean;
  matchType: 'youtube-id' | 'canonical-url' | 'mismatch';
  reason: string;
  candidateVideoId: string | null;
  targetVideoId: string | null;
}

export function isExactTargetMatch(candidateUrl: string, targetUrl: string): TargetMatchResult {
  const targetVideoId = extractYouTubeVideoId(targetUrl);
  const candidateVideoId = extractYouTubeVideoId(candidateUrl);

  if (targetVideoId) {
    if (candidateVideoId && candidateVideoId === targetVideoId) {
      return {
        matched: true,
        matchType: 'youtube-id',
        reason: `YouTube Video ID birebir eşleşti (${targetVideoId})`,
        candidateVideoId,
        targetVideoId,
      };
    }
    return {
      matched: false,
      matchType: 'mismatch',
      reason: candidateVideoId
        ? `Farklı Video ID (${candidateVideoId} != ${targetVideoId}) — asla açılmadı`
        : 'Hedef YouTube Video ID bulunamadı — asla açılmadı',
      candidateVideoId,
      targetVideoId,
    };
  }

  const normalizedTarget = normalizeTargetUrl(targetUrl);
  const normalizedCandidate = normalizeTargetUrl(candidateUrl);

  if (normalizedTarget && normalizedCandidate === normalizedTarget) {
    return {
      matched: true,
      matchType: 'canonical-url',
      reason: `Kanonik URL birebir eşleşti (${normalizedTarget})`,
      candidateVideoId,
      targetVideoId,
    };
  }

  return {
    matched: false,
    matchType: 'mismatch',
    reason: `URL hedefle uyuşmuyor (${normalizedCandidate}) — asla açılmadı`,
    candidateVideoId,
    targetVideoId,
  };
}

export function isDirectYouTubeWatchHref(rawHref: string, targetVideoId: string): boolean {
  const trimmed = rawHref.trim();
  if (!trimmed || !targetVideoId) return false;
  const lower = trimmed.toLowerCase();
  // Never click YouTube Mix/Radio playlists (e.g. list=RD...&start_radio=1) or Google ad redirect links
  if (
    lower.includes('list=rd') ||
    lower.includes('start_radio=') ||
    lower.includes('googleadservices.com') ||
    lower.includes('/pagead/') ||
    lower.includes('/aclk?')
  ) {
    return false;
  }
  const resolved = trimmed.startsWith('http')
    ? trimmed
    : trimmed.startsWith('/')
    ? `https://www.youtube.com${trimmed}`
    : `https://www.youtube.com/${trimmed}`;
  return extractYouTubeVideoId(resolved) === targetVideoId;
}

export function parseProxyLines(
  rawText: string,
  defaultProtocol: ProxyProtocol = 'http'
): ParsedProxyEndpoint[] {
  const results: ParsedProxyEndpoint[] = [];
  const seen = new Set<string>();

  const lines = rawText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    let protocol: ProxyProtocol = defaultProtocol;
    let body = line;

    const protoMatch = line.match(/^(https?|socks4|socks5):\/\/(.+)$/i);
    if (protoMatch) {
      protocol = protoMatch[1].toLowerCase() as ProxyProtocol;
      body = protoMatch[2];
    }

    // Strip any trailing comments or path
    body = body.split(/[\s/]/)[0];

    // Strip optional user:pass@ prefix if present
    const atIndex = body.lastIndexOf('@');
    const hostPort = atIndex >= 0 ? body.slice(atIndex + 1) : body;

    const colonIndex = hostPort.lastIndexOf(':');
    if (colonIndex <= 0) continue;

    const host = hostPort.slice(0, colonIndex).trim();
    const portStr = hostPort.slice(colonIndex + 1).trim();
    const port = Number.parseInt(portStr, 10);

    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    // Basic IPv4 or hostname validation
    const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
    const isHostname = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(host);
    if (!isIpv4 && !isHostname) continue;

    if (isIpv4) {
      const octets = host.split('.').map(Number);
      if (octets.some((o) => o < 0 || o > 255)) continue;
    }

    const dedupeKey = `${protocol}://${host}:${port}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    results.push({
      host,
      port,
      protocol,
      raw: dedupeKey,
    });
  }

  return results;
}

export function computeDHashHammingDistance(hashA: string, hashB: string): number {
  const len = Math.min(hashA.length, hashB.length);
  if (len === 0) return 64;
  let distance = 0;
  for (let i = 0; i < len; i++) {
    if (hashA[i] !== hashB[i]) {
      distance++;
    }
  }
  distance += Math.abs(hashA.length - hashB.length);
  return distance;
}

export function hammingToSimilarityPercent(distance: number, bitLength = 64): number {
  if (bitLength <= 0) return 0;
  const clamped = Math.max(0, Math.min(distance, bitLength));
  return Math.round(((bitLength - clamped) / bitLength) * 100);
}

export interface ProfileScoreInput {
  targetUsername: string;
  foundUsername: string;
  displayName: string | null;
  bio: string | null;
  clues: string[];
  imageSimilarityPercent: number | null;
}

export function scoreProfileMatch(input: ProfileScoreInput): {
  confidenceScore: number;
  clueMatches: string[];
  isExactTarget: boolean;
} {
  const normTarget = input.targetUsername.trim().replace(/^@/, '').toLowerCase();
  const normFound = input.foundUsername.trim().replace(/^@/, '').toLowerCase();

  let score = 0;
  if (normTarget && normFound === normTarget) {
    score += 50;
  } else if (normTarget && normFound.includes(normTarget)) {
    score += 30;
  }

  const haystack = `${input.foundUsername} ${input.displayName ?? ''} ${input.bio ?? ''}`.toLowerCase();
  const clueMatches: string[] = [];

  for (const rawClue of input.clues) {
    const clue = rawClue.trim().toLowerCase();
    if (clue.length >= 2 && haystack.includes(clue)) {
      clueMatches.push(rawClue.trim());
    }
  }

  if (input.clues.length > 0) {
    const clueRatio = clueMatches.length / input.clues.length;
    score += Math.round(clueRatio * 25);
  } else if (normTarget && normFound === normTarget) {
    score += 15;
  }

  if (input.imageSimilarityPercent !== null) {
    score += Math.round((input.imageSimilarityPercent / 100) * 25);
  } else if (normTarget && normFound === normTarget) {
    score += 10;
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  const isExactTarget =
    normFound === normTarget &&
    (input.imageSimilarityPercent === null || input.imageSimilarityPercent >= 68) &&
    (input.clues.length === 0 || clueMatches.length > 0 || clampedScore >= 75);

  return {
    confidenceScore: clampedScore,
    clueMatches,
    isExactTarget,
  };
}

export interface ParsedSearchCandidate {
  url: string;
  title: string;
  channelOrDomain: string;
  videoId: string | null;
}

export interface TargetMetadataHint {
  title?: string | null;
  author?: string | null;
}

function readTextRun(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return '';
  const rec = obj as {
    simpleText?: string;
    content?: string;
    runs?: Array<{ text?: string }>;
  };
  if (typeof rec.simpleText === 'string' && rec.simpleText.trim()) return rec.simpleText.trim();
  if (typeof rec.content === 'string' && rec.content.trim()) return rec.content.trim();
  if (Array.isArray(rec.runs)) {
    return rec.runs
      .map((r) => (typeof r?.text === 'string' ? r.text : ''))
      .join('')
      .trim();
  }
  return '';
}

export function extractYouTubeCandidatesFromJson(json: unknown): ParsedSearchCandidate[] {
  const candidates: ParsedSearchCandidate[] = [];
  const seenIds = new Set<string>();
  const stack: unknown[] = [json];

  const pushCandidate = (videoId: string, title: string, channel: string) => {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId) || seenIds.has(videoId)) return;
    seenIds.add(videoId);
    candidates.push({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: (title || `YouTube Video (${videoId})`).trim(),
      channelOrDomain: (channel || 'YouTube').trim(),
      videoId,
    });
  };

  while (stack.length > 0 && candidates.length < 120) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        stack.push(node[i]);
      }
      continue;
    }

    const record = node as Record<string, unknown>;

    // Never extract sponsored ads or YouTube Mix/Radio playlists as organic target matches
    if (
      record.adSlotRenderer ||
      record.promotedVideoRenderer ||
      record.promotedSparklesWebRenderer ||
      record.searchPyvRenderer ||
      record.radioRenderer ||
      record.inStreamAdLayoutRenderer
    ) {
      continue;
    }

    // Standard video renderers (videoRenderer, compactVideoRenderer, gridVideoRenderer, playlistVideoRenderer)
    const rendererKey = (
      ['videoRenderer', 'compactVideoRenderer', 'gridVideoRenderer', 'playlistVideoRenderer'] as const
    ).find((k) => record[k] && typeof record[k] === 'object');

    if (rendererKey) {
      const vr = record[rendererKey] as Record<string, unknown>;
      if (typeof vr.videoId === 'string') {
        const title =
          readTextRun(vr.title) ||
          readTextRun(vr.headline) ||
          `YouTube Video (${vr.videoId})`;
        const channel =
          readTextRun(vr.ownerText) ||
          readTextRun(vr.longBylineText) ||
          readTextRun(vr.shortBylineText) ||
          'YouTube';
        pushCandidate(vr.videoId, title, channel);
      }
    }

    // Modern YouTube Shorts shelf lockup
    const shortsLockup = record.shortsLockupViewModel as Record<string, unknown> | undefined;
    if (shortsLockup && typeof shortsLockup === 'object') {
      const onTap = shortsLockup.onTap as Record<string, any> | undefined;
      const vid =
        onTap?.innertubeCommand?.reelWatchEndpoint?.videoId ??
        onTap?.innertubeCommand?.watchEndpoint?.videoId;
      if (typeof vid === 'string') {
        const a11y =
          typeof shortsLockup.accessibilityText === 'string'
            ? shortsLockup.accessibilityText.split(',')[0].trim()
            : '';
        const primaryTitle = readTextRun(
          (shortsLockup.overlayMetadata as Record<string, unknown> | undefined)?.primaryText
        );
        pushCandidate(vid, primaryTitle || a11y || `YouTube Short (${vid})`, 'YouTube Shorts');
      }
    }

    // Modern YouTube lockupViewModel (skip Mix / Radio lockups whose playlistId starts with RD)
    const lockup = record.lockupViewModel as Record<string, unknown> | undefined;
    if (lockup && typeof lockup === 'object') {
      const contentType = typeof lockup.contentType === 'string' ? lockup.contentType : '';
      const contentId = typeof lockup.contentId === 'string' ? lockup.contentId : null;
      const rendererContext = lockup.rendererContext as Record<string, any> | undefined;
      const watchEndpoint = rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint;
      const playlistId = typeof watchEndpoint?.playlistId === 'string' ? watchEndpoint.playlistId : '';
      const isRadioMix = contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST' || playlistId.startsWith('RD');
      const watchVid = watchEndpoint?.videoId ?? contentId;
      if (!isRadioMix && typeof watchVid === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(watchVid)) {
        const md = lockup.metadata as Record<string, any> | undefined;
        const lockupMd = md?.lockupMetadataViewModel as Record<string, any> | undefined;
        const title = readTextRun(lockupMd?.title) || `YouTube Video (${watchVid})`;
        pushCandidate(watchVid, title, 'YouTube');
      }
    }

    // Direct watchEndpoint / videoId fallback inside organic item nodes (skip Mix endpoints)
    const directNavPlaylist = (record.navigationEndpoint as Record<string, any> | undefined)?.watchEndpoint
      ?.playlistId;
    if (
      typeof record.videoId === 'string' &&
      /^[a-zA-Z0-9_-]{11}$/.test(record.videoId) &&
      !(typeof directNavPlaylist === 'string' && directNavPlaylist.startsWith('RD')) &&
      !seenIds.has(record.videoId)
    ) {
      const title =
        readTextRun(record.title) ||
        readTextRun(record.headline) ||
        `YouTube Video (${record.videoId})`;
      const channel =
        readTextRun(record.ownerText) ||
        readTextRun(record.longBylineText) ||
        'YouTube';
      pushCandidate(record.videoId, title, channel);
    }

    const keys = Object.keys(record);
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];
      if (
        key === 'adSlotRenderer' ||
        key === 'promotedVideoRenderer' ||
        key === 'promotedSparklesWebRenderer' ||
        key === 'searchPyvRenderer' ||
        key === 'radioRenderer' ||
        key === 'inStreamAdLayoutRenderer'
      ) {
        continue;
      }
      const val = record[key];
      if (val && typeof val === 'object') {
        stack.push(val);
      }
    }
  }

  return candidates;
}

export function findContinuationTokenInJson(json: unknown): string | null {
  const stack: unknown[] = [json];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    const rec = node as Record<string, any>;
    const token = rec.continuationCommand?.token;
    if (typeof token === 'string' && token.length > 15) {
      return token;
    }
    for (const val of Object.values(rec)) {
      if (val && typeof val === 'object') stack.push(val);
    }
  }
  return null;
}

export function extractYouTubeSearchContext(html: string): {
  candidates: ParsedSearchCandidate[];
  continuationToken: string | null;
  apiKey: string | null;
  clientVersion: string | null;
} {
  const apiKey = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/)?.[1] ?? null;

  const initialDataMatch =
    html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) ??
    html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);

  let candidates: ParsedSearchCandidate[] = [];
  let continuationToken: string | null = null;

  if (initialDataMatch) {
    try {
      const json = JSON.parse(initialDataMatch[1]);
      candidates = extractYouTubeCandidatesFromJson(json);
      continuationToken = findContinuationTokenInJson(json);
    } catch {
      // Fallback to regex extraction below
    }
  }

  if (candidates.length === 0) {
    const regex = /\/watch\?v=([a-zA-Z0-9_-]{11})/g;
    const seenIds = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = regex.exec(html)) !== null && candidates.length < 40) {
      const id = m[1];
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      candidates.push({
        url: `https://www.youtube.com/watch?v=${id}`,
        title: `YouTube Video (${id})`,
        channelOrDomain: 'YouTube',
        videoId: id,
      });
    }
  }

  return {
    candidates,
    continuationToken,
    apiKey,
    clientVersion,
  };
}

export function extractYouTubeCandidatesFromHtml(html: string): ParsedSearchCandidate[] {
  return extractYouTubeSearchContext(html).candidates;
}

export function buildSearchQueriesForTarget(
  targetUrl: string,
  userQuery: string,
  metadata?: TargetMetadataHint
): string[] {
  const cleanRaw = userQuery.trim();
  const ytId = extractYouTubeVideoId(targetUrl);
  const queries: string[] = [];

  const pushUnique = (q: string | null | undefined) => {
    const normalized = (q ?? '').replace(/\s+/g, ' ').trim();
    if (normalized.length >= 2 && !queries.includes(normalized)) {
      queries.push(normalized);
    }
  };

  if (cleanRaw) {
    // Strip raw commas/pipes that hurt YouTube exact keyword matching while keeping natural keyword pairs
    const commaParts = cleanRaw
      .split(/[,;|]+/)
      .map((p) => p.trim())
      .filter(Boolean);

    if (commaParts.length > 1) {
      // Primary combined natural search without commas (dropping trailing generic "youtube" noise)
      const combinedClean = commaParts
        .map((p) => p.replace(/\byoutube\b/gi, '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();
      if (combinedClean) pushUnique(combinedClean);

      // Pair first two strongest clues (e.g. "Nutella Prowlj")
      if (commaParts[0] && commaParts[1]) {
        const cleanFirst = commaParts[0].replace(/\byoutube\b/gi, '').trim();
        const cleanSecond = commaParts[1].replace(/\byoutube\b/gi, '').trim();
        if (cleanFirst && cleanSecond) {
          pushUnique(`${cleanFirst} ${cleanSecond}`);
        }
      }
    } else {
      const cleanedSingle = ytId ? cleanRaw.replace(/\byoutube\b/gi, '').trim() : cleanRaw;
      pushUnique(cleanedSingle || cleanRaw);
    }
  }

  if (metadata?.title) {
    const cleanTitle = metadata.title.replace(/\s+/g, ' ').trim();
    const shortTitle = cleanTitle.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
    if (metadata.author) {
      const cleanAuthor = metadata.author.replace(/\s+/g, ' ').trim();
      const baseTitle = shortTitle || cleanTitle;
      if (!baseTitle.toLowerCase().includes(cleanAuthor.toLowerCase())) {
        pushUnique(`${cleanAuthor} ${baseTitle}`);
      }
    }
    if (shortTitle && shortTitle !== cleanTitle) {
      pushUnique(shortTitle);
    }
    pushUnique(cleanTitle);
  }

  if (ytId) {
    pushUnique(ytId);
    pushUnique(`"youtube.com/watch?v=${ytId}"`);
  } else if (queries.length === 0) {
    pushUnique(targetUrl);
  }

  return queries.slice(0, 5);
}

const DATACENTER_ISP_KEYWORDS = [
  'amazon',
  'aws',
  'google',
  'microsoft',
  'azure',
  'digitalocean',
  'hetzner',
  'ovh',
  'contabo',
  'vultr',
  'linode',
  'akamai',
  'choopa',
  'leaseweb',
  'alibaba',
  'tencent',
  'oracle',
  'm247',
  'datacamp',
  'tzulo',
  'cogent',
  'ionos',
  'scaleway',
  'rackspace',
  'cloudflare',
  'hostinger',
  'zenlayer',
  'datapacket',
  'quadranet',
  'server',
  'hosting',
  'datacenter',
  'cloud',
  'vps',
];

export function classifyNetworkType(
  hosting: boolean | undefined,
  isp: string | null | undefined,
  org: string | null | undefined
): ProxyNetworkType {
  const hay = `${isp ?? ''} ${org ?? ''}`.toLowerCase();
  if (hosting === true) return 'datacenter';
  if (DATACENTER_ISP_KEYWORDS.some((kw) => hay.includes(kw))) {
    return 'datacenter';
  }
  if (hosting === false && (isp || org)) {
    return 'residential-isp';
  }
  return 'unknown';
}

export type GeoMatchedFingerprint = CoherentSessionFingerprint;

export function pickGeoMatchedFingerprint(
  countryCode: string | null | undefined,
  sessionIndex: number,
  geoContext?: Omit<ProxyGeoContext, 'countryCode'>
): GeoMatchedFingerprint {
  return buildCoherentFingerprint(sessionIndex, {
    countryCode,
    timezone: geoContext?.timezone,
    lat: geoContext?.lat,
    lon: geoContext?.lon,
  });
}

export interface TrafficGateInspection {
  blocked: boolean;
  gateType: 'none' | 'consent' | 'signin-bot-check' | 'captcha-sorry' | 'rate-limit';
  reason: string | null;
}

export function detectTrafficGateFromPage(
  bodyText: string,
  pageUrl: string,
  pageTitle: string
): TrafficGateInspection {
  const lowerUrl = pageUrl.toLowerCase();
  const lowerTitle = pageTitle.toLowerCase();
  const lowerBody = bodyText.toLowerCase();

  if (
    lowerUrl.includes('google.com/sorry') ||
    lowerBody.includes('unusual traffic from your computer network') ||
    lowerBody.includes('bilgisayar ağınızdan gelen olağandışı trafik')
  ) {
    return {
      blocked: true,
      gateType: 'captcha-sorry',
      reason: 'Google olağandışı trafik / CAPTCHA doğrulama sayfası algılandı',
    };
  }

  if (
    lowerBody.includes("sign in to confirm you’re not a bot") ||
    lowerBody.includes("sign in to confirm you're not a bot") ||
    lowerBody.includes('confirm you are not a bot') ||
    lowerBody.includes('bot olmadığınızı doğrulamak için oturum açın') ||
    lowerBody.includes("connectez-vous pour confirmer que vous n'êtes pas un robot") ||
    lowerBody.includes('connectez-vous pour confirmer que vous n’êtes pas un robot') ||
    lowerBody.includes('melde dich an, um zu bestätigen, dass du kein bot bist') ||
    lowerBody.includes('melden sie sich an, um zu bestätigen, dass sie kein bot sind') ||
    lowerBody.includes('log in om te bevestigen dat je geen bot bent') ||
    lowerBody.includes('inicia sesión para confirmar que no eres un bot') ||
    lowerBody.includes('accedi per confermare che non sei un bot') ||
    lowerBody.includes('faça login para confirmar que não é um robô') ||
    lowerBody.includes('zaloguj się, by potwierdzić, że nie jesteś botem') ||
    lowerBody.includes('zaloguj się, aby potwierdzić, że nie jesteś botem') ||
    lowerBody.includes('přihlaste se, abyste potvrdili, že nejste robot') ||
    lowerBody.includes('conectează-te pentru a confirma că nu ești un bot') ||
    lowerBody.includes('jelentkezz be, hogy igazold, nem vagy robot') ||
    lowerBody.includes('войдите в аккаунт, чтобы подтвердить, что вы не робот') ||
    lowerBody.includes('войдите, чтобы подтвердить, что вы не робот') ||
    lowerBody.includes('увійдіть, щоб підтвердити, що ви не робот') ||
    lowerBody.includes('請登入以確認你並非機械人') ||
    lowerBody.includes('請登入以確認你不是機器人') ||
    lowerBody.includes('请登录以确认您不是机器人') ||
    lowerBody.includes('登录以确认你不是机器人') ||
    lowerBody.includes('bot ではないことを確認') ||
    lowerBody.includes('ロボットではないことを確認') ||
    lowerBody.includes('봇이 아님을 확인') ||
    lowerBody.includes('xác nhận bạn không phải là rô-bốt') ||
    lowerBody.includes('xác nhận bạn không phải là bot') ||
    lowerBody.includes('konfirmasi bahwa anda bukan bot')
  ) {
    return {
      blocked: true,
      gateType: 'signin-bot-check',
      reason: 'YouTube bot kontrolü / Google oturum doğrulaması istedi',
    };
  }

  if (
    lowerTitle.includes('429') ||
    lowerBody.includes('too many requests') ||
    lowerBody.includes('rate limit exceeded') ||
    lowerTitle.includes('403 forbidden') ||
    lowerTitle.includes('attention required') ||
    lowerBody.includes('checking your browser before accessing') ||
    lowerBody.includes('verify you are human')
  ) {
    return {
      blocked: true,
      gateType: 'rate-limit',
      reason: 'Hedef sunucu hız sınırı veya WAF engeli (HTTP 403/429) uyguladı',
    };
  }

  if (
    lowerUrl.includes('consent.youtube.com') ||
    lowerUrl.includes('consent.google.com') ||
    lowerBody.includes('bevor sie zu youtube weitergehen') ||
    lowerBody.includes('before you continue to youtube') ||
    lowerBody.includes("youtube'a devam etmeden önce") ||
    lowerBody.includes("avant d'accéder à youtube") ||
    lowerBody.includes('voordat je doorgaat naar youtube')
  ) {
    return {
      blocked: false,
      gateType: 'consent',
      reason: 'Çerez / GDPR onay penceresi algılandı',
    };
  }

  return {
    blocked: false,
    gateType: 'none',
    reason: null,
  };
}

export function isRetryableProxyErrorMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('enotfound') ||
    lower.includes('ehostunreach') ||
    lower.includes('hostunreachable') ||
    lower.includes('epipe') ||
    lower.includes('eproto') ||
    lower.includes('wrong version number') ||
    lower.includes('socket hang up') ||
    lower.includes('proxy connection') ||
    lower.includes('tcp connect timeout') ||
    lower.includes('socks4 proxy rejected') ||
    lower.includes('socks5 proxy rejected') ||
    lower.includes('err_proxy_connection_failed') ||
    lower.includes('err_tunnel_connection_failed') ||
    lower.includes('err_socks_connection_failed') ||
    lower.includes('err_connection_reset') ||
    lower.includes('err_connection_timed_out') ||
    lower.includes('err_connection_closed') ||
    lower.includes('err_name_not_resolved') ||
    lower.includes('err_ssl_protocol_error') ||
    lower.includes('net::err_') ||
    lower.includes('page.goto: timeout') ||
    lower.includes('socket closed') ||
    lower.includes('response aborted') ||
    lower.includes('request timeout') ||
    lower.includes('disconnected before secure tls') ||
    lower.includes('unexpected token') ||
    lower.includes('not valid json') ||
    lower.includes('remote_addr') ||
    lower.includes('proxy hedef yerine') ||
    lower.includes('http 403') ||
    lower.includes('http 429') ||
    lower.includes('bot-gate-detected')
  );
}

export function isQuarantineWorthyBlock(statusCode: number | null, trafficStatus: string): boolean {
  if (trafficStatus === 'bot-gate-detected') return true;
  if (statusCode === 403 || statusCode === 429) return true;
  return false;
}

export function safeJsonParse<T>(rawBody: string): T {
  const trimmed = rawBody.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    if (trimmed.includes('REMOTE_ADDR') || trimmed.includes('HTTP_')) {
      throw new Error('Proxy hedef yerine proxy-judge metni döndürdü (REMOTE_ADDR)');
    }
    throw new Error('Proxy hedef yerine geçersiz JSON yanıtı döndürdü');
  }
  return JSON.parse(trimmed) as T;
}

export function clampMinWatchSeconds(value: unknown, fallback = 60): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(300, Math.round(num)));
}

export function formatClockSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function computePlaybackAdvance(
  prevTime: number | null,
  nextTime: number | null,
  paused: boolean,
  readyState: number
): number {
  if (paused || readyState < 2) return 0;
  if (
    typeof prevTime !== 'number' ||
    typeof nextTime !== 'number' ||
    !Number.isFinite(prevTime) ||
    !Number.isFinite(nextTime)
  ) {
    return 0;
  }
  const delta = nextTime - prevTime;
  if (delta <= 0) return 0;
  return Math.min(delta, 5);
}

export function isYouTubeWatchTelemetryUrl(rawUrl: string): boolean {
  const lower = rawUrl.toLowerCase();
  return (
    lower.includes('youtube.com/api/stats/watchtime') ||
    lower.includes('youtube.com/api/stats/playback') ||
    lower.includes('youtube.com/ptracking')
  );
}

export function computeHumanizedWatchTarget(
  minWatchSeconds: number,
  sessionIndex: number,
  enabled: boolean
): number {
  const base = clampMinWatchSeconds(minWatchSeconds, 60);
  if (base <= 0 || !enabled) return base;
  // Deterministic 4..21s extra dwell curve per session so exits never cluster on exact second
  const jitter = 4 + ((Math.max(1, sessionIndex) * 7) % 18);
  return Math.min(300, base + jitter);
}

export function buildRankTrendSeries(
  runs: Array<{
    id: string;
    createdAt: string;
    resolvedTargetTitle?: string | null;
    config: { mode: string; targetUrl: string; username: string };
    totalSessionsPlanned: number;
    matchedSessionsCount: number;
    sessions: Array<{
      status: string;
      foundAtRank?: number | null;
      watchtimePingCount?: number;
      networkType?: string;
    }>;
  }>
): Array<{
  runId: string;
  createdAt: string;
  targetLabel: string;
  matchedCount: number;
  totalCount: number;
  matchRatePercent: number;
  bestRank: number | null;
  avgRank: number | null;
  telemetryPingSessions: number;
  telemetryRatePercent: number;
  ispMatchedCount: number;
}> {
  return [...runs]
    .slice(0, 12)
    .reverse()
    .map((run) => {
      const totalCount = Math.max(1, run.totalSessionsPlanned || run.sessions.length || 1);
      const matched = run.sessions.filter((s) => s.status === 'matched');
      const matchedCount = run.matchedSessionsCount || matched.length;
      const ranks = matched
        .map((s) => s.foundAtRank)
        .filter((r): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0);
      const bestRank = ranks.length > 0 ? Math.min(...ranks) : null;
      const avgRank =
        ranks.length > 0 ? Math.round(ranks.reduce((sum, r) => sum + r, 0) / ranks.length) : null;
      const telemetryPingSessions = matched.filter(
        (s) => typeof s.watchtimePingCount === 'number' && s.watchtimePingCount > 0
      ).length;
      const ispMatchedCount = matched.filter((s) => s.networkType === 'residential-isp').length;

      return {
        runId: run.id,
        createdAt: run.createdAt,
        targetLabel:
          run.resolvedTargetTitle ||
          (run.config.mode === 'exact-link' ? run.config.targetUrl : `@${run.config.username}`),
        matchedCount,
        totalCount,
        matchRatePercent: Math.round((matchedCount / totalCount) * 100),
        bestRank,
        avgRank,
        telemetryPingSessions,
        telemetryRatePercent:
          matchedCount > 0 ? Math.round((telemetryPingSessions / matchedCount) * 100) : 0,
        ispMatchedCount,
      };
    });
}
