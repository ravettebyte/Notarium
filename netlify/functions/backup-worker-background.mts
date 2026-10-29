import { createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { locked } from '../../server/repository';
import { backupJobs, notifications } from '../../db/schema';
import { createBackup, pruneBackups } from '../../server/backups';
import { verifyRestore } from '../../server/verify-restore';
import { database } from '../../db/index';
import { randomUUID } from 'node:crypto';
export default async (req:Request) => {
  if(req.method!=='POST') return;
  let body:any;try{body=await req.json();}catch{return;}
  if(typeof body.id!=='string'||typeof body.token!=='string'||body.token.length!==64)return;
  const job=await locked(async tx=>{
    const [row]=await tx.select().from(backupJobs).where(eq(backupJobs.id,body.id));
    if(!row||Date.now()-row.createdAt.getTime()>900000)return null;
    const actual=createHash('sha256').update(body.token).digest();const expected=Buffer.from(row.tokenHash,'hex');
    if(expected.length!==actual.length||!timingSafeEqual(actual,expected))return null;
    await tx.delete(backupJobs).where(eq(backupJobs.id,row.id));return row;
  });
  if(!job)return;
  try{
    if(job.kind==='backup'){await createBackup();await pruneBackups();}
    else if(job.kind==='verify') await verifyRestore();
  }catch{
    if(job.kind==='verify'){
      const id=randomUUID();await database().insert(notifications).values({id,data:{id,recipient:'teacher',type:'restore-failed',title:'Falha na verificação de restauração',message:'Consulte os backups e repita o teste em ambiente separado.',createdAt:new Date().toISOString(),readAt:''}});
    }
    throw new Error('Backup maintenance failed');
  }
};
