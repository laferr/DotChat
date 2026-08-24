// 스프라이트 프리뷰용 초간단 정적 서버 (개발 편의용)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5317;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

http
  .createServer((req, res) => {
    // 프리뷰 결과 PNG 저장용 (data URL을 POST하면 tools/preview-out.png로 저장)
    if (req.method === 'POST' && req.url === '/save') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const b64 = body.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(path.join(root, 'tools', 'preview-out.png'), Buffer.from(b64, 'base64'));
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
        res.end('saved');
      });
      return;
    }
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/tools/sprite-preview.html';
    const filePath = path.join(root, urlPath);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(filePath));
  })
  .listen(PORT, () => console.log(`preview server: http://localhost:${PORT}/`));
