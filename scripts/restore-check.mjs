import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { PGlite } from '@electric-sql/pglite';
import JSZip from 'jszip';
import { restoreInto, checksum } from '../server/backup-format.mjs';
// Deliberately has no production connection or destructive restore option.
async function main() {
  const input=process.argv[2];const destination=path.resolve(process.argv[3] || 'private-restore');
  if(!input)throw new Error('Informe o ZIP privado e um diretório de teste inexistente.');
  try{await access(destination);throw new Error('O destino já existe. Use um novo diretório vazio.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const zip=await JSZip.loadAsync(await readFile(input));const manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  const compressed=await zip.file('snapshot.json.gz').async('nodebuffer');
  if(checksum(compressed)!==manifest.sha256)throw new Error('Checksum do banco inválido.');
  const snapshot=JSON.parse(gunzipSync(compressed).toString());
  for(const file of snapshot.files){if(!/^[a-z0-9-]+$/i.test(file.blobKey))throw new Error('Nome inválido.');const data=await zip.file(`files/${file.blobKey}`).async('nodebuffer');if(checksum(data)!==file.sha256 || data.length!==file.size)throw new Error('Arquivo inválido.');}
  await mkdir(destination,{mode:0o700});const engine=new PGlite(path.join(destination,'postgres'));
  try{
    await engine.exec(await readFile(new URL('../server/restore-schema.sql',import.meta.url),'utf8'));
    await restoreInto(engine,snapshot);
    await mkdir(path.join(destination,'files'),{mode:0o700});
    for(const file of snapshot.files)await writeFile(path.join(destination,'files',file.blobKey),await zip.file(`files/${file.blobKey}`).async('nodebuffer'),{mode:0o600});
    await writeFile(path.join(destination,'verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),databaseRestored:true,filesVerified:snapshot.files.length,identityCredentialsRestored:false}),{mode:0o600});
    console.log('Restauração isolada concluída. Registros e checksums dos arquivos verificados. Credenciais Identity exigem recuperação separada.');
  }finally{await engine.close();}
}
main().catch(()=>{console.error('A verificação de restauração falhou. Preserve a cópia original e use um novo destino para repetir.');process.exitCode=1;});
