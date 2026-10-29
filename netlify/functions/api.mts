import { Readable } from 'node:stream';
import { getDatabase } from '@netlify/database';
import { drizzle } from 'drizzle-orm/netlify-db';
import { getStore } from '@netlify/blobs';
import { records } from '../../db/schema.ts';
import server from '../../notarium-server.js';

// A fresh handler per request keeps concurrent users isolated. The database lock
// serializes updates across function instances, including first-account creation.
export default async (request: Request, context: any) => {
  if (new URL(request.url).pathname === '/api/health') {
    return Response.json({ status: 'ok' });
  }
  let client;
  try {
    client = await getDatabase().pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(782149)");
    const db = drizzle({ client: { driver: 'server', pool: client, connectionString: '' } });
    const rows = await db.select().from(records);
    const state: any = { users: [], model: null, media: [], notifications: [], examSessions: [] };
    const sessions: any[] = [];
    const failures: any[] = [];
    const originals = new Map<string, string>();
    for (const row of rows) {
      originals.set(`${row.kind}:${row.id}`, JSON.stringify(row.value));
      if (row.kind === 'session') {
        const value: any = row.value;
        if (value.expiresAt > Date.now()) sessions.push([row.id, value.userId]);
      } else if (row.kind === 'failure') {
        if ((row.value as any).resetAt > Date.now()) failures.push([row.id, row.value]);
      } else if (row.kind === 'model') state.model = row.value;
      else if (Array.isArray(state[row.kind])) state[row.kind].push(row.value);
    }
    const branch = context.deploy?.context === 'production' ? 'production' : context.deploy?.id || 'preview';
    const uploads = getStore({ name: `notarium-media-${branch}`, consistency: 'strong' });
    const mediaRoute = /^\/api\/media\/([^/]+)$/.exec(new URL(request.url).pathname);
    if (mediaRoute && request.method === 'GET') {
      const record = state.media.find((item: any) => item.id === decodeURIComponent(mediaRoute[1]));
      if (record?.blobKey) record.data = await uploads.get(record.blobKey);
    }
    const api = server.createApi({ persist: async () => {} });
    api.setState(state, sessions, failures);
    const incoming: any = Readable.from(request.body ? [Buffer.from(await request.arrayBuffer())] : []);
    incoming.method = request.method;
    incoming.headers = Object.fromEntries(request.headers);
    incoming.headers.host = new URL(request.url).host;
    incoming.headers['x-forwarded-proto'] = new URL(request.url).protocol.slice(0, -1);
    incoming.socket = { remoteAddress: context.ip || 'unknown' };
    let status = 200;
    let body: any = '';
    const headers = new Headers();
    const outgoing = {
      writeHead(code: number, values: Record<string, any>) {
        status = code;
        for (const [key, value] of Object.entries(values)) headers.set(key, String(value));
      },
      setHeader(key: string, value: string) { headers.set(key, value); },
      end(value: any = '') { body = value; },
    };
    await api.handleApi(incoming, outgoing, new URL(request.url));
    const result = api.getState();
    const next = new Map<string, any>();
    for (const [kind, value] of Object.entries(result.store)) {
      if (kind === 'model') {
        if (value) next.set('model:main', value);
        continue;
      }
      for (const item of value as any[]) {
        const saved = { ...item };
        if (kind === 'media') {
          if (saved.data && !saved.blobKey) {
            saved.blobKey = `${saved.id}/${crypto.randomUUID()}`;
            await uploads.set(saved.blobKey, saved.data);
          }
          delete saved.data;
        }
        next.set(`${kind}:${saved.id}`, saved);
      }
    }
    for (const [id, userId] of result.sessions) {
      const previous = originals.get(`session:${id}`);
      next.set(`session:${id}`, { userId, expiresAt: previous ? JSON.parse(previous).expiresAt : Date.now() + 86400000 });
    }
    for (const [id, value] of result.failures) next.set(`failure:${id}`, value);
    for (const [key, value] of next) {
      if (originals.get(key) === JSON.stringify(value)) continue;
      const separator = key.indexOf(':');
      await db.insert(records).values({ kind: key.slice(0, separator), id: key.slice(separator + 1), value })
        .onConflictDoUpdate({ target: [records.kind, records.id], set: { value } });
    }
    for (const row of rows) {
      if (!next.has(`${row.kind}:${row.id}`)) {
        // Composite keys avoid deleting records belonging to another collection.
        await client.query('DELETE FROM notarium_records WHERE kind = $1 AND id = $2', [row.kind, row.id]);
      }
    }
    await client.query('COMMIT');
    return new Response(body, { status, headers });
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return Response.json({ error: 'Não foi possível concluir a solicitação. Tente novamente em instantes.' }, { status: 503 });
  } finally {
    client?.release();
  }
};
export const config = { path: '/api/*' };
