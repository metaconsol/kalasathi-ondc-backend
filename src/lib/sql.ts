import mysql from 'mysql2/promise';
import { env } from '~/config/env.config';

type SqlPool = mysql.Pool;
export type SqlTx = mysql.PoolConnection;

function parseMysqlUrl(databaseUrl: string) {
  const u = new URL(databaseUrl);
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    connectionLimit: parseInt(u.searchParams.get('connectionLimit') || '10', 10),
  };
}

const cfg = parseMysqlUrl(env.databaseUrl);

const pool: SqlPool = mysql.createPool({
  host: cfg.host,
  port: cfg.port,
  user: cfg.user,
  password: cfg.password,
  database: cfg.database,
  waitForConnections: true,
  connectionLimit: cfg.connectionLimit,
  namedPlaceholders: true,
  dateStrings: false,
});

export async function sqlQuery<T = any>(
  sql: string,
  params?: Record<string, any> | any[],
  tx?: SqlTx,
): Promise<T[]> {
  const executor = tx ?? pool;
  try {
    const [rows] = await executor.query(sql, params as any);
    return rows as T[];
  } catch (err) {
    const e = err as any;
    e.query = sql;
    e.params = params;
    throw e;
  }
}

export async function sqlExec(
  sql: string,
  params?: Record<string, any> | any[],
  tx?: SqlTx,
): Promise<mysql.ResultSetHeader> {
  const executor = tx ?? pool;
  try {
    const [result] = await executor.execute(sql, params as any);
    return result as mysql.ResultSetHeader;
  } catch (err) {
    const e = err as any;
    e.query = sql;
    e.params = params;
    throw e;
  }
}

export async function withSqlTransaction<T>(fn: (tx: SqlTx) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      // ignore rollback errors
    }
    throw e;
  } finally {
    conn.release();
  }
}
