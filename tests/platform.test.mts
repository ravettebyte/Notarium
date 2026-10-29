import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { createApi } from '../netlify/functions/api.mts';
import { domain } from '../server/domain.mjs';
import { validateFile } from '../server/files';
import { restoreInto, restoreOrder, sqlNames, checksum } from '../server/backup-format.mjs';
import { importModel, exportModel } from '../storage.js';
import { createBackup } from '../server/backups';
import * as schema from '../db/schema';
const migration=await readFile(new URL('../server/restore-schema.sql',import.meta.url),'utf8');
const engine=new PGlite();await engine.exec(migration);const db=drizzle({client:engine,schema});
let current:any=null;let queue=Promise.resolve();const credentials=new Map();const blobs=new Map();
const api=createApi({
  refreshSession:async()=>{},getUser:async()=>current,logout:async()=>{current=null;},
  verifyRequestOrigin:(req:Request)=>{if(req.headers.get('origin')!==new URL(req.url).origin) throw {status:403};},
  admin:{createUser:async({email,password}:any)=>{const account={id:randomUUID(),email,password};credentials.set(email,account);return account;},deleteUser:async(id:string)=>{for(const [email,user] of credentials)if(user.id===id)credentials.delete(email);}},
  login:async(email:string,password:string)=>{const account=credentials.get(email);if(!account||account.password!==password)throw Error();current={id:account.id};return current;},
  requestPasswordRecovery:async()=>{throw Error('unknown address');},
  locked:(fn:any)=>{const next=queue.then(()=>db.transaction(tx=>fn(tx)));queue=next.catch(()=>{});return next;},
  filesStore:()=>({set:async(key:string,data:any)=>{blobs.set(key,data);},get:async(key:string)=>blobs.get(key)}),
});
let ip=0;
async function call(path:string,method='GET',body?:any,origin='https://test.invalid'){
 const response=await api(new Request('https://test.invalid'+path,{method,headers:{origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{ip:String(ip++)});
 const data=response.headers.get('Content-Type')?.includes('application/json')?await response.json():await response.arrayBuffer();return {status:response.status,data};
}
const pass=randomUUID()+randomUUID();let teacher:any;let student:any;let second:any;let model:any;
const first={name:'Professor Teste',username:'professor',email:'teacher@example.invalid',password:pass,confirmPassword:pass};
test('complete platform server flows against isolated PostgreSQL',async t=>{
 await t.test('private API denies anonymous requests and CSRF',async()=>{
  assert.equal((await call('/api/model')).status,401);assert.equal((await call('/api/auth/bootstrap','POST',first,'https://foreign.invalid')).status,403);
 });
 await t.test('first teacher registration and persistent reload',async()=>{
  const response=await call('/api/auth/bootstrap','POST',first);assert.equal(response.status,201);assert.equal(response.data.user.isAdmin,true);teacher=current;model=response.data.model;
  assert.equal((await engine.query('SELECT count(*)::int as count FROM users')).rows[0].count,1);
 });
 await t.test('subsequent bootstrap attempts are rejected',async()=>{
  assert.equal((await call('/api/auth/bootstrap','POST',{...first,username:'attacker',email:'other@example.invalid'})).status,409);
 });
 await t.test('controlled student accounts require teacher authorization',async()=>{
  const created=await call('/api/students','POST',{name:'Aluno Um',username:'aluno.um',email:'one@example.invalid',password:pass});assert.equal(created.status,201);student={id:created.data.student.id};
  const other=await call('/api/students','POST',{name:'Aluno Dois',username:'aluno.dois',email:'two@example.invalid',password:pass});assert.equal(other.status,201);second={id:other.data.student.id};
  current=student;assert.equal((await call('/api/students','POST',first)).status,403);assert.equal((await call('/api/teachers','POST',first)).status,403);current=teacher;
 });
 await t.test('lesson and exercise creation, updates, conflict detection',async()=>{
  model.blocks=[{id:'block',title:'Harmonia'}];
  model.lessons=[{id:'lesson',blockId:'block',title:'Tríades',published:true,content:[],exerciseIds:['exercise']}];
  model.exercises=[{id:'exercise',title:'Acordes',published:true,status:'published',lessonIds:['lesson'],questions:[{id:'q',type:'choice',prompt:'Alternativa correta',answer:'a',points:2},{id:'written',type:'written',prompt:'Explique',points:3}]}];
  const result=await call('/api/model','PUT',{model});assert.equal(result.status,200);model.revision=result.data.revision;
  assert.equal((await call('/api/model','PUT',{model:{...model,revision:0}})).status,409);
  model.lessons[0].title='Tríades maiores';const edit=await call('/api/model','PUT',{model});assert.equal(edit.status,200);model.revision=edit.data.revision;
 });
 let attempt:any;
 await t.test('students see no answer keys and cannot read another profile or roster',async()=>{
  current=student;const result=await call('/api/model');assert.equal(result.status,200);assert.equal(result.data.model.exercises[0].questions[0].answer,undefined);assert.equal((await call('/api/students')).status,404);
 });
 await t.test('submission grading happens on server and duplicate answers are rejected',async()=>{
  const source={exerciseId:'exercise',answers:[{questionId:'q',value:'a'},{questionId:'written',value:'Resposta'}]};
  const result=await call('/api/attempts','POST',{attempt:source});assert.equal(result.status,201);attempt=result.data.attempt;assert.equal(attempt.score,2);assert.equal(attempt.studentId,student.id);
  assert.equal((await call('/api/attempts','POST',{attempt:{...source,answers:[source.answers[0],source.answers[0]]}})).status,400);
  current=second;assert.equal((await call('/api/model')).data.model.attempts.length,0);
  assert.equal((await call(`/api/attempts/${attempt.id}/review`,'POST',{scores:{written:3}})).status,404);
 });
 await t.test('teacher feedback and manual partial scores persist',async()=>{
  current=teacher;const result=await call(`/api/attempts/${attempt.id}/review`,'POST',{scores:{written:1.5},teacherNote:'Revise a explicação'});assert.equal(result.status,200);assert.equal(result.data.attempt.score,3.5);
  current=student;const own=(await call('/api/model')).data.model.attempts[0];assert.equal(own.score,3.5);assert.equal(own.teacherNote,'Revise a explicação');
 });
 await t.test('real file upload/download enforces ownership and content validation',async()=>{
  const body={id:'private-document',name:'atividade.pdf',dataUrl:'data:application/pdf;base64,'+Buffer.from('%PDF-1.4\n test').toString('base64')};
  assert.equal((await call('/api/media','POST',body)).status,201);
  assert.equal((await call('/api/media/private-document')).status,200);
  current=second;assert.equal((await call('/api/media/private-document')).status,404);assert.equal((await call('/api/media','POST',body)).status,403);
  assert.throws(()=>validateFile({...body,name:'atividade.html'}));
  assert.throws(()=>validateFile({...body,dataUrl:'data:application/pdf;base64,'+Buffer.from('<script>').toString('base64')}));
 });
 await t.test('individual assignment enforced on submission and listing',async()=>{
  current=teacher;model=(await call('/api/model')).data.model;model.exercises[0].personalizedFor=student.id;
  assert.equal((await call('/api/model','PUT',{model})).status,200);
  current=second;assert.equal((await call('/api/model')).data.model.exercises.length,0);
  assert.equal((await call('/api/attempts','POST',{attempt:{exerciseId:'exercise',answers:[]}})).status,404);
 });
 await t.test('logout, login by username, generic recovery response',async()=>{
  assert.equal((await call('/api/auth/logout','POST',{})).status,200);assert.equal((await call('/api/model')).status,401);
  assert.equal((await call('/api/auth/login','POST',{username:'professor',password:pass})).status,200);
  assert.equal((await call('/api/auth/recover','POST',{email:'absent@example.invalid'})).status,200);
 });
 await t.test('backup restores database rows with foreign keys in a separate PostgreSQL instance',async()=>{
  const tables:any={};for(const name of restoreOrder){tables[name]=(await engine.query(`SELECT * FROM "${sqlNames[name]}"`)).rows;}
  const snapshot={version:1,tables,files:[]};const separate=new PGlite();await separate.exec(migration);await restoreInto(separate,snapshot);
  assert.equal((await separate.query('SELECT count(*)::int as count FROM users')).rows[0].count,3);
  assert.equal((await separate.query('SELECT data FROM attempts')).rows[0].data.score,3.5);
  assert.equal((await engine.query('SELECT count(*)::int as count FROM users')).rows[0].count,3);await separate.close();
 });
 await t.test('daily backup copies actual file bytes and verifies archive integrity',async()=>{
  const target=new Map();
  const backup=await createBackup({database:()=>db,locked:(fn:any)=>db.transaction(fn),filesStore:()=>({get:async(key:string)=>blobs.get(key)}),backupsStore:()=>({set:async(key:string,value:any)=>target.set(key,value),get:async(key:string)=>target.get(key),setJSON:async(key:string,value:any)=>target.set(key,value)})});
  assert.ok(target.has(`${backup.id}/manifest.json`));assert.equal(backup.snapshot.files.length,1);
  for(const file of backup.snapshot.files)assert.equal(checksum(Buffer.from(target.get(file.key))),file.sha256);
  const isolated=new PGlite();await isolated.exec(migration);await restoreInto(isolated,backup.snapshot);
  assert.equal((await isolated.query('SELECT count(*)::int as count FROM users')).rows[0].count,3);await isolated.close();
  const directory=await mkdtemp(path.join(tmpdir(),'notarium-restore-test-'));
  try {
    const zip=new JSZip();zip.file('manifest.json',JSON.stringify(target.get(`${backup.id}/manifest.json`)));zip.file('snapshot.json.gz',target.get(backup.key));
    for(const file of backup.snapshot.files)zip.file(`files/${file.blobKey}`,target.get(file.key));
    const archive=path.join(directory,'backup.zip');await writeFile(archive,await zip.generateAsync({type:'nodebuffer'}));
    await promisify(execFile)(process.execPath,['scripts/restore-check.mjs',archive,path.join(directory,'restored')]);
    const result=JSON.parse(await readFile(path.join(directory,'restored','verification.json'),'utf8'));assert.equal(result.databaseRestored,true);assert.equal(result.filesVerified,1);
  } finally {await rm(directory,{recursive:true,force:true});}

 });
 await t.test('lesson deletion and relational validation',async()=>{
  current=teacher;model=(await call('/api/model')).data.model;model.lessons=[];model.exercises.forEach((e:any)=>e.lessonIds=[]);
  assert.equal((await call('/api/model','PUT',{model})).status,200);assert.equal((await call('/api/model')).data.model.lessons.length,0);
 });
 await t.test('backup import never executes JavaScript',async()=>{
  assert.throws(()=>importModel('export const x = {blocks:[], lessons:[], exercises:[], attempts:[], profile:{}, exploit:(()=>{throw Error("executed")})()};'));
  const clean=domain({model:null},null,()=>{}).emptyModel();assert.deepEqual(importModel(exportModel(clean)).lessons,[]);
 });
 await engine.close();
});
