/**
 * DB接続。初回接続時にマイグレーションを当てるので、`npm run dev` だけでテーブルができる。
 *
 * 注意: better-sqlite3 は同期ドライバなので、Next.js のページで読むときは
 * 先に `await connection()`（next/server）を呼び、事前レンダリングで実行されないようにする。
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");
const DEFAULT_DATABASE_PATH = path.join("data", "app.db");

/** DBを開いてマイグレーションを当てる。":memory:" を渡すとテスト用のメモリ上のDBになる */
export function createDb(databasePath: string): Db {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON"); // SQLiteは既定で外部キー制約を見ないので有効にする

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

// 開発中のホットリロードで接続が増えないよう、1つの接続を使い回す
const globalForDb = globalThis as unknown as { __deadlineDb?: Db };

export function getDb(): Db {
  globalForDb.__deadlineDb ??= createDb(process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH);
  return globalForDb.__deadlineDb;
}
