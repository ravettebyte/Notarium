import { getStore } from '@netlify/blobs';
import { createHash, randomUUID } from 'node:crypto';
export function filesStore() {
  // Isolate preview uploads from production while keeping them persistent across deploys.
  const branch = process.env.NETLIFY_DB_BRANCH || (process.env.CONTEXT === 'production' ? 'production' : process.env.DEPLOY_PRIME_URL || process.env.BRANCH || 'development');
  return getStore({name:`notarium-files-${createHash('sha256').update(branch).digest('hex').slice(0,16)}`,consistency:'strong'});
}
export function backupsStore() { return getStore({name:'notarium-backups',consistency:'strong'}); }
export function digest(data:Buffer) { return createHash('sha256').update(data).digest('hex'); }
export function validateFile(body:any) {
  const match = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/]+={0,2})$/i.exec(String(body.dataUrl || ''));
  const name = String(body.name || '').replace(/[^\p{L}\p{N} ._()-]/gu,'_').slice(0,150);
  if (!match || !/^[a-z0-9._-]{1,120}$/i.test(body.id || '')) throw Object.assign(new Error('Arquivo inválido.'),{status:400});
  const data = Buffer.from(match[2],'base64');
  if (!data.length || data.length > 3*1024*1024) throw Object.assign(new Error('Limite de 3 MB por arquivo.'),{status:413});
  const ext = name.split('.').pop()?.toLowerCase(); const type = match[1];
  const rules:any = {
    pdf:['application/pdf',()=>data.subarray(0,5).toString()==='%PDF-'],
    png:['image/png',()=>data.subarray(0,8).toString('hex')==='89504e470d0a1a0a'],
    jpg:['image/jpeg',()=>data[0]===255&&data[1]===216], jpeg:['image/jpeg',()=>data[0]===255&&data[1]===216],
    webp:['image/webp',()=>data.subarray(8,12).toString()==='WEBP'],
    mp3:['audio/mpeg',()=>data.subarray(0,3).toString()==='ID3'||(data[0]===255&&(data[1]&224)===224)],
    wav:['audio/wav',()=>data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WAVE'],
    ogg:['audio/ogg',()=>data.subarray(0,4).toString()==='OggS'],
    mp4:['video/mp4',()=>data.subarray(4,8).toString()==='ftyp'],
    webm:['video/webm',()=>data.subarray(0,4).toString('hex')==='1a45dfa3'],
    musicxml:['application/vnd.recordare.musicxml+xml',()=>safeXml(data)], xml:['application/xml',()=>safeXml(data)],
    mxl:['application/vnd.recordare.musicxml',()=>data.subarray(0,2).toString()==='PK'],
  };
  const rule = rules[ext || ''];
  if (!rule || rule[0] !== type || !rule[1]()) throw Object.assign(new Error('Extensão, formato ou conteúdo não permitido.'),{status:400});
  return {data,name,type,sha256:digest(data),blobKey:randomUUID()};
}
function safeXml(data:Buffer) { const text=data.toString('utf8'); return /<(score-partwise|score-timewise)[\s>]/.test(text)&&!/(<!ENTITY|<script)/i.test(text); }
