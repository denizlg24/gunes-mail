import { app } from "./app";
import { runMigrations } from "./db/migrate";
import { env } from "./env";
import { startObservability } from "./lib/observe";
import { startWorkers } from "./sync/engine";

startObservability();
await runMigrations();
startWorkers();

export default {
  port: env.PORT,
  fetch: app.fetch,
  idleTimeout: 0,
};

console.info(`gunes-mail-server listening on :${env.PORT}`);
