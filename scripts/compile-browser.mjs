import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import puppeteer from '/tmp/mindar-compile/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

async function compileTargets(targets, outputName) {
  const routes = targets.map((t, i) => ({ ...t, route: `/img${i}` }));
  const buffers = routes.map((t) => fs.readFileSync(path.join(ASSETS, t.file)));
  const OUTPUT = path.join(ROOT, 'public', outputName);

  const HTML = `<!DOCTYPE html><html><body>
<script type="module">
import { Compiler } from 'https://cdn.jsdelivr.net/npm/mind-ar@1.2.5/dist/mindar-image.prod.js';
try {
  const imgs = [];
  for (const route of ${JSON.stringify(routes.map((t) => t.route))}) {
    const res = await fetch(route);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    imgs.push(img);
  }
  const compiler = new Compiler();
  await compiler.compileImageTargets(imgs, (p) => console.log('progress', p));
  const data = await compiler.exportData();
  window.__RESULT__ = Array.from(new Uint8Array(data));
} catch (e) { window.__ERROR__ = e.message; }
</script></body></html>`;

  const server = http.createServer((req, res) => {
    const hit = routes.find((t) => t.route === req.url);
    if (hit) {
      res.writeHead(200, { 'Content-Type': hit.mime });
      res.end(buffers[routes.indexOf(hit)]);
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
    }
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  page.on('console', (m) => console.log('PAGE:', m.text()));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction('window.__RESULT__ || window.__ERROR__', { timeout: 300000 });
  const err = await page.evaluate(() => window.__ERROR__);
  if (err) throw new Error(err);
  const result = await page.evaluate(() => window.__RESULT__);
  fs.writeFileSync(OUTPUT, Buffer.from(result));
  console.log('OK:', outputName, result.length, 'bytes,', targets.length, 'targets');
  await browser.close();
  server.close();
}

const require = createRequire(import.meta.url);
const targets = require('./targets-manifest.js');

await compileTargets(targets, 'targets.mind');
await compileTargets([targets[3]], 'targets-building.mind');
await compileTargets([targets[4], targets[5]], 'targets-bay12.mind');
await compileTargets(targets.slice(0, 3), 'targets-poson.mind');
await compileTargets([targets[6]], 'targets-thirdplace.mind');
