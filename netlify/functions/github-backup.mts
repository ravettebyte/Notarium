import { encryptBackup } from '../lib/backup';
import { withClassroom, mediaStore } from '../lib/classroom';
import { db } from '../../db/index';
import { classroom } from '../../db/schema';

export default async () => {
  const token = Netlify.env.get('NOTARIUM_GITHUB_BACKUP_TOKEN');
  const repository = Netlify.env.get('NOTARIUM_GITHUB_BACKUP_REPOSITORY');
  const encryptionKey = Netlify.env.get('NOTARIUM_BACKUP_ENCRYPTION_KEY');
  const recordStatus = async (data: unknown) => {
    await db.insert(classroom).values({ id: 'backup-status', data }).onConflictDoUpdate({ target: classroom.id, set: { data, updatedAt: new Date() } });
  };
  if (!token || !repository || !encryptionKey) {
    await recordStatus({ status: 'pending_configuration', message: 'O backup no GitHub precisa de configuração na hospedagem.' });
    return;
  }
  try {
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw new Error('Invalid repository');
    const snapshot = await withClassroom(async store => JSON.parse(JSON.stringify(store)));
    if (!snapshot.users.length) return;
    // Passwords, Identity tokens and sessions are never part of the application snapshot.
    for (const file of snapshot.media) {
      const data = await mediaStore().get(file.id, { type: 'arrayBuffer' });
      if (!data) throw new Error('Missing media');
      file.data = Buffer.from(data).toString('base64');
    }
    const encrypted = encryptBackup(snapshot, encryptionKey);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const endpoint = `https://api.github.com/repos/${repository}/contents/backups/notarium.enc.json`;
    const current = await fetch(endpoint, { headers });
    let sha: string | undefined;
    if (current.ok) {
      const existing: any = await current.json();
      sha = existing.sha;
      if (existing.content) {
        const previous = JSON.parse(Buffer.from(existing.content, 'base64').toString('utf8'));
        if (previous.checksum === encrypted.checksum) {
          await recordStatus({ status: 'ok', checkedAt: new Date().toISOString(), message: 'Backup atualizado.' });
          return;
        }
      }
    } else if (current.status !== 404) throw new Error('Repository unavailable');
    const content = Buffer.from(JSON.stringify(encrypted)).toString('base64');
    if (content.length > 90 * 1024 * 1024) throw new Error('Backup too large');
    const result = await fetch(endpoint, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Atualizar backup criptografado do Notarium [skip ci]', content, ...(sha ? { sha } : {}) }),
    });
    if (!result.ok) throw new Error('Backup rejected');
    await recordStatus({ status: 'ok', savedAt: new Date().toISOString(), message: 'Backup criptografado salvo no GitHub.' });
  } catch {
    await recordStatus({ status: 'error', checkedAt: new Date().toISOString(), message: 'Falha no backup. Confira as permissões, o repositório e a chave na hospedagem.' });
    throw new Error('Não foi possível atualizar o backup do Notarium.');
  }
};

export const config = { schedule: '@hourly' };
