// Bundles ui/app.ts + ui/styles.css into one self-contained dist/demo.html.
// Usage: node scripts/build-ui.mjs [--watch]
import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
await mkdir('dist', { recursive: true });

const writeHtml = async (js) => {
  const css = await readFile('ui/styles.css', 'utf8');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Document Requirement Rules</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
  await writeFile('dist/demo.html', html);
  console.log(`[build-ui] wrote dist/demo.html (${(html.length / 1024).toFixed(1)} KB)`);
};

const options = {
  entryPoints: ['ui/app.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  logLevel: 'warning',
  plugins: [
    {
      name: 'inline-html',
      setup(b) {
        b.onEnd(async (result) => {
          if (result.errors.length) return;
          await writeHtml(result.outputFiles[0].text);
        });
      },
    },
  ],
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[build-ui] watching ui/ and src/ for changes');
} else {
  await build(options);
}
