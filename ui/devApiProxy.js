import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const DEFAULT_SERVER_PROXY_TARGET = 'http://127.0.0.1:3000';
const DESKTOP_SESSION_PATH = process.env.NEARBYTES_DESKTOP_SESSION_FILE?.trim()
  ? path.resolve(process.env.NEARBYTES_DESKTOP_SESSION_FILE)
  : path.join(os.homedir(), '.nearbytes', 'desktop-session.json');
const API_PREFIXES = [
  '/open',
  '/files',
  '/upload',
  '/file',
  '/events',
  '/references',
  '/chat',
  '/health',
  '/timeline',
  '/snapshot',
  '/__debug',
  '/config',
  '/sources',
  '/integrations',
  '/links',
  '/watch',
  '/folders',
];
const PROXY_RECOVERY_TIMEOUT_MS = 10_000;
const PROXY_RECOVERY_POLL_INTERVAL_MS = 250;
const PROXY_HEALTHCHECK_TIMEOUT_MS = 1_000;

export function nearbytesDevApiProxy() {
  return {
    name: 'nearbytes-dev-api-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !isApiRequest(req.url)) {
          next();
          return;
        }

        proxyApiRequest(req, res, readDesktopSession(), true);
      });
    },
  };
}

function proxyApiRequest(req, res, session, allowRetry) {
  const targetUrl = getProxyTargetUrl(session);
  const headers = { ...req.headers, host: targetUrl.host };
  if (session?.token && !headers['x-nearbytes-desktop-token']) {
    headers['x-nearbytes-desktop-token'] = session.token;
  }

  const proxyReq = http.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method: req.method,
      path: req.url,
      headers,
    },
    (proxyRes) => {
      res.statusCode = proxyRes.statusCode ?? 502;
      Object.entries(proxyRes.headers).forEach(([key, value]) => {
        if (value !== undefined) {
          res.setHeader(key, value);
        }
      });
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (error) => {
    if (res.headersSent) {
      res.end();
      return;
    }

    if (session && shouldInvalidateDesktopSession(error)) {
      invalidateDesktopSession(session);
    }

    const canRetry = allowRetry && (req.method === 'GET' || req.method === 'HEAD');
    if (canRetry) {
      void retryProxyRequest(req, res, session);
      return;
    }

    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'BAD_GATEWAY',
          message: buildProxyErrorMessage(error, targetUrl, session),
        },
      })
    );
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
    return;
  }

  req.pipe(proxyReq);
}

async function retryProxyRequest(req, res, previousSession) {
  const recoveredTarget = await waitForRecoverableProxyTarget(previousSession);
  if (res.headersSent || res.writableEnded) {
    return;
  }

  if (recoveredTarget.available) {
    proxyApiRequest(req, res, recoveredTarget.session, false);
    return;
  }

  res.statusCode = 502;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      error: {
        code: 'BAD_GATEWAY',
        message: buildProxyErrorMessage(
          recoveredTarget.error,
          recoveredTarget.targetUrl,
          recoveredTarget.session
        ),
      },
    })
  );
}

export async function waitForRecoverableProxyTarget(_previousSession) {
  const startedAt = Date.now();
  let lastError = new Error('desktop runtime unavailable after auto-repair attempt');

  while (Date.now() - startedAt < PROXY_RECOVERY_TIMEOUT_MS) {
    const session = readDesktopSession();
    const targetUrl = getProxyTargetUrl(session);
    const probe = await probeProxyTarget(targetUrl, session);
    if (probe.ok) {
      return {
        available: true,
        session,
        targetUrl,
        error: lastError,
      };
    }

    lastError = probe.error;
    if (session && shouldInvalidateDesktopSession(probe.error)) {
      invalidateDesktopSession(session);
    }

    await wait(PROXY_RECOVERY_POLL_INTERVAL_MS);
  }

  const session = readDesktopSession();
  return {
    available: false,
    session,
    targetUrl: getProxyTargetUrl(session),
    error: lastError,
  };
}

export function getProxyTargetUrl(session) {
  return new URL(session ? `http://127.0.0.1:${session.port}` : DEFAULT_SERVER_PROXY_TARGET);
}

async function probeProxyTarget(targetUrl, session) {
  const healthUrl = new URL('/health', `${targetUrl.origin}/`);
  try {
    await requestHealthcheck(healthUrl, session);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function requestHealthcheck(targetUrl, session) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (session?.token) {
      headers['x-nearbytes-desktop-token'] = session.token;
    }

    const request = http.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        method: 'GET',
        path: targetUrl.pathname,
        headers,
      },
      (response) => {
        response.resume();
        if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 500) {
          resolve();
          return;
        }
        reject(
          new Error(
            `healthcheck failed with status ${(response.statusCode ?? 0).toString()} at ${targetUrl.origin}`
          )
        );
      }
    );

    request.setTimeout(PROXY_HEALTHCHECK_TIMEOUT_MS, () => {
      request.destroy(new Error(`healthcheck timed out at ${targetUrl.origin}`));
    });
    request.on('error', (error) => {
      reject(new Error(`${error.message} while probing ${targetUrl.origin}/health`));
    });
    request.end();
  });
}

function wait(timeoutMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

export function buildProxyErrorMessage(error, targetUrl, session) {
  const targetLabel = `${targetUrl.hostname}:${targetUrl.port}`;
  if (session) {
    return `Nearbytes dev proxy could not reach the desktop runtime at ${targetLabel}. Restart with "yarn dev-run" or remove ${DESKTOP_SESSION_PATH}. Original error: ${error.message}`;
  }
  return `Nearbytes dev proxy could not reach the API target at ${targetLabel}. Start the desktop runtime with "yarn dev-run" or the standalone server on port 3000. Original error: ${error.message}`;
}

function isApiRequest(url) {
  return API_PREFIXES.some(
    (prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)
  );
}

function readDesktopSession() {
  try {
    const raw = fs.readFileSync(DESKTOP_SESSION_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.pid !== 'number' ||
      !Number.isFinite(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.port !== 'number' ||
      !Number.isFinite(parsed.port) ||
      parsed.port <= 0 ||
      typeof parsed.token !== 'string' ||
      parsed.token.trim().length === 0 ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now() ||
      !isProcessAlive(parsed.pid)
    ) {
      invalidateDesktopSession();
      return null;
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

function shouldInvalidateDesktopSession(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' || code === 'ETIMEDOUT';
}

function invalidateDesktopSession(expectedSession) {
  try {
    if (!fs.existsSync(DESKTOP_SESSION_PATH)) {
      return;
    }

    if (expectedSession) {
      const raw = fs.readFileSync(DESKTOP_SESSION_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.pid === expectedSession.pid &&
        parsed.port === expectedSession.port &&
        parsed.token === expectedSession.token
      ) {
        fs.unlinkSync(DESKTOP_SESSION_PATH);
      }
      return;
    }

    fs.unlinkSync(DESKTOP_SESSION_PATH);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = error.code;
      if (code === 'ENOENT') {
        return;
      }
    }
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const __test__ = {
  buildProxyErrorMessage,
  getProxyTargetUrl,
  waitForRecoverableProxyTarget,
};