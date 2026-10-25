import { createApp } from './app.js';
import { readConfig } from './config/env.js';
import { db } from './db/prisma.js';

const config = readConfig();
const app = await createApp({ db, config });
const server = app.listen(config.port, '0.0.0.0', () =>
  console.log(`API ready at http://localhost:${config.port}`),
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () =>
    server.close(async () => {
      await db.$disconnect();
      process.exit(0);
    }),
  );
}
