import { dispatchBackup } from '../../server/backup-jobs';
export default async (req:Request) => { await dispatchBackup(req,'verify'); };
export const config={schedule:'0 4 * * 0'};
