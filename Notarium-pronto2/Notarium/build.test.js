'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { build, normalizeApiBase } = require('./build');

test('build emits the app and configures the API URL without changing the source HTML', async t => {
  const outputDir = await fs.mkdtemp(path.join(__dirname, '.notarium-build-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const sourceHtml = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
  const result = await build({
    outputDir,
    apiBase: 'https://api.example.test/v1/?key="music"&mode=live'
  });
  const builtHtml = await fs.readFile(path.join(outputDir, 'index.html'), 'utf8');

  assert.equal(result.outputDir, outputDir);
  assert.equal(result.apiBase, 'https://api.example.test/v1/?key="music"&mode=live');
  assert.match(builtHtml, /name="notarium-api-base" content="https:\/\/api\.example\.test\/v1\/\?key=&quot;music&quot;&amp;mode=live"/);
  assert.equal(await fs.readFile(path.join(__dirname, 'index.html'), 'utf8'), sourceHtml);
  for (const file of ['icone.png', 'index.css', 'app.js', 'api-url.js', 'media-store.js', 'musicxml.js', 'piano.js', 'storage.js', 'catalog.js', 'chart.umd.js', 'manifest.webmanifest', 'service-worker.js']) {
    assert.ok((await fs.stat(path.join(outputDir, file))).isFile(), `${file} should be included in the build`);
  }
});

test('build rejects unsupported API URLs and output paths outside the project', async () => {
  assert.throws(() => normalizeApiBase('file:///tmp/api'), /HTTP ou HTTPS/);
  await assert.rejects(
    build({ outputDir: path.join(os.tmpdir(), `notarium-build-outside-${process.pid}`) }),
    /dentro do projeto/
  );
});
