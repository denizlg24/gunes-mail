import { migrate } from "drizzle-orm/postgres-js/migrator";

import { db } from "./index";

export async function runMigrations() {
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
}

if (import.meta.main) {
  await runMigrations();
  console.log("migrations applied");
  process.exit(0);
}
