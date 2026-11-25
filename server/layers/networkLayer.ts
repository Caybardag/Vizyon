import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ProxyEndpoint, ProxyNetworkType } from '../../src/types/automation';
import { classifyNetworkType } from '../../src/lib/targetMatcher';
import type { CoherentSessionFingerprint } from '../../src/lib/fingerprintLayer';

// Chromium-like TLS cipher order to reduce Node.js OpenSSL JA3 divergence on fallback HTTPS requests
export const CHROME_TLS_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
].join(':');

export function buildChromeAlignedHeaders(
  fp?: Pick<
    CoherentSessionFingerprint,
    'userAgent' | 'acceptLanguage' | 'secChUa' | 'secChUaMobile' | 'secChUaPlatform'
  >
): Record<string, string> {
  if (!fp) {
    return {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Accept-Language': 'en-US,en;q=0.9',
    };
  }
  return {
    'User-Agent': fp.userAgent,
    'sec-ch-ua': fp.secChUa,
    'sec-ch-ua-mobile': fp.secChUaMobile,
    'sec-ch-ua-platform': fp.secChUaPlatform,
    'Accept-Language': fp.acceptLanguage,
  };
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
      const isHttps = parsed.protocol === 'https:';
      const mod = isHttps ? https : http;
      req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method: 'GET',
          agent: agent ?? false,
          timeout: timeoutMs,
          rejectUnauthorized: false,
          ...(isHttps ? { ciphers: CHROME_TLS_CIPHERS, minVersion: 'TLSv1.2' } : {}),
          headers: {
            ...buildChromeAlignedHeaders(),
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
      const isHttps = parsed.protocol === 'https:';
      const mod = isHttps ? https : http;
      const bodyStr = JSON.stringify(payload);
      req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          agent: agent ?? false,
          timeout: timeoutMs,
          rejectUnauthorized: false,
          ...(isHttps ? { ciphers: CHROME_TLS_CIPHERS, minVersion: 'TLSv1.2' } : {}),
          headers: {
            ...buildChromeAlignedHeaders(),
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

export async function lookupGeoForIp(ip: string): Promise<{
  country: string | null;
  countryCode: string | null;
  timezone: string | null;
  lat: number | null;
  lon: number | null;
  isp: string | null;
  networkType: ProxyNetworkType;
}> {
  try {
    const res = await httpsGetWithAgent(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,timezone,lat,lon,isp,org,hosting`,
      undefined,
      3000
    );
    if (res.status === 200) {
      const data = JSON.parse(res.body) as {
        status?: string;
        country?: string;
        countryCode?: string;
        timezone?: string;
        lat?: number;
        lon?: number;
        isp?: string;
        org?: string;
        hosting?: boolean;
      };
      if (data.status === 'success') {
        const isp = data.isp ?? data.org ?? null;
        return {
          country: data.country ?? null,
          countryCode: data.countryCode ?? null,
          timezone: data.timezone ?? null,
          lat: typeof data.lat === 'number' ? data.lat : null,
          lon: typeof data.lon === 'number' ? data.lon : null,
          isp,
          networkType: classifyNetworkType(data.hosting, data.isp, data.org),
        };
      }
    }
  } catch {
    // Non-fatal metadata enrichment
  }
  return {
    country: null,
    countryCode: null,
    timezone: null,
    lat: null,
    lon: null,
    isp: null,
    networkType: 'unknown',
  };
}
