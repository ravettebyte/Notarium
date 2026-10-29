import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { database } from '../db/index';
import { backupJobs } from '../db/schema';
export async function dispatchBackup(req:Request,kind:'backup'|'verify') {
  const token=randomBytes(32).toString('hex');const id=randomUUID();
  const tokenHash=createHash('sha256').update(token).digest('hex');
  await database().insert(backupJobs).values({id,tokenHash,kind});
  const origin=process.env.URL || req.url;
  const response=await fetch(new URL('/.netlify/functions/backup-worker-background',origin),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,token})});
  if(!response.ok) throw new Error('Backup dispatch failed');
}
