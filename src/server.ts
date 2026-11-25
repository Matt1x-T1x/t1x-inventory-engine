import { openDatabase } from "./db/database";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DATABASE_PATH ?? "./data/inventory.db";

const db = openDatabase(dbPath);
const app = createApp(db);

app.listen(port, () => {
  console.log(`[t1x-inventory-engine] rodando em http://localhost:${port}`);
});
