import { dispatchBackup } from '../../server/backup-jobs';
export default async (req:Request) => { await dispatchBackup(req,'backup'); };
export const config = {schedule:'0 3 * * *'};
