import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

export async function startServer({ root = resolve(projectRoot, 'Export/html5/bin'), port = 8788 } = {}) {
  root = resolve(root);
  await stat(resolve(root, 'index.html'));
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!path.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      const info = await stat(path);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(path).on('error', () => response.destroy()).pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
  for (;;) {
    try {
      await new Promise((resolveListen, reject) => {
        const onError = error => reject(error);
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', onError);
          resolveListen();
        });
      });
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || port === 0) throw error;
      port += 1;
    }
  }
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, url } = await startServer({ port: Number(process.env.PORT ?? 8788) });
  console.log(`City generator: ${url}`);
  if (process.argv.includes('--open')) {
    spawn('open', [url], { stdio: 'ignore' }).on('error', error => console.error(error.message));
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}