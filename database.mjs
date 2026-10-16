import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Pool } from "pg";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const transactionContext = new AsyncLocalStorage();
const postgresUrl = process.env.DATABASE_URL;
let pool;
let sqlite;
let sqliteQueue = Promise.resolve();

if (process.env.NODE_ENV === "production" && !postgresUrl) {
  throw new Error("DATABASE_URL is required in production; refusing to start with local demo storage.");
}

if (postgresUrl) {
  const sslMode = new URL(postgresUrl).searchParams.get("sslmode");
  if (!["require", "verify-ca", "verify-full"].includes(sslMode)) {
    throw new Error("DATABASE_URL must include an SSL mode (sslmode=require or stronger).");
  }
  pool = new Pool({
    connectionString: postgresUrl,
    max: Number(process.env.PG_POOL_MAX || 5),
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });
} else {
  const dataDir = process.env.IMPACT360_DATA_DIR || join(ROOT, ".data");
  const databasePath = process.env.IMPACT360_DB_PATH || join(dataDir, "impact360.sqlite");
  mkdirSync(dirname(databasePath), { recursive: true });
  sqlite = new DatabaseSync(databasePath);
  sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
}

export const databaseType = pool ? "postgresql" : "sqlite";

function postgresPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function runSqlite(sql, params, mode) {
  const statement = sqlite.prepare(sql);
  if (mode === "all") return statement.all(...params);
  if (mode === "get") return statement.get(...params);
  const result = statement.run(...params);
  return { changes: result.changes };
}

async function execute(sql, params = [], mode = "run") {
  if (pool) {
    const client = transactionContext.getStore();
    const result = await (client || pool).query(postgresPlaceholders(sql), params);
    if (mode === "all") return result.rows;
    if (mode === "get") return result.rows[0];
    return { changes: result.rowCount };
  }
  const context = transactionContext.getStore();
  if (context === sqlite) return runSqlite(sql, params, mode);
  const operation = sqliteQueue.then(() => runSqlite(sql, params, mode));
  sqliteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export const db = {
  exec(sql) {
    if (pool) {
      const client = transactionContext.getStore();
      return (client || pool).query(sql);
    }
    return sqlite.exec(sql);
  },
  prepare(sql) {
    return {
      all: (...params) => execute(sql, params, "all"),
      get: (...params) => execute(sql, params, "get"),
      run: (...params) => execute(sql, params, "run"),
    };
  },
  async close() {
    if (pool) return pool.end();
    await sqliteQueue;
    sqlite.close();
  },
};

export async function transaction(callback) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await transactionContext.run(client, callback);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const operation = sqliteQueue.then(async () => {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = await transactionContext.run(sqlite, callback);
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  });
  sqliteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
