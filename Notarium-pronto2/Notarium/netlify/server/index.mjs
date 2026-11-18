import { createRequire } from 'node:module';
import { createBlobStorage } from './blob-storage.mjs';

const require = createRequire(import.meta.url);
const { createApplication } = require('../../server.js');

// A conta padrão "professor" / "professor123" é criada no primeiro acesso;
// depois o professor cadastra os alunos pelo app.
const app = createApplication({ storage: createBlobStorage(), seedDefaultTeacher: true });
await app.initialize();
app.server.listen(Number(process.env.PORT));

export const config = {
  path: '/api/*'
};
