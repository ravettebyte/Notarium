import { getStore } from '@netlify/blobs';

// Armazenamento persistente do Notarium no Netlify Blobs.
export function createBlobStorage() {
  const data = getStore({ name: 'notarium-data', consistency: 'strong' });
  const media = getStore({ name: 'notarium-media', consistency: 'strong' });
  const backups = getStore({ name: 'notarium-backups', consistency: 'strong' });

  return {
    async init() {},
    async readStore() {
      return data.get('store.json', { type: 'text' });
    },
    async writeStore(content) {
      await data.set('store.json', content);
    },
    async backup(content) {
      const key = `store-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      await backups.set(key, content);
      const { blobs } = await backups.list();
      const keys = blobs.map(blob => blob.key).filter(name => /^store-.*\.json$/.test(name)).sort();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - 30)).map(old => backups.delete(old)));
    },
    async writeMedia(filename, buffer) {
      await media.set(filename, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    },
    async readMedia(filename) {
      const content = await media.get(filename, { type: 'arrayBuffer' });
      if (content === null) {
        const error = new Error('Media not found.');
        error.code = 'ENOENT';
        throw error;
      }
      return Buffer.from(content);
    },
    async deleteMedia(filename) {
      await media.delete(filename);
    }
  };
}
