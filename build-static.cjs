const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');
async function build() {
  const destination = path.join(__dirname, 'dist');
  await fs.mkdir(destination, {recursive:true});
  const publicFiles = ['index.html','icone.png','notarium.css','chart.umd.js','jszip.min.js','opensheetmusicdisplay.min.js'];
  for (const file of publicFiles) await fs.copyFile(path.join(__dirname,file),path.join(destination,file));
  await esbuild.build({entryPoints:['app.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:path.join(destination,'app.js'),minify:true});
}
build().catch(()=>{console.error('Falha na preparação dos arquivos públicos.');process.exitCode=1;});
