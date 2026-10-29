import { createCipheriv, createHash, randomBytes } from 'node:crypto';

export function encryptBackup(snapshot: unknown, encodedKey: string) {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new Error('A chave de backup precisa conter 32 bytes em base64.');
  const plaintext = Buffer.from(JSON.stringify(snapshot));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: 'notarium-backup-v1',
    algorithm: 'aes-256-gcm',
    checksum: createHash('sha256').update(plaintext).digest('hex'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}
