// lib/micro-router.js
// A tiny, dependency-free router providing an Express-like API
// (app.get/post/put/delete, req.params, req.query, req.body, res.json/status)
// so route files read just like Express route files, with zero npm installs.

const { parse: parseUrl } = require('node:url');

function pathToRegex(path) {
  const keys = [];
  const pattern = path
    .replace(/\/:([^/]+)/g, (_, key) => {
      keys.push(key);
      return '/([^/]+)';
    });
  return { regex: new RegExp(`^${pattern}$`), keys };
}

class Router {
  constructor() {
    this.routes = []; // { method, regex, keys, handlers: [] }
  }

  _add(method, path, ...handlers) {
    const { regex, keys } = pathToRegex(path);
    this.routes.push({ method, regex, keys, handlers });
  }

  get(path, ...h) { this._add('GET', path, ...h); }
  post(path, ...h) { this._add('POST', path, ...h); }
  put(path, ...h) { this._add('PUT', path, ...h); }
  patch(path, ...h) { this._add('PATCH', path, ...h); }
  delete(path, ...h) { this._add('DELETE', path, ...h); }

  // mount sub-router under a prefix
  use(prefix, subRouter) {
    for (const r of subRouter.routes) {
      const fullPath = (prefix + r.regex.source.slice(1, -1)).replace(/\/+/g, '/');
      this.routes.push({ ...r, regex: new RegExp(`^${fullPath}$`) });
    }
  }

  async handle(req, res) {
    const parsed = parseUrl(req.url, true);
    const pathname = decodeURIComponent(parsed.pathname);

    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(obj, null, 2));
    };

    // CORS for local dev / frontend fetch()
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const m = pathname.match(route.regex);
      if (!m) continue;

      req.params = {};
      route.keys.forEach((k, i) => { req.params[k] = m[i + 1]; });
      req.query = parsed.query;

      // parse JSON body for write methods
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        req.body = await readJsonBody(req);
      } else {
        req.body = {};
      }

      try {
        for (const handler of route.handlers) {
          let nextCalled = false;
          await handler(req, res, () => { nextCalled = true; });
          if (res.writableEnded) return;
          if (!nextCalled) break;
        }
      } catch (err) {
        console.error('[router] handler error:', err);
        if (!res.writableEnded) {
          res.statusCode = 500;
          res.json({ error: 'خطای داخلی سرور', detail: err.message });
        }
      }
      return;
    }

    res.statusCode = 404;
    res.json({ error: 'مسیر یافت نشد', path: pathname });
  }
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { resolve({}); }
    });
  });
}

module.exports = { Router };
