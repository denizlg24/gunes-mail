import { app } from "./app";
import { runMigrations } from "./db/migrate";
import { env } from "./env";
import { startWorkers } from "./sync/engine";

await runMigrations();
startWorkers();

export default {
  port: env.PORT,
  fetch: app.fetch,
  idleTimeout: 0,
};

console.log(`gunes-mail-server listening on :${env.PORT}`);
