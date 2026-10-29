import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { database } from '../db/index';
import { backupRuns } from '../db/schema';
import { backupsStore, digest } from './files';
import { restoreInto } from './backup-format.mjs';
import { eq, desc } from 'drizzle-orm';
export async function verifyRestore() {
  const db=database();const [run]=await db.select().from(backupRuns).where(eq(backupRuns.status,'complete')).orderBy(desc(backupRuns.startedAt)).limit(1);
  if (!run?.manifest) throw new Error('No complete backup');
  const store=backupsStore();const manifest:any=await store.get(run.manifest,{type:'json'});
  const bytes=await store.get(manifest.snapshot,{type:'arrayBuffer'});
  if(!bytes || digest(Buffer.from(bytes))!==manifest.sha256) throw new Error('Backup checksum mismatch');
  const snapshot=JSON.parse(gunzipSync(Buffer.from(bytes)).toString());
  const engine=new PGlite();
  try {
    const migration=await readFile(`${process.cwd()}/server/restore-schema.sql`,'utf8');
    await engine.exec(migration);
    await restoreInto(engine,snapshot);
    for(const file of snapshot.files){const data=await store.get(file.key,{type:'arrayBuffer'});if(!data || digest(Buffer.from(data))!==file.sha256) throw new Error('Invalid restored file');}
    await db.update(backupRuns).set({verifiedAt:new Date()}).where(eq(backupRuns.id,run.id));
  } catch {
    await db.update(backupRuns).set({error:'restore_verification_failed'}).where(eq(backupRuns.id,run.id));
    throw new Error('Restore verification failed');
  } finally {await engine.close();}
};
