export type ProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5';

export type ProxyHealthStatus = 'verified' | 'checking' | 'failed' | 'untested';

export type ProxyNetworkType = 'residential-isp' | 'datacenter' | 'unknown';

export interface ProxyEndpoint {
  id: string;
  host: string;
  port: number;
  protocol: ProxyProtocol;
  source: string;
  status: ProxyHealthStatus;
  exitIp: string | null;
  country: string | null;
  countryCode: string | null;
  timezone?: string | null;
  lat?: number | null;
  lon?: number | null;
  isp: string | null;
  networkType?: ProxyNetworkType;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  errorMessage?: string;
}

export interface HarvestProgress {
  running: boolean;
  phase: 'idle' | 'fetching-feeds' | 'probing' | 'completed' | 'stopped';
  fetchedCount: number;
  probedCount: number;
  verifiedUniqueCount: number;
  targetUniqueCount: number;
  currentFeed: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type TargetMode = 'exact-link' | 'identity-osint';

export type MatchDecisionType = 'clicked-exact-match' | 'skipped-mismatch' | 'skipped-duplicate';

export interface CandidateDecision {
  url: string;
  title: string;
  channelOrDomain: string;
  videoId?: string | null;
  pageNumber?: number;
  rank?: number;
  decision: MatchDecisionType;
  reason: string;
  timestamp: string;
}

export type SessionStatus =
  | 'queued'
  | 'initializing'
  | 'searching'
  | 'navigating-match'
  | 'watching'
  | 'matched'
  | 'not-found'
  | 'proxy-error';

export type PlaybackStatus = 'idle' | 'playing' | 'completed' | 'stalled' | 'blocked' | 'no-video';

export type ProfileWarmupState = 'cold' | 'warmed' | 'reused-warm' | 'quarantined';

export interface SessionExecution {
  sessionId: string;
  sessionIndex: number;
  proxyId: string;
  proxyAddress: string;
  protocol: ProxyProtocol;
  exitIp: string;
  country: string | null;
  countryCode?: string | null;
  networkType?: ProxyNetworkType;
  userAgent: string;
  locale: string;
  timezoneId?: string;
  osPlatform?: string;
  webglRenderer?: string;
  screenResolution?: string;
  consistencyScore?: number;
  cdpHardened?: boolean;
  tlsProfile?: string;
  behaviorMode?: 'bezier-human' | 'standard';
  failoverCount?: number;
  status: SessionStatus;
  searchQuery: string;
  matchedQuery?: string | null;
  foundAtPage?: number | null;
  foundAtRank?: number | null;
  candidatesInspected: number;
  candidatesSkipped: number;
  matchedUrl: string | null;
  resolvedTitle: string | null;
  httpStatus: number | null;
  durationMs: number | null;
  screenshotUrl: string | null;
  error: string | null;
  consentDismissed: boolean;
  consentButtonLabel: string | null;
  trafficStatus: 'unknown' | 'clear' | 'consent-passed' | 'bot-gate-detected';
  trafficGateReason: string | null;
  actionButtonClicked: string | null;
  watchSecondsActual?: number;
  targetWatchSeconds?: number;
  videoDurationSeconds?: number | null;
  playbackStatus?: PlaybackStatus;
  profileState?: ProfileWarmupState;
  watchtimePingCount?: number;
  lastWatchtimePingStatus?: number | null;
  sessionDepthUrl?: string | null;
  sessionDepthTitle?: string | null;
  decisions: CandidateDecision[];
  updatedAt: string;
}

export interface ProfileDiscoveryHit {
  platform: string;
  profileUrl: string;
  usernameFound: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  httpStatus: number;
  clueMatches: string[];
  imageSimilarityPercent: number | null;
  confidenceScore: number;
  verifiedByExitIp: string;
  sessionId: string;
  screenshotUrl: string | null;
  isExactTarget: boolean;
}

export interface RunConfig {
  mode: TargetMode;
  targetUrl: string;
  searchQuery: string;
  username: string;
  clues: string;
  referenceImageDataUrl: string | null;
  desiredSessionCount: number;
  maxSearchPages?: number;
  minWatchSeconds?: number;
  autoEnrichQuery?: boolean;
  enableProfileWarmup?: boolean;
  humanizeWatchCurve?: boolean;
  enableSessionDepth?: boolean;
  strictExactClickOnly: boolean;
  captureProofScreenshot: boolean;
  allowDirectSessionFallback: boolean;
  autoDismissCookies: boolean;
  autoClickActionButton: boolean;
  actionButtonSelector: string;
}

export type RunStatus = 'running' | 'completed' | 'stopped' | 'failed';

export interface RunRecord {
  id: string;
  config: Omit<RunConfig, 'referenceImageDataUrl'> & { hasReferenceImage: boolean };
  resolvedTargetTitle?: string | null;
  resolvedTargetAuthor?: string | null;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  totalSessionsPlanned: number;
  uniqueIpsUsed: number;
  matchedSessionsCount: number;
  skippedCandidatesCount: number;
  sessions: SessionExecution[];
  osintHits: ProfileDiscoveryHit[];
  summaryError?: string;
}

export interface RunRankTrendPoint {
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
}

export interface ParsedProxyEndpoint {
  host: string;
  port: number;
  protocol: ProxyProtocol;
  raw: string;
}

export type SSEMessage =
  | { type: 'harvest-progress'; payload: HarvestProgress }
  | { type: 'proxy-verified'; payload: ProxyEndpoint }
  | { type: 'run-updated'; payload: RunRecord }
  | { type: 'session-updated'; payload: { runId: string; session: SessionExecution } }
  | { type: 'osint-hit'; payload: { runId: string; hit: ProfileDiscoveryHit } };
