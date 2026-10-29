import { createHash } from 'node:crypto';
export const restoreOrder = ['users','settings','blocks','exerciseBlocks','lessons','exercises','attempts','trails','trailSettings','media','notifications','examSessions','rateLimits','backupRuns','compositions','backupJobs'];
export const sqlNames = {users:'users',settings:'settings',blocks:'blocks',exerciseBlocks:'exercise_blocks',lessons:'lessons',exercises:'exercises',attempts:'attempts',trails:'trails',trailSettings:'trail_settings',media:'media',notifications:'notifications',examSessions:'exam_sessions',rateLimits:'rate_limits',backupRuns:'backup_runs',compositions:'compositions',backupJobs:'backup_jobs'};
export function checksum(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
export function validateSnapshot(snapshot) {
  if (snapshot?.version !== 1 || !snapshot.tables || !Array.isArray(snapshot.files)) throw new Error('Invalid backup format');
  for (const name of restoreOrder) if (!Array.isArray(snapshot.tables[name])) throw new Error('Missing backup table');
  const userIds = new Set(snapshot.tables.users.map(u => u.id));
  const exerciseIds = new Set(snapshot.tables.exercises.map(e => e.id));
  for (const attempt of snapshot.tables.attempts) if (!userIds.has(attempt.student_id) || !exerciseIds.has(attempt.exercise_id)) throw new Error('Invalid attempt relationship');
  for (const file of snapshot.files) if (!file.key || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.size)) throw new Error('Invalid file entry');
  return snapshot;
}
// Runs against a disposable PostgreSQL engine, never against the production database.
export async function restoreInto(engine, snapshot) {
  validateSnapshot(snapshot);
  await engine.exec('BEGIN');
  try {
    for (const name of restoreOrder) {
      for (const row of snapshot.tables[name]) {
        const columns = Object.keys(row);
        if (columns.some(c => !/^[a-z_]+$/.test(c))) throw new Error('Invalid column');
        const values = columns.map(c => row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]);
        await engine.query(`INSERT INTO "${sqlNames[name]}" (${columns.map(c=>`"${c}"`).join(',')}) VALUES (${columns.map((_,i)=>`$${i+1}`).join(',')})`,values);
      }
    }
    for (const name of restoreOrder) {
      const result=await engine.query(`SELECT count(*)::integer AS count FROM "${sqlNames[name]}"`);
      if (result.rows[0].count !== snapshot.tables[name].length) throw new Error('Restore count mismatch');
    }
    await engine.exec('COMMIT');
  } catch(error) {await engine.exec('ROLLBACK');throw error;}
}
