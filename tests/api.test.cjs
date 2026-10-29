const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const { createApi } = require('../notarium-server.js');

async function request(api, path, method = 'GET', payload, token) {
  const req = Readable.from(payload ? [Buffer.from(JSON.stringify(payload))] : []);
  req.method = method;
  req.headers = { host: 'example.test', 'x-forwarded-proto': 'https', authorization: token ? `Bearer ${token}` : '' };
  req.socket = { remoteAddress: 'test' };
  let status, body;
  await api.handleApi(req, {
    writeHead(code) { status = code; },
    end(value) { body = JSON.parse(value); },
  }, new URL(path, 'https://example.test'));
  return { status, body };
}

test('setup, sign-in across instances, authorization, and logout', async () => {
  const api = createApi({ persist: async () => {} });
  const credentials = { name: 'Professor', username: 'professor', password: randomUUID() };
  assert.equal((await request(api, '/api/setup')).body.teacherExists, false);
  assert.equal((await request(api, '/api/model')).status, 401);
  const created = await request(api, '/api/auth/bootstrap', 'POST', credentials);
  assert.equal(created.status, 201);
  assert.equal(created.body.portalUrl, 'https://example.test/?login=1');
  assert.equal((await request(api, '/api/auth/bootstrap', 'POST', credentials)).status, 409);
  const snapshot = api.getState();
  const restarted = createApi({ persist: async () => {} });
  restarted.setState(snapshot.store, snapshot.sessions, snapshot.failures);
  assert.equal((await request(restarted, '/api/model', 'GET', null, created.body.token)).status, 200);
  assert.equal((await request(restarted, '/api/auth/login', 'POST', { ...credentials, password: randomUUID() })).status, 401);
  const login = await request(restarted, '/api/auth/login', 'POST', credentials);
  assert.equal(login.status, 200);
  assert.equal((await request(restarted, '/api/auth/logout', 'POST', {}, login.body.token)).status, 200);
  assert.equal((await request(restarted, '/api/model', 'GET', null, login.body.token)).status, 401);
  assert.equal((await request(createApi({ persist: async () => {} }), '/api/setup')).body.teacherExists, false);
});
