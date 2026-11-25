import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type {
  HarvestProgress,
  ParsedProxyEndpoint,
  ProxyEndpoint,
  ProxyNetworkType,
  ProxyProtocol,
} from '../src/types/automation';
import { classifyNetworkType, parseProxyLines, safeJsonParse } from '../src/lib/targetMatcher';
import { eventBus } from './eventBus';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PROXIES_FILE = path.join(DATA_DIR, 'proxies.json');

interface ProxyFeed {
  name: string;
  url: string;
  defaultProtocol: ProxyProtocol;
  format: 'text' | 'geonode-json';
}

const OPEN_SOURCE_PROXY_FEEDS: ProxyFeed[] = [
  {
    name: 'ProxyScrape HTTP',
    url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=7000&country=all&ssl=yes&anonymity=all',
    defaultProtocol: 'http',
    format: 'text',
  },
  {
    name: 'ProxyScrape SOCKS5',
    url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=7000&country=all',
    defaultProtocol: 'socks5',
    format: 'text',
  },
  {
    name: 'ProxyScrape SOCKS4',
    url: 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=7000&country=all',
    defaultProtocol: 'socks4',
    format: 'text',
  },
  {
    name: 'GeoNode Free Proxy API',
    url: 'https://proxylist.geonode.com/api/proxy-list?limit=150&page=1&sort_by=lastChecked&sort_type=desc',
    defaultProtocol: 'http',
    format: 'geonode-json',
  },
  {
    name: 'TheSpeedX HTTP (GitHub)',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    defaultProtocol: 'http',
    format: 'text',
  },
  {
    name: 'TheSpeedX SOCKS5 (GitHub)',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
    defaultProtocol: 'socks5',
    format: 'text',
  },
  {
    name: 'Monosans SOCKS5 (GitHub)',
    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
    defaultProtocol: 'socks5',
    format: 'text',
  },
  {
    name: 'Monosans HTTP (GitHub)',
    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    defaultProtocol: 'http',
    format: 'text',
  },
];

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function makeProxyId(protocol: ProxyProtocol, host: string, port: number): string {
  return crypto.createHash('sha1').update(`${protocol}://${host}:${port}`).digest('hex').slice(0, 12);
}

export function tcpConnectCheck(host: string, port: number, timeoutMs = 2500): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket: net.Socket | null = null;
    let timer: NodeJS.Timeout | null = null;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (socket && !socket.destroyed) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
      if (err) reject(err);
      else resolve();
    };

    try {
      socket = net.connect({ host, port });
      // Keep error handler attached for the entire socket lifetime so late OS ETIMEDOUT/ECONNRESET never crashes/logs uncaughtException.
      socket.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
      socket.on('timeout', () => finish(new Error(`TCP connect timeout ${host}:${port}`)));
      socket.on('connect', () => finish());
      socket.setTimeout(timeoutMs);

      timer = setTimeout(() => {
        finish(new Error(`TCP connect timeout ${host}:${port}`));
      }, timeoutMs + 150);
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function createProxyAgent(
  proxy: Pick<ProxyEndpoint, 'protocol' | 'host' | 'port'>,
  timeoutMs = 5000
) {
  const proxyUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`;
  const agent =
    proxy.protocol === 'socks4' || proxy.protocol === 'socks5'
      ? new SocksProxyAgent(proxyUrl, { timeout: timeoutMs })
      : new HttpsProxyAgent(proxyUrl, { timeout: timeoutMs });

  const noopSocketError = () => {};
  agent.on('error', noopSocketError);

  const origConnect = agent.connect.bind(agent);
  agent.connect = async (
    req: Parameters<typeof agent.connect>[0],
    opts: Parameters<typeof agent.connect>[1]
  ) => {
    const sock = await origConnect(req, opts);
    if (sock && typeof sock.on === 'function' && !sock.listeners('error').includes(noopSocketError)) {
      sock.on('error', noopSocketError);
    }
    return sock;
  };

  return agent;
}

export function httpsGetWithAgent(
  targetUrl: string,
  agent: http.Agent | undefined,
  timeoutMs: number,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req: http.ClientRequest | null = null;
    let hardTimer: NodeJS.Timeout | null = null;

    const cleanupTimer = () => {
      if (hardTimer) {
        clearTimeout(hardTimer);
        hardTimer = null;
      }
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanupTimer();
      if (req && !req.destroyed) {
        try {
          req.destroy();
        } catch {
          // ignore
        }
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const onTimeout = () => fail(new Error('Request timeout'));

    try {
      const parsed = new URL(targetUrl);
      const mod = parsed.protocol === 'https:' ? https : http;
      req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method: 'GET',
          // Disable shared global keep-alive socket pooling when no proxy agent is passed
          // so each socket handles 1 request and never accumulates error listeners.
          agent: agent ?? false,
          timeout: timeoutMs,
          rejectUnauthorized: false,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'application/json, text/html;q=0.9,*/*;q=0.8',
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let totalBytes = 0;

          res.on('error', fail);
          res.on('aborted', () => fail(new Error('Response aborted')));
          res.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes <= 2_500_000) {
              chunks.push(chunk);
            }
          });
          res.on('end', () => {
            if (settled) return;
            settled = true;
            cleanupTimer();
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        }
      );

      // Keep error handlers attached across the full lifetime of req, socket, and underlying proxy TCP socket
      // so deferred errors after timeout/abort are caught cleanly by fail() without firing uncaughtException.
      req.on('socket', (socket: net.Socket) => {
        if (!socket.listeners('error').includes(fail)) {
          socket.on('error', fail);
        }
      });
      req.on('proxy', (info: { socket?: net.Socket }) => {
        if (info?.socket && !info.socket.listeners('error').includes(fail)) {
          info.socket.on('error', fail);
        }
      });
      req.on('timeout', onTimeout);
      req.on('error', fail);

      hardTimer = setTimeout(() => {
        fail(new Error('Request timeout'));
      }, timeoutMs + 500);

      req.end();
    } catch (err) {
      fail(err);
    }
  });
}

export function httpsPostJsonWithAgent(
  targetUrl: string,
  payload: unknown,
  agent: http.Agent | undefined,
  timeoutMs: number,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req: http.ClientRequest | null = null;
    let hardTimer: NodeJS.Timeout | null = null;

    const cleanupTimer = () => {
      if (hardTimer) {
        clearTimeout(hardTimer);
        hardTimer = null;
      }
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanupTimer();
      if (req && !req.destroyed) {
        try {
          req.destroy();
        } catch {
          // ignore
        }
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    try {
      const parsed = new URL(targetUrl);
      const mod = parsed.protocol === 'https:' ? https : http;
      const bodyStr = JSON.stringify(payload);
      req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          agent: agent ?? false,
          timeout: timeoutMs,
          rejectUnauthorized: false,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr).toString(),
            Accept: 'application/json',
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let totalBytes = 0;

          res.on('error', fail);
          res.on('aborted', () => fail(new Error('Response aborted')));
          res.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes <= 3_000_000) {
              chunks.push(chunk);
            }
          });
          res.on('end', () => {
            if (settled) return;
            settled = true;
            cleanupTimer();
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        }
      );

      req.on('socket', (socket: net.Socket) => {
        if (!socket.listeners('error').includes(fail)) {
          socket.on('error', fail);
        }
      });
      req.on('proxy', (info: { socket?: net.Socket }) => {
        if (info?.socket && !info.socket.listeners('error').includes(fail)) {
          info.socket.on('error', fail);
        }
      });
      req.on('timeout', () => fail(new Error('Request timeout')));
      req.on('error', fail);

      hardTimer = setTimeout(() => {
        fail(new Error('Request timeout'));
      }, timeoutMs + 500);

      req.write(bodyStr);
      req.end();
    } catch (err) {
      fail(err);
    }
  });
}

async function lookupLocalPublicIp(): Promise<string | null> {
  try {
    const res = await httpsGetWithAgent('https://api.ipify.org?format=json', undefined, 4000);
    if (res.status === 200) {
      const parsed = JSON.parse(res.body) as { ip?: string };
      return parsed.ip ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

async function lookupGeoForIp(ip: string): Promise<{
  country: string | null;
  countryCode: string | null;
  isp: string | null;
  networkType: ProxyNetworkType;
}> {
  try {
    const res = await httpsGetWithAgent(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,isp,org,hosting`,
      undefined,
      3000
    );
    if (res.status === 200) {
      const data = JSON.parse(res.body) as {
        status?: string;
        country?: string;
        countryCode?: string;
        isp?: string;
        org?: string;
        hosting?: boolean;
      };
      if (data.status === 'success') {
        const isp = data.isp ?? data.org ?? null;
        return {
          country: data.country ?? null,
          countryCode: data.countryCode ?? null,
          isp,
          networkType: classifyNetworkType(data.hosting, data.isp, data.org),
        };
      }
    }
  } catch {
    // Non-fatal metadata enrichment
  }
  return { country: null, countryCode: null, isp: null, networkType: 'unknown' };
}

class ProxyPoolManager {
  private proxies = new Map<string, ProxyEndpoint>();
  private abortController: AbortController | null = null;
  private localPublicIp: string | null = null;
  private progress: HarvestProgress = {
    running: false,
    phase: 'idle',
    fetchedCount: 0,
    probedCount: 0,
    verifiedUniqueCount: 0,
    targetUniqueCount: 45,
    currentFeed: '',
    startedAt: null,
    finishedAt: null,
  };

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    ensureDataDir();
    if (!fs.existsSync(PROXIES_FILE)) return;
    try {
      const raw = fs.readFileSync(PROXIES_FILE, 'utf8');
      const items = JSON.parse(raw) as ProxyEndpoint[];
      for (const item of items) {
        this.proxies.set(item.id, item);
      }
      this.progress.verifiedUniqueCount = this.getVerifiedUniqueProxies().length;
    } catch {
      // Ignore corrupt cache file
    }
  }

  private saveToDisk(): void {
    ensureDataDir();
    const list = Array.from(this.proxies.values());
    fs.writeFileSync(PROXIES_FILE, JSON.stringify(list, null, 2), 'utf8');
  }

  private emitProgress(): void {
    this.progress.verifiedUniqueCount = this.getVerifiedUniqueProxies().length;
    eventBus.broadcast({
      type: 'harvest-progress',
      payload: { ...this.progress },
    });
  }

  getProgress(): HarvestProgress {
    return {
      ...this.progress,
      verifiedUniqueCount: this.getVerifiedUniqueProxies().length,
    };
  }

  getAllProxies(): ProxyEndpoint[] {
    return Array.from(this.proxies.values()).sort((a, b) => {
      if (a.status === 'verified' && b.status !== 'verified') return -1;
      if (a.status !== 'verified' && b.status === 'verified') return 1;
      return (a.latencyMs ?? 99999) - (b.latencyMs ?? 99999);
    });
  }

  getVerifiedUniqueProxies(): ProxyEndpoint[] {
    const byExitIp = new Map<string, ProxyEndpoint>();
    const protoRank = (p: ProxyProtocol) => (p === 'socks4' ? 2 : 1);
    const netRank = (n: ProxyNetworkType | undefined) =>
      n === 'residential-isp' ? 0 : n === 'datacenter' ? 2 : 1;

    const verified = Array.from(this.proxies.values())
      .filter((p) => p.status === 'verified' && p.exitIp)
      .sort((a, b) => {
        const pDiff = protoRank(a.protocol) - protoRank(b.protocol);
        if (pDiff !== 0) return pDiff;
        const nDiff = netRank(a.networkType) - netRank(b.networkType);
        if (nDiff !== 0) return nDiff;
        return (a.latencyMs ?? 99999) - (b.latencyMs ?? 99999);
      });

    for (const p of verified) {
      if (!p.exitIp) continue;
      if (this.localPublicIp && p.exitIp === this.localPublicIp) continue;
      if (!byExitIp.has(p.exitIp)) {
        byExitIp.set(p.exitIp, p);
      }
    }
    return Array.from(byExitIp.values());
  }

  clearAll(): void {
    this.stopHarvest();
    this.proxies.clear();
    this.saveToDisk();
    this.progress = {
      running: false,
      phase: 'idle',
      fetchedCount: 0,
      probedCount: 0,
      verifiedUniqueCount: 0,
      targetUniqueCount: 45,
      currentFeed: '',
      startedAt: null,
      finishedAt: null,
    };
    this.emitProgress();
  }

  markProxyFailed(proxyId: string, reason: string): void {
    const existing = this.proxies.get(proxyId);
    if (!existing || existing.status === 'failed') return;
    const updated: ProxyEndpoint = {
      ...existing,
      status: 'failed',
      errorMessage: reason.slice(0, 140),
      lastCheckedAt: new Date().toISOString(),
    };
    this.proxies.set(proxyId, updated);
    this.saveToDisk();
    eventBus.broadcast({ type: 'proxy-verified', payload: updated });
    this.emitProgress();
  }

  acquireHealthyReserveProxy(
    excludedExitIps: Set<string>,
    excludedProxyIds: Set<string>
  ): ProxyEndpoint | null {
    const verified = this.getVerifiedUniqueProxies();
    for (const candidate of verified) {
      if (!candidate.exitIp) continue;
      if (excludedProxyIds.has(candidate.id)) continue;
      if (excludedExitIps.has(candidate.exitIp)) continue;
      return candidate;
    }
    return null;
  }

  stopHarvest(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.progress.running) {
      this.progress.running = false;
      this.progress.phase = 'stopped';
      this.progress.finishedAt = new Date().toISOString();
      this.emitProgress();
    }
  }

  async probeSingleProxy(
    candidate: ParsedProxyEndpoint,
    source: string,
    timeoutMs = 5000
  ): Promise<ProxyEndpoint> {
    const id = makeProxyId(candidate.protocol, candidate.host, candidate.port);
    let agent: ReturnType<typeof createProxyAgent> | null = null;

    const start = Date.now();
    try {
      // Pre-check raw TCP reachability with a guarded socket so dead/firewalled hosts fail fast
      // without leaving dangling SYN sockets inside HttpsProxyAgent / SocksProxyAgent.
      await tcpConnectCheck(candidate.host, candidate.port, Math.min(timeoutMs, 2500));

      agent = createProxyAgent(
        {
          protocol: candidate.protocol,
          host: candidate.host,
          port: candidate.port,
        },
        timeoutMs
      );

      // Step 1: Verify HTTPS CONNECT tunneling & unique exit IP using api.ipify.org
      const res = await httpsGetWithAgent('https://api.ipify.org?format=json', agent, timeoutMs);
      if (res.status !== 200) {
        throw new Error(`ipify HTTP ${res.status}`);
      }

      const parsed = safeJsonParse<{ ip?: string }>(res.body);
      const exitIp = parsed.ip?.trim() ?? null;
      if (!exitIp || !/^(\d{1,3}\.){3}\d{1,3}$/.test(exitIp)) {
        throw new Error('Geçersiz çıkış IP yanıtı');
      }

      if (this.localPublicIp && exitIp === this.localPublicIp) {
        throw new Error('Şeffaf/yerel IP döndürdü (gerçek maskeleme yok)');
      }

      // Step 2: Verify real HTTPS tunneling to YouTube (eliminates proxy-judges, SOCKS4 hostname blocks & NetworkUnreachable proxies)
      const ytCheck = await httpsGetWithAgent(
        'https://www.youtube.com/robots.txt',
        agent,
        Math.min(timeoutMs, 4500)
      );
      if (ytCheck.status !== 200 || !ytCheck.body.toLowerCase().includes('user-agent')) {
        throw new Error(`YouTube TLS tüneli başarısız (HTTP ${ytCheck.status})`);
      }

      const latencyMs = Date.now() - start;
      const geo = await lookupGeoForIp(exitIp);
      const endpoint: ProxyEndpoint = {
        id,
        host: candidate.host,
        port: candidate.port,
        protocol: candidate.protocol,
        source,
        status: 'verified',
        exitIp,
        country: geo.country,
        countryCode: geo.countryCode,
        isp: geo.isp,
        networkType: geo.networkType,
        latencyMs,
        lastCheckedAt: new Date().toISOString(),
      };

      this.proxies.set(id, endpoint);
      this.saveToDisk();
      eventBus.broadcast({ type: 'proxy-verified', payload: endpoint });
      return endpoint;
    } catch (err) {
      const endpoint: ProxyEndpoint = {
        id,
        host: candidate.host,
        port: candidate.port,
        protocol: candidate.protocol,
        source,
        status: 'failed',
        exitIp: null,
        country: null,
        countryCode: null,
        isp: null,
        latencyMs: null,
        lastCheckedAt: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : 'Bağlantı hatası',
      };
      this.proxies.set(id, endpoint);
      return endpoint;
    } finally {
      try {
        agent?.destroy();
      } catch {
        // ignore agent cleanup errors
      }
    }
  }

  async reverifyVerifiedProxies(): Promise<{ checked: number; remainingVerified: number }> {
    if (this.progress.running) {
      return {
        checked: 0,
        remainingVerified: this.getVerifiedUniqueProxies().length,
      };
    }

    const currentVerified = Array.from(this.proxies.values()).filter((p) => p.status === 'verified');
    if (currentVerified.length === 0) {
      return { checked: 0, remainingVerified: 0 };
    }

    if (!this.localPublicIp) {
      this.localPublicIp = await lookupLocalPublicIp();
    }

    this.progress = {
      ...this.progress,
      running: true,
      phase: 'probing',
      probedCount: 0,
      fetchedCount: currentVerified.length,
      currentFeed: `Mevcut ${currentVerified.length} proxy YouTube TLS ile yeniden test ediliyor`,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.emitProgress();

    let cursor = 0;
    const concurrency = 25;
    const workers = Array.from({ length: Math.min(concurrency, currentVerified.length) }, async () => {
      while (cursor < currentVerified.length) {
        const item = currentVerified[cursor++];
        if (!item) break;
        await this.probeSingleProxy(
          {
            host: item.host,
            port: item.port,
            protocol: item.protocol,
            raw: `${item.protocol}://${item.host}:${item.port}`,
          },
          item.source,
          4800
        );
        this.progress.probedCount++;
        if (this.progress.probedCount % 5 === 0) {
          this.emitProgress();
        }
      }
    });

    await Promise.all(workers);
    this.saveToDisk();

    this.progress.running = false;
    this.progress.phase = 'completed';
    this.progress.currentFeed = '';
    this.progress.finishedAt = new Date().toISOString();
    this.emitProgress();

    return {
      checked: currentVerified.length,
      remainingVerified: this.getVerifiedUniqueProxies().length,
    };
  }

  async importAndVerifyCustomProxies(
    rawText: string,
    defaultProtocol: ProxyProtocol = 'http'
  ): Promise<{ parsedCount: number; verifiedCount: number }> {
    const parsed = parseProxyLines(rawText, defaultProtocol);
    if (!this.localPublicIp) {
      this.localPublicIp = await lookupLocalPublicIp();
    }

    let verifiedCount = 0;
    const concurrency = 20;
    let index = 0;

    const workers = Array.from({ length: Math.min(concurrency, parsed.length) }, async () => {
      while (index < parsed.length) {
        const current = parsed[index++];
        const res = await this.probeSingleProxy(current, 'Manuel İçe Aktarım', 6000);
        if (res.status === 'verified') {
          verifiedCount++;
        }
      }
    });

    await Promise.all(workers);
    this.saveToDisk();
    this.emitProgress();
    return { parsedCount: parsed.length, verifiedCount };
  }

  async harvestAndVerify(targetUniqueCount = 45): Promise<HarvestProgress> {
    if (this.progress.running) {
      return this.getProgress();
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.progress = {
      running: true,
      phase: 'fetching-feeds',
      fetchedCount: 0,
      probedCount: 0,
      verifiedUniqueCount: this.getVerifiedUniqueProxies().length,
      targetUniqueCount: Math.max(30, targetUniqueCount),
      currentFeed: 'Yerel çıkış IP ve mevcut havuz kontrol ediliyor...',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.emitProgress();

    this.localPublicIp = await lookupLocalPublicIp();

    // First re-verify stale existing verified proxies (>4 minutes old) so dead ones don't accumulate
    const staleThreshold = Date.now() - 4 * 60 * 1000;
    const staleVerified = Array.from(this.proxies.values()).filter(
      (p) => p.status === 'verified' && (!p.lastCheckedAt || new Date(p.lastCheckedAt).getTime() < staleThreshold)
    );
    if (staleVerified.length > 0 && !signal.aborted) {
      let idx = 0;
      const recheckWorkers = Array.from({ length: Math.min(20, staleVerified.length) }, async () => {
        while (!signal.aborted && idx < staleVerified.length) {
          const item = staleVerified[idx++];
          if (!item) break;
          await this.probeSingleProxy(
            {
              host: item.host,
              port: item.port,
              protocol: item.protocol,
              raw: `${item.protocol}://${item.host}:${item.port}`,
            },
            item.source,
            4500
          );
        }
      });
      await Promise.all(recheckWorkers);
      this.saveToDisk();
      this.emitProgress();
    }

    const candidateMap = new Map<string, { endpoint: ParsedProxyEndpoint; source: string }>();

    // First re-include any previously untested or failed? No, prioritize fresh feeds + re-verify existing verified
    for (const feed of OPEN_SOURCE_PROXY_FEEDS) {
      if (signal.aborted) break;
      this.progress.currentFeed = feed.name;
      this.emitProgress();

      try {
        const res = await httpsGetWithAgent(feed.url, undefined, 7000);
        if (res.status !== 200) continue;

        if (feed.format === 'geonode-json') {
          const json = JSON.parse(res.body) as {
            data?: Array<{ ip?: string; port?: string; protocols?: string[] }>;
          };
          for (const row of json.data ?? []) {
            if (!row.ip || !row.port) continue;
            const protoRaw = row.protocols?.[0]?.toLowerCase() ?? 'http';
            const proto: ProxyProtocol =
              protoRaw === 'socks5' || protoRaw === 'socks4' || protoRaw === 'https'
                ? protoRaw
                : 'http';
            const parsed = parseProxyLines(`${proto}://${row.ip}:${row.port}`, proto);
            for (const item of parsed) {
              if (!candidateMap.has(item.raw)) {
                candidateMap.set(item.raw, { endpoint: item, source: feed.name });
              }
            }
          }
        } else {
          const parsed = parseProxyLines(res.body, feed.defaultProtocol);
          // Take up to 350 per feed to keep candidate pool deep across feeds/protocols
          for (const item of parsed.slice(0, 350)) {
            if (!candidateMap.has(item.raw)) {
              candidateMap.set(item.raw, { endpoint: item, source: feed.name });
            }
          }
        }

        this.progress.fetchedCount = candidateMap.size;
        this.emitProgress();
      } catch {
        // Feed unreachable; proceed with remaining open-source feeds
      }
    }

    if (signal.aborted) {
      return this.getProgress();
    }

    // Interleave protocols/sources so we don't probe 160 dead HTTP proxies before trying SOCKS5
    const allCandidates = Array.from(candidateMap.values());
    // Deterministic shuffle/interleave by taking every stride
    const interleaved: typeof allCandidates = [];
    const bucketSize = 8;
    for (let offset = 0; offset < allCandidates.length; offset += bucketSize) {
      const slice = allCandidates.slice(offset, offset + bucketSize);
      interleaved.push(...slice);
    }
    // Reorder by mixing indices across feeds
    const mixed: typeof allCandidates = [];
    const bySource = new Map<string, typeof allCandidates>();
    for (const c of interleaved) {
      const list = bySource.get(c.source) ?? [];
      list.push(c);
      bySource.set(c.source, list);
    }
    let hasMore = true;
    let round = 0;
    while (hasMore) {
      hasMore = false;
      for (const list of bySource.values()) {
        if (round < list.length) {
          mixed.push(list[round]);
          hasMore = true;
        }
      }
      round++;
    }

    // Sort so HTTP & SOCKS5 candidates are probed before SOCKS4 (SOCKS4 rarely supports YouTube SNI/hostname resolution)
    const primaryMixed = mixed.filter((c) => c.endpoint.protocol !== 'socks4');
    const socks4Mixed = mixed.filter((c) => c.endpoint.protocol === 'socks4');
    const prioritized = [...primaryMixed, ...socks4Mixed];

    this.progress.phase = 'probing';
    this.progress.currentFeed = `${prioritized.length} aday test ediliyor`;
    this.emitProgress();

    const maxToProbe = Math.min(prioritized.length, 1500);
    let cursor = 0;
    const concurrency = 65;

    const workers = Array.from({ length: concurrency }, async () => {
      while (!signal.aborted && cursor < maxToProbe) {
        if (this.getVerifiedUniqueProxies().length >= this.progress.targetUniqueCount) {
          break;
        }
        const item = prioritized[cursor++];
        if (!item) break;

        await this.probeSingleProxy(item.endpoint, item.source, 4800);
        this.progress.probedCount++;

        if (this.progress.probedCount % 10 === 0 || this.getVerifiedUniqueProxies().length >= this.progress.targetUniqueCount) {
          this.emitProgress();
        }
      }
    });

    await Promise.all(workers);

    // Prune failed proxies older/excessive so disk stays clean, keep verified + up to 40 recent failed for diagnostics
    const verifiedList = Array.from(this.proxies.values()).filter((p) => p.status === 'verified');
    const failedList = Array.from(this.proxies.values())
      .filter((p) => p.status === 'failed')
      .slice(0, 40);
    this.proxies.clear();
    for (const p of [...verifiedList, ...failedList]) {
      this.proxies.set(p.id, p);
    }

    this.saveToDisk();

    if (!signal.aborted) {
      this.progress.running = false;
      this.progress.phase = 'completed';
      this.progress.currentFeed = '';
      this.progress.finishedAt = new Date().toISOString();
      this.emitProgress();
    }

    this.abortController = null;
    return this.getProgress();
  }
}

export const proxyPool = new ProxyPoolManager();
