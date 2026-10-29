import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { accounts, classroom } from '../../db/schema';
import { getStore } from '@netlify/blobs';

export const emptyState = () => ({ model: null, media: [], notifications: [], examSessions: [] });
export const mediaStore = () => getStore({ name: 'notarium-media', consistency: 'strong' });

// Row locking keeps concurrent student answers and teacher edits from overwriting each other.
export async function withClassroom<T>(operation: (store: any, persist: (value: any) => Promise<void>, tx: any) => Promise<T>): Promise<T> {
  await db.insert(classroom).values({ id: 'main', data: emptyState() }).onConflictDoNothing();
  return db.transaction(async tx => {
    const [row] = await tx.select().from(classroom).where(eq(classroom.id, 'main')).for('update');
    const users = await tx.select().from(accounts);
    const existingIds = users.map(user => user.id);
    const store = { ...(row.data as any), users };
    const persist = async (value: any) => {
      for (const media of value.media || []) {
        if (media.data) {
          await mediaStore().set(media.id, Uint8Array.from(Buffer.from(media.data, 'base64')).buffer);
          delete media.data;
        }
      }
      const retained = new Set(value.users.map((user: any) => user.id));
      for (const previousId of existingIds) {
        if (!retained.has(previousId)) await tx.delete(accounts).where(eq(accounts.id, previousId));
      }
      for (const user of value.users) {
        // Only application profile fields are stored here. Identity owns passwords.
        const record = { id: user.id, authKey: user.authKey, username: user.username, name: user.name, role: user.role,
          profile: user.profile || {}, createdAt: user.createdAt, lastSeenAt: user.lastSeenAt || null };
        await tx.insert(accounts).values(record).onConflictDoUpdate({ target: accounts.id, set: record });
      }
      const { users: ignored, ...data } = value;
      await tx.update(classroom).set({ data, updatedAt: new Date() }).where(eq(classroom.id, 'main'));
    };
    return operation(store, persist, tx);
  });
}
