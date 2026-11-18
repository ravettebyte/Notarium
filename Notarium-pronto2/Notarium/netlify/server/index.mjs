import { createRequire } from 'node:module';
import { createBlobStorage } from './blob-storage.mjs';

// Em produção não criamos a conta de professor padrão de desenvolvimento.
process.env.NODE_ENV ||= 'production';

const require = createRequire(import.meta.url);
const { createApplication } = require('../../server.js');

const app = createApplication({ storage: createBlobStorage() });
await app.initialize();
app.server.listen(Number(process.env.PORT));

export const config = {
  path: '/api/*'
};
