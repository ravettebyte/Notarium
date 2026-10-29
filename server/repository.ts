import { eq, notInArray, sql } from 'drizzle-orm';
import * as tables from '../db/schema';
import { database } from '../db/index';
export const collections = ['blocks','exerciseBlocks','lessons','exercises','attempts','trails','trailSettings'] as const;
export const allTables = ['users','settings',...collections,'media','notifications','examSessions','rateLimits','backupRuns','compositions','backupJobs'] as const;
export async function locked<T>(action: (tx:any) => Promise<T>) {
  return database().transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(61254001)`);
    return action(tx);
  });
}
export async function loadStore(tx:any) {
  const users = await tx.select().from(tables.users);
  const settings = await tx.select().from(tables.settings).where(eq(tables.settings.id, 'platform'));
  const model:any = { schemaVersion:1, profile:{displayName:'Músico',username:'',role:'teacher',defaultOctave:4}, revision:0, ...settings[0]?.data };
  for (const key of collections) model[key] = (await tx.select().from(tables[key])).map((row:any) => row.data);
  const store:any = { users, model };
  for (const key of ['media','notifications','examSessions'] as const) store[key] = (await tx.select().from(tables[key])).map((row:any) => row.data);
  return store;
}
export async function saveStore(tx:any, store:any) {
  const rows:any = { users: store.users, settings:[{id:'platform',data:Object.fromEntries(Object.entries(store.model).filter(([key])=> !collections.includes(key as any)))}] };
  for (const key of collections) rows[key] = store.model[key].map((data:any) => ({
    id: key === 'trailSettings' ? data.studentId : data.id, data,
    ...(key === 'lessons' ? {blockId:data.blockId || null} : {}),
    ...(['attempts','trails'].includes(key) ? {studentId:data.studentId} : {}),
    ...(key === 'attempts' ? {exerciseId:data.exerciseId} : {}),
  }));
  rows.media = store.media.map((data:any) => ({id:data.id,ownerId:data.ownerId,data}));
  rows.notifications = store.notifications.map((data:any)=>({id:data.id,data}));
  rows.examSessions = store.examSessions.filter((data:any)=>store.users.some((u:any)=>u.id===data.studentId)).map((data:any)=>({id:`${data.examId}:${data.studentId}`,studentId:data.studentId,data}));
  for (const key of ['users','settings',...collections,'media','notifications','examSessions']) {
    const table = (tables as any)[key];
    for (const row of rows[key]) await tx.insert(table).values(row).onConflictDoUpdate({target:table.id,set:row});
  }
  for (const key of ['examSessions','notifications','media','attempts','trails','trailSettings','exercises','lessons','exerciseBlocks','blocks','users']) {
    const table = (tables as any)[key]; const ids = rows[key].map((row:any)=>row.id);
    if (ids.length) await tx.delete(table).where(notInArray(table.id, ids));
    else await tx.delete(table);
  }
}
export async function limit(tx:any, key:string, maximum=8) {
  const [row] = await tx.insert(tables.rateLimits).values({id:key,count:1,resetAt:new Date(Date.now()+900000)}).onConflictDoUpdate({target:tables.rateLimits.id,set:{
    count:sql`CASE WHEN ${tables.rateLimits.resetAt} < now() THEN 1 ELSE ${tables.rateLimits.count} + 1 END`,
    resetAt:sql`CASE WHEN ${tables.rateLimits.resetAt} < now() THEN now() + interval '15 minutes' ELSE ${tables.rateLimits.resetAt} END`,
  }}).returning();
  return row.count <= maximum;
}
