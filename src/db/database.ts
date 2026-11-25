import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  if (dbPath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db);
  return db;
}

export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrationsDir = path.join(__dirname, "migrations");
  const fallbackDir = path.join(process.cwd(), "src", "db", "migrations");
  const targetDir = fs.existsSync(migrationsDir) ? migrationsDir : fallbackDir;

  const files = fs
    .readdirSync(targetDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const checkStmt = db.prepare("SELECT 1 FROM _migrations WHERE name = ?");
  const recordStmt = db.prepare("INSERT INTO _migrations (name) VALUES (?)");

  for (const file of files) {
    const alreadyApplied = checkStmt.get(file);
    if (alreadyApplied) continue;

    const sql = fs.readFileSync(path.join(targetDir, file), "utf-8");
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(sql);
      recordStmt.run(file);
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
  }
}
