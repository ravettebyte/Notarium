import { referenceWav } from '../../server/audio.mjs';
import { canAccess } from '../../server/policy.mjs';
import { admin, login, logout, getUser, refreshSession, requestPasswordRecovery, verifyRequestOrigin } from '@netlify/identity';
import { createHash } from 'node:crypto';
import { locked, loadStore, saveStore, limit } from '../../server/repository';
import { domain } from '../../server/domain.mjs';
import { filesStore, backupsStore, validateFile } from '../../server/files';
import { backupRuns, compositions } from '../../db/schema';
import { desc, eq } from 'drizzle-orm';
function json(value:any,status=200) {return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
function fail(message:string,status=400):never {throw Object.assign(new Error(message),{status});}
export function createApi(overrides:any = {}) {
const services={admin,login,logout,getUser,refreshSession,requestPasswordRecovery,verifyRequestOrigin,locked,filesStore,...overrides};
const {admin:accounts,login:signIn,logout:signOut,getUser:readUser,refreshSession:refresh,requestPasswordRecovery:recover,verifyRequestOrigin:verify,locked:transaction,filesStore:objects}=services;
return async (req:Request, context:any) => {
  const route = new URL(req.url).pathname;
  try {
    if (!['GET','POST','PUT','DELETE'].includes(req.method)) return json({error:'Método não permitido.'},405);
    if (req.method !== 'GET') verify(req);
    const raw = req.method === 'GET' ? '' : await req.text();
    if (raw.length > 4400000) return json({error:'Solicitação muito grande.'},413);
    let body:any; try {body=raw ? JSON.parse(raw) : {};} catch {return json({error:'JSON inválido.'},400);}
    if (route === '/api/auth/logout') {await signOut();return json({ok:true});}
    await refresh();
    const identity = await readUser();
    return await transaction(async tx => {
      const store = await loadStore(tx);
      const actor = identity && store.users.find((u:any)=>u.id===identity.id);
      const api = domain(store,actor,(value:any)=>saveStore(tx,value));
      const ipKey = createHash('sha256').update(context.ip || 'unknown').digest('hex');
      if (['/api/auth/login','/api/auth/bootstrap','/api/auth/recover'].includes(route)) {
        if (req.method !== 'POST') return json({error:'Método não permitido.'},405);
        if (!await limit(tx,`auth:${ipKey}`,12)) return json({error:'Muitas tentativas. Aguarde 15 minutos.'},429);
      }
      if (route === '/api/auth/recover') {
        try {await recover(String(body.email || '').trim());} catch { /* Same response for all addresses. */ }
        return json({message:'Se houver uma conta para esse e-mail, você receberá as instruções.'});
      }
      if (route === '/api/auth/bootstrap' || route === '/api/students' && req.method === 'POST' || route === '/api/teachers' && req.method === 'POST') {
        const first = route === '/api/auth/bootstrap';
        if (first && store.users.some((u:any)=>u.isAdmin)) return json({error:'A primeira conta já foi configurada.'},409);
        if (!first && (!actor || actor.role !== 'teacher')) return json({error:'Acesso negado.'},403);
        if (!first && route === '/api/teachers' && !actor.isAdmin) return json({error:'Somente o administrador autoriza professores.'},403);
        const name=String(body.name || '').trim(); const username=String(body.username || '').trim().toLowerCase(); const email=String(body.email || '').trim().toLowerCase(); const password=String(body.password || '');
        if (name.length<3 || name.length>100 || !/^[a-z0-9._-]{3,30}$/.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || password.length<12 || password.length>128) return json({error:'Informe nome completo, usuário válido, e-mail e senha de 12 a 128 caracteres.'},400);
        if (first && body.confirmPassword !== password) return json({error:'A confirmação da senha não corresponde.'},400);
        if (store.users.some((u:any)=>u.username===username || u.email===email)) return json({error:'Usuário ou e-mail indisponível.'},409);
        const created = await accounts.createUser({email,password,data:{user_metadata:{full_name:name}}});
        const account={id:created.id,email,username,name,role:first||route==='/api/teachers'?'teacher':'student',isAdmin:first,profile:{},createdAt:new Date().toISOString(),lastSeenAt:null};
        store.users.push(account); await saveStore(tx,store);
        // A created Identity account without a DB membership has no platform access.
        if (first) {await signIn(email,password);return json({user:api.publicUser(account),model:api.modelFor(account),portalUrl:new URL('/',req.url).href},201);}
        return json({student:api.publicUser(account),portalUrl:new URL('/',req.url).href},201);
      }
      if (route === '/api/auth/login') {
        const key=String(body.username || '').trim().toLowerCase();
        if (!await limit(tx,`account:${createHash('sha256').update(key).digest('hex')}`,8)) return json({error:'Muitas tentativas. Aguarde 15 minutos.'},429);
        const account=store.users.find((u:any)=>u.username===key || u.email===key);
        try {
          if (!account) return json({error:'Usuário ou senha incorretos.'},401);
          await signIn(account.email,String(body.password || ''));
          account.lastSeenAt=new Date().toISOString();await saveStore(tx,store);
          return json({user:api.publicUser(account),model:api.modelFor(account),portalUrl:new URL('/',req.url).href});
        } catch {return json({error:'Usuário ou senha incorretos.'},401);}
      }
      if (route==='/api/session' && actor) return json({authenticated:true,user:api.publicUser(actor),model:api.modelFor(actor)});
      const audioRoute=/^\/api\/exercises\/([^/]+)\/audio\/([^/]+)$/.exec(route);
      if (audioRoute) {
        if (!actor || req.method!=='GET') return json({error:'Acesso negado.'},403);
        const exercise=store.model.exercises.find((item:any)=>item.id===audioRoute[1]);
        if(!exercise || !canAccess(exercise,actor)) return json({error:'Atividade indisponível.'},404);
        if(actor.role==='student'&&exercise.assessment){
          const session=store.examSessions.find((s:any)=>s.examId===exercise.id&&s.studentId===actor.id);
          if(!session||session.locked) return json({error:'Abra a avaliação primeiro.'},403);
        }
        const question=exercise.questions.find((q:any)=>q.id===audioRoute[2]);
        const data=referenceWav(question?.referenceNotes);
        return new Response(data,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
      if (route==='/api/composition') {
        if (!actor) return json({error:'Entre na sua conta.'},401);
        if (req.method==='GET') {const [row]=await tx.select().from(compositions).where(eq(compositions.id,actor.id));return json({composition:row?.data || {title:'Minha composição',notes:'C4 D4 E4 F4 G4',tempo:90}});}
        if (req.method!=='PUT') return json({error:'Método não permitido.'},405);
        const notes=String(body.notes || '').trim().split(/\s+/);const tempo=Number(body.tempo);
        if (!notes.length || notes.length>256 || notes.some(n=>!(/^[A-G](#|b)?[0-8]$/.test(n)||n==='R')) || !Number.isInteger(tempo)||tempo<30||tempo>240) return json({error:'Use até 256 notas como C4 D#4 Bb3 ou R para pausa, e andamento de 30 a 240.'},400);
        const data={title:String(body.title || 'Minha composição').slice(0,100),notes:notes.join(' '),tempo};
        await tx.insert(compositions).values({id:actor.id,data}).onConflictDoUpdate({target:compositions.id,set:{data}});return json({composition:data});
      }
      const backupDownload = /^\/api\/backups\/([^/]+)\/(manifest|snapshot|file)$/.exec(route);
      if (backupDownload) {
        if (!actor?.isAdmin || req.method!=='GET') return json({error:'Acesso negado.'},403);
        const [run]=await tx.select().from(backupRuns).where(eq(backupRuns.id,backupDownload[1]));
        if (run?.status!=='complete' || !run.manifest) return json({error:'Backup não encontrado.'},404);
        const backup=backupsStore();const manifest:any=await backup.get(run.manifest,{type:'json'});
        if (!manifest) return json({error:'Backup indisponível.'},404);
        if (backupDownload[2]==='manifest') return json(manifest);
        const fileKey=new URL(req.url).searchParams.get('key');
        const key=backupDownload[2]==='snapshot' ? manifest.snapshot : manifest.files.find((file:any)=>file.key===fileKey)?.key;
        if (!key) return json({error:'Arquivo não encontrado.'},404);
        const data=await backup.get(key,{type:'arrayBuffer'});if(!data) return json({error:'Arquivo indisponível.'},404);
        return new Response(data,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
      if (route==='/api/backups' && actor?.isAdmin) return json({runs:await tx.select().from(backupRuns).orderBy(desc(backupRuns.startedAt)).limit(40)});
      if (route==='/api/account/export' && actor) return json({user:api.publicUser(actor),profile:actor.profile,model:api.modelFor(actor)});
      if (route==='/api/model' && req.method==='PUT' && actor?.role==='teacher') {
        if (body.model?.revision !== store.model.revision) return json({error:'O conteúdo mudou em outra sessão. Atualize a página antes de editar.'},409);
        body.model.revision=store.model.revision+1;
      }
      if (route.startsWith('/api/media')) {
        if (!actor) return json({error:'Entre na sua conta.'},401);
        if (route==='/api/media' && req.method==='POST') {
          const existing=store.media.find((m:any)=>m.id===body.id);
          if (existing && existing.ownerId!==actor.id) return json({error:'Arquivo privado.'},403);
          const file=validateFile(body);
          await objects().set(file.blobKey,new Uint8Array(file.data).buffer);
          const record={id:body.id,ownerId:actor.id,name:file.name,type:file.type,size:file.data.length,blobKey:file.blobKey,sha256:file.sha256,updatedAt:new Date().toISOString()};
          store.media=store.media.filter((m:any)=>m.id!==body.id);store.media.push(record);await saveStore(tx,store);
          return json({id:record.id,name:record.name,type:record.type,size:record.size},201);
        }
        const id=decodeURIComponent(route.split('/').pop() || ''); const record=store.media.find((m:any)=>m.id===id);
        if (!record || (actor.role!=='teacher' && record.ownerId!==actor.id && !api.referencedMediaIds(api.modelFor(actor)).has(id))) return json({error:'Arquivo não encontrado.'},404);
        if (req.method==='DELETE') {
          if (record.ownerId!==actor.id && !actor.isAdmin) return json({error:'Acesso negado.'},403);
          if (api.referencedMediaIds(store.model).has(id)) return json({error:'Remova os vínculos do material antes de excluí-lo.'},409);
          store.media=store.media.filter((m:any)=>m.id!==id);await saveStore(tx,store);
          // Immutable objects are reclaimed after retention; existing backups remain valid.
          return json({deleted:true});
        }
        if (req.method!=='GET') return json({error:'Método não permitido.'},405);
        const data=await objects().get(record.blobKey,{type:'arrayBuffer'});
        if (!data) return json({error:'Arquivo indisponível.'},404);
        return new Response(data,{headers:{'Content-Type':record.type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(record.name)}`,'X-Media-Name':encodeURIComponent(record.name),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
      }
      // Students removed by teachers also lose their Identity account.
      if (/^\/api\/students\/[^/]+$/.test(route)&&req.method==='DELETE'&&actor?.role==='teacher') {
        const student=store.users.find((u:any)=>u.id===route.split('/').pop()&&u.role==='student');
        if (student) {
          if (store.media.some((m:any)=>m.ownerId===student.id&&api.referencedMediaIds({...store.model,attempts:[]}).has(m.id))) return json({error:'Transfira ou remova os materiais publicados deste aluno antes de excluir a conta.'},409);
          store.media=store.media.filter((m:any)=>m.ownerId!==student.id);
          store.model.trails=store.model.trails.filter((t:any)=>t.studentId!==student.id);
          store.model.trailSettings=store.model.trailSettings.filter((t:any)=>t.studentId!==student.id);
          await accounts.deleteUser(student.id);
        }
      }
      const response:any={};
      await api.handleApi({method:req.method,body,headers:{host:new URL(req.url).host}},response,new URL(req.url));
      if (route==='/api/model'&&req.method==='PUT'&&response.status===200) response.value.revision=store.model.revision;
      return json(response.value,response.status);
    });
  } catch (error:any) {
    // Provider messages may contain private values; never echo them or log request bodies.
    return json({error:error.status && error.status<500 ? 'Solicitação inválida ou não autorizada.' : 'Serviço indisponível. Tente novamente.'},error.status && error.status<500 ? error.status : 503);
  }
};
}
export default createApi();
export const config = {path:'/api/*'};
