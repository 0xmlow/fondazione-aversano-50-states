import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../site/assets/field.js');
await build({ entryPoints: [path.join(here, 'src/main.ts')], bundle: true, format: 'iife', target: ['es2020'], minify: !process.argv.includes('--dev'), outfile: out, logLevel: 'info', legalComments: 'none' });
/* stamp the page so a rebuilt bundle is never hidden behind a cached one */
const page = path.resolve(here, '../site/index.html');
if (fs.existsSync(page)) {
  const html = fs.readFileSync(page, 'utf8');
  const stamped = html.replace(/assets\/field\.js(\?b=\d+)?/, 'assets/field.js?b=' + Date.now()).replace(/assets\/field\.css(\?b=\d+)?/, 'assets/field.css?b=' + Date.now());
  if (stamped !== html) fs.writeFileSync(page, stamped);
}
