const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname);
const output = path.join(root, 'dist');
const files = [
  'icone.png',
  'notarium.css',
  'catalog.json',
  'app.js',
  'api-url.js',
  'media-store.js',
  'musicxml.js',
  'piano.js',
  'storage.js',
  'chart.umd.js',
  'jszip.min.js',
  'opensheetmusicdisplay.min.js'
];

async function build() {
  await fs.mkdir(output, { recursive: true });
  for (const file of files) {
    const source = path.join(root, file);
    await fs.copyFile(source, path.join(output, file));
  }
  const apiBase = ''; // The Netlify API runs on this site's own origin.
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const configuredHtml = html.replace(
    /(<meta name="notarium-api-base" content=")[^"]*(">)/,
    `$1${apiBase.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}$2`
  );
  await fs.writeFile(path.join(output, 'index.html'), configuredHtml, 'utf8');
  console.log('Notarium preparado com API integrada e arquivos públicos selecionados.');
}

build().catch(error => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});