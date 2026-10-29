import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { database } from '../db/index';
import * as schema from '../db/schema';
import { locked, allTables } from './repository';
import { filesStore, backupsStore, digest } from './files';
import { restoreOrder, sqlNames, validateSnapshot } from './backup-format.mjs';
export async function createBackup(overrides:any = {}) {
  const services={database,locked,filesStore,backupsStore,...overrides};
  const db=services.database(); const id=`${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`;
  await db.insert(schema.backupRuns).values({id,status:'running'});
  try {
    const snapshot:any=await services.locked(async tx=>{
      const tables:any={};
      for (const name of allTables) {
        const result:any=await tx.execute(sql.raw(`SELECT * FROM "${sqlNames[name]}"`));
        tables[name]=result.rows || result;
      }
      return {version:1,id,createdAt:new Date().toISOString(),timezone:'UTC',tables,files:[],configuration:{runtime:'Node 22',schedule:'0 3 * * *',services:['Netlify Database','Netlify Blobs','Netlify Identity'],identityCredentialsIncluded:false}};
    });
    const target=services.backupsStore(); const source=services.filesStore();
    for (const row of snapshot.tables.media) {
      const record=row.data; const bytes=await source.get(record.blobKey,{type:'arrayBuffer'});
      if (!bytes || digest(Buffer.from(bytes))!==record.sha256) throw new Error('file_integrity');
      const key=`${id}/files/${record.blobKey}`;
      await target.set(key,bytes);
      const copied=await target.get(key,{type:'arrayBuffer'});
      if (!copied || digest(Buffer.from(copied))!==record.sha256) throw new Error('copy_integrity');
      snapshot.files.push({key,blobKey:record.blobKey,sha256:record.sha256,size:bytes.byteLength});
    }
    validateSnapshot(snapshot);
    const compressed=gzipSync(JSON.stringify(snapshot)); const key=`${id}/snapshot.json.gz`;
    await target.set(key,new Uint8Array(compressed).buffer);
    const read=await target.get(key,{type:'arrayBuffer'});
    if (!read || digest(Buffer.from(read))!==digest(compressed)) throw new Error('snapshot_integrity');
    validateSnapshot(JSON.parse(gunzipSync(Buffer.from(read)).toString()));
    // Manifest appears only after every file and the snapshot have been verified.
    await target.setJSON(`${id}/manifest.json`,{version:1,id,snapshot:key,sha256:digest(compressed),files:snapshot.files,createdAt:snapshot.createdAt});
    await db.update(schema.backupRuns).set({status:'complete',manifest:`${id}/manifest.json`,finishedAt:new Date()}).where(eq(schema.backupRuns.id,id));
    return {id,key,snapshot};
  } catch {
    await db.update(schema.backupRuns).set({status:'failed',error:'backup_failed',finishedAt:new Date()}).where(eq(schema.backupRuns.id,id));
    const notificationId=randomUUID();
    await db.insert(schema.notifications).values({id:notificationId,data:{id:notificationId,recipient:'teacher',type:'backup-failed',title:'Falha no backup diário',message:'A cópia diária falhou. Consulte o monitor de backups e preserve a última cópia válida.',createdAt:new Date().toISOString(),readAt:''}});
    throw new Error('backup_failed');
  }
}
export async function pruneBackups() {
  const raw=Number(process.env.BACKUP_RETENTION_DAYS || 30);
  const days=Number.isFinite(raw)?Math.min(3650,Math.max(30,raw)):30;
  const cutoff=Date.now()-days*86400000;const target=backupsStore();
  const rows=await database().select().from(schema.backupRuns);
  const complete=rows.filter(r=>r.status==='complete').sort((a,b)=>b.startedAt.getTime()-a.startedAt.getTime());
  // Preserve the latest valid copy, the newest 30, plus weekly and monthly checkpoints.
  for (const [index,row] of complete.entries()) {
    if(index<30 || row.startedAt.getTime()>=cutoff || row.startedAt.getUTCDay()===0 || row.startedAt.getUTCDate()===1) continue;
    const {blobs}=await target.list({prefix:`${row.id}/`});
    for(const blob of blobs) await target.delete(blob.key);
    await database().update(schema.backupRuns).set({status:'expired'}).where(eq(schema.backupRuns.id,row.id));
  }
}
