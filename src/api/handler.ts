import { createExpressApp } from '../../server.ts';

const app = createExpressApp();

export default function handler(req: any, res: any) {
  // Garantir que a URL recebida via Vercel Serverless Function preserve o caminho original esperado pelo Express
  const rawUrl = typeof req.url === 'string' ? req.url : '';
  const headers = req.headers || {};

  // Se req.url já contiver o caminho da API (ex: /api/auth/login ou /auth/login), preservamos
  let targetPath = '';

  if (rawUrl && rawUrl !== '/' && rawUrl !== '/api' && rawUrl !== '/api/') {
    targetPath = rawUrl;
  } else if (headers['x-now-route-matches']) {
    try {
      const parts = new URLSearchParams(headers['x-now-route-matches']);
      const subpath = parts.get('1') || parts.get('0');
      if (subpath) {
        targetPath = `/api/${decodeURIComponent(subpath)}`;
      }
    } catch {
      // noop
    }
  } else if (headers['x-matched-path'] && headers['x-matched-path'] !== '/api' && headers['x-matched-path'] !== '/api/') {
    targetPath = headers['x-matched-path'];
  } else if (headers['x-forwarded-uri'] && headers['x-forwarded-uri'] !== '/api' && headers['x-forwarded-uri'] !== '/api/') {
    targetPath = headers['x-forwarded-uri'];
  }

  if (targetPath) {
    if (!targetPath.startsWith('/api')) {
      targetPath = `/api${targetPath.startsWith('/') ? '' : '/'}${targetPath}`;
    }
    req.url = targetPath;
  } else if (rawUrl && !rawUrl.startsWith('/api')) {
    req.url = `/api${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
  }

  return app(req, res);
}
