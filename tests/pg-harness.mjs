// Connects to a REAL PostgreSQL started by pg-server.mjs (or any Postgres at PGPORT), creates a fresh database per test file,
// and applies the REAL migration files. Start the server first:  runuser -u postgres -- node /opt/pgsrv/pg-server.mjs 54329
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const MIG = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
export const migration = (n) => readFileSync(join(MIG, n), "utf8");
const PORT = Number(process.env.PGPORT || 54329);
const conn = (database) => new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database });
export async function startPg() {
  const root = conn("postgres"); await root.connect();
  const name = "t" + Math.random().toString(36).slice(2, 10);
  await root.query(`create database ${name}`);
  const mk = async () => { const c = conn(name); await c.connect(); return c; };
  const admin = await mk();
  // Stand-ins for what 0001 creates (the real 0001 needs Supabase's auth schema). Column names/types match 0001.
  await admin.query(`create extension if not exists pgcrypto;
    create table public.sessions (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
    create table public.commands (id uuid primary key default gen_random_uuid(), session_id uuid not null references public.sessions(id) on delete cascade,
      type text not null, payload jsonb not null default '{}', status text not null default 'pending' check (status in ('pending','running','done','failed','cancelled')),
      result jsonb, error text, needs_confirm boolean not null default false, confirmed boolean not null default false, created_at timestamptz not null default now(), finished_at timestamptz);`);
  await admin.query(migration("0008_reliable_queue.sql"));
  return { admin, mk, name, async stop() { await admin.end(); await root.query(`drop database ${name} with (force)`); await root.end(); } };
}
