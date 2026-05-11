import { randomUUID } from 'crypto';

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const activeLevel = levels[level] || levels.info;

function normalizeArgs(metaOrMsg, maybeMsg) {
  if (typeof metaOrMsg === 'string') {
    return { meta: {}, msg: metaOrMsg };
  }
  if (metaOrMsg && typeof metaOrMsg === 'object') {
    return { meta: metaOrMsg, msg: maybeMsg || undefined };
  }
  return { meta: {}, msg: maybeMsg || undefined };
}

function emit(levelName, minLevel, bindings, metaOrMsg, maybeMsg) {
  if (activeLevel > minLevel) return;
  const { meta, msg } = normalizeArgs(metaOrMsg, maybeMsg);
  const payload = {
    level: levelName,
    timestamp: new Date().toISOString(),
    service: 'dots-backend',
    ...bindings,
    ...meta
  };
  if (msg) payload.message = msg;

  const line = JSON.stringify(payload);
  if (levelName === 'error' || levelName === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

function createLogger(bindings = {}) {
  return {
    child(extraBindings = {}) {
      return createLogger({ ...bindings, ...extraBindings });
    },
    debug(metaOrMsg, maybeMsg) {
      emit('debug', levels.debug, bindings, metaOrMsg, maybeMsg);
    },
    info(metaOrMsg, maybeMsg) {
      emit('info', levels.info, bindings, metaOrMsg, maybeMsg);
    },
    warn(metaOrMsg, maybeMsg) {
      emit('warn', levels.warn, bindings, metaOrMsg, maybeMsg);
    },
    error(metaOrMsg, maybeMsg) {
      emit('error', levels.error, bindings, metaOrMsg, maybeMsg);
    }
  };
}

export const logger = createLogger();

export function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return String(cfIp);

  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }

  return req.socket?.remoteAddress || req.ip || 'unknown';
}

export function createRequestIdMiddleware() {
  return (req, res, next) => {
    req.requestId = req.requestId || randomUUID();
    req.clientIp = getClientIp(req);

    const startedAt = Date.now();
    const requestLogger = logger.child({
      requestId: req.requestId,
      clientIp: req.clientIp,
      method: req.method,
      path: req.originalUrl || req.url
    });

    req.logger = requestLogger;

    res.on('finish', () => {
      requestLogger.info({
        action: 'http_request',
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        userAgent: req.headers['user-agent'] || null,
        userId: req.query?.userId || req.body?.userId || req.headers['x-user-id'] || null
      }, 'HTTP request completed');
    });

    next();
  };
}
