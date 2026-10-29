const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApi } = require('../notarium-server');
const { createJiti } = require('jiti');
const { randomBytes, createDecipheriv } = require('node:crypto');
const jiti = createJiti(__filename);

function fixture() {
  const model = createApi().emptyModel();
  model.profile.bio = 'Teacher biography';
  model.lessons = [{ id: 'published', published: true, blockId: 'block', exerciseIds: [], content: [] }, { id: 'draft', published: false, blockId: 'block', exerciseIds: [], content: [] }];
  model.blocks = [{ id: 'block' }];
  model.attempts = [{ id: 'a', studentId: 'one', profileName: 'Same name' }, { id: 'b', studentId: 'two', profileName: 'Same name' }, { id: 'legacy', profileName: 'Same name' }];
  model.trails = [{ id: 'step', studentId: 'one', completed: true, status: 'completed' }, { id: 'other-step', studentId: 'two' }];
  return { model, users: [
    { id: 'teacher', name: 'Teacher', username: 'teacher', role: 'teacher', profile: {} },
    { id: 'one', name: 'Same name', username: 'one', role: 'student', profile: { bio: 'Personal biography', theme: 'dark' } },
    { id: 'two', name: 'Same name', username: 'two', role: 'student', profile: {} },
  ], media: [], notifications: [], examSessions: [] };
}
async function request(api, route, method = 'GET', body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body || {}))]);
  req.method = method; req.headers = {}; req.socket = {};
  let status, result;
  await api.handleApi(req, { writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } }, new URL(route, 'https://example.test'));
  return { status, result };
}

test('students receive only their own profile, answers and trail, even when names match', () => {
  const store = fixture();
  const api = createApi({ store });
  const view = api.modelFor(store.users[1]);
  assert.equal(view.profile.bio, 'Personal biography');
  assert.equal(view.profile.theme, 'dark');
  assert.deepEqual(view.attempts.map(item => item.id), ['a']);
  assert.deepEqual(view.trails.map(item => item.id), ['step']);
  assert.deepEqual(view.lessons.map(item => item.id), ['published']);
  assert.equal(api.modelFor(store.users[2]).profile.bio, '');
});

test('student cannot replace the classroom model', async () => {
  const store = fixture(); let writes = 0;
  const api = createApi({ store, userId: 'one', persist: async () => writes++ });
  assert.equal((await request(api, '/api/model', 'PUT', { model: store.model })).status, 403);
  assert.equal(writes, 0);
});

test('teacher content saves preserve student progress from another device', async () => {
  const store = fixture(); let writes = 0;
  const copy = JSON.parse(JSON.stringify(store.model));
  copy.trails[0].completed = false; copy.trails[0].status = 'pending';
  const api = createApi({ store, userId: 'teacher', persist: async () => writes++ });
  assert.equal((await request(api, '/api/model', 'PUT', { model: copy })).status, 200);
  assert.equal(store.model.trails[0].completed, true);
  assert.equal(writes, 1);
});

test('profile edits persist independently of classroom content', async () => {
  const store = fixture(); let writes = 0;
  const api = createApi({ store, userId: 'one', persist: async () => writes++ });
  const result = await request(api, '/api/account/profile', 'PUT', { name: 'Updated', username: 'one', bio: 'Updated bio', theme: 'dark', defaultOctave: 5 });
  assert.equal(result.status, 200);
  assert.equal(api.modelFor(store.users[1]).profile.bio, 'Updated bio');
  assert.equal(api.modelFor(store.users[2]).profile.bio, '');
  assert.equal(writes, 1);
});

test('GitHub backup is authenticated ciphertext and rejects tampering', async () => {
  const { encryptBackup } = await jiti.import('../netlify/lib/backup.ts');
  const key = randomBytes(32);
  const snapshot = { users: [{ name: 'Private learner' }], model: { lessons: [] } };
  const encrypted = encryptBackup(snapshot, key.toString('base64'));
  assert.ok(!JSON.stringify(encrypted).includes('Private learner'));
  const decrypt = tag => {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]);
  };
  assert.deepEqual(JSON.parse(decrypt(Buffer.from(encrypted.tag, 'base64'))), snapshot);
  assert.throws(() => decrypt(Buffer.alloc(16)));
  assert.throws(() => encryptBackup(snapshot, 'invalid'));
});
