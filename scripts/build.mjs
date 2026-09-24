// Bundles the app into one self-contained HTML file: dist/filament.html
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const [js, css] = await Promise.all([
  build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false }),
  build({ entryPoints: ['src/style.css'], bundle: true, minify: true, write: false }),
]);

const html = (await readFile('index.html', 'utf8'))
  .replace('<link rel="stylesheet" href="src/style.css">', () => `<style>${css.outputFiles[0].text.trim()}</style>`)
  .replace('<script type="module" src="src/main.js"></script>', () => `<script>${js.outputFiles[0].text.trim()}</script>`);

await mkdir('dist', { recursive: true });
await writeFile('dist/filament.html', html);
console.log(`dist/filament.html  ${(html.length / 1024).toFixed(1)} KB`);
