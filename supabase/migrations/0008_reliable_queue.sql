-- Reliable command bridge: exactly-once claim, leases, ACK, bounded re-queue, idempotency, big results.
-- States: queued -> claimed -> running -> done | failed | expired   (cancelled is kept for the user's Stop button).
--
-- Why SQL functions: a claim must lock the row and change its state in ONE transaction. Edge functions cannot hold a
-- transaction across several calls, so the logic lives here and the functions call it with rpc(). The test suite runs this
-- exact file against a real PostgreSQL (see agent/test/queue.pg.test.js).

alter table public.commands drop constraint if exists commands_status_check;
update public.commands set status = 'queued' where status = 'pending';
alter table public.commands add constraint commands_status_check
  check (status in ('queued','claimed','running','done','failed','expired','cancelled'));
alter table public.commands alter column status set default 'queued';

alter table public.commands
  add column if not exists idempotency_key text,
  add column if not exists claimed_at timestamptz,
  add column if not exists acked_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempts int not null default 0,          -- how many times it has been handed to the plugin
  add column if not exists timeout_s int not null default 60,        -- per-type run timeout, set by the server from the type
  add column if not exists risk text not null default 'low' check (risk in ('low','medium','high')),
  add column if not exists result_truncated boolean not null default false,
  add column if not exists result_bytes int,
  add column if not exists result_file text;                         -- VM path where the agent saved a large result

-- Strict, gap-tolerant ordering key. created_at is NOT enough: rows inserted in one transaction (an auto-snapshot and the command
-- it protects, or an expanded batch) share the same now(), so ties would be broken by a random uuid and the command could run
-- BEFORE the snapshot meant to precede it. A bigserial gives every insert its own position.
alter table public.commands add column if not exists seq bigserial;
create index if not exists commands_seq_idx on public.commands(session_id, status, seq);

create unique index if not exists commands_idem_uq on public.commands(session_id, idempotency_key) where idempotency_key is not null;
create index if not exists commands_claim_idx on public.commands(session_id, status, created_at);

-- A command may be handed out at most 1 + max_requeues times (initial claim plus 2 re-queues = 3 deliveries), then it expires.
create or replace function public.claim_command(p_session uuid, p_lease_s int default 30, p_max_requeues int default 2)
returns setof public.commands language plpgsql as $$
declare c public.commands;
begin
  -- Serialize claims PER SESSION. Without this, two pollers can both pass the "nothing in flight" check below and then each lock a
  -- different queued row with SKIP LOCKED, so command 2 would start while command 1 is still running. The advisory lock is held
  -- until the end of the transaction, making the in-flight check and the claim one atomic step. Other sessions are unaffected.
  perform pg_advisory_xact_lock(hashtextextended(p_session::text, 0));
  -- 1. Lease-expired work: claimed/running past its lease goes back to the queue, or expires after too many tries.
  update public.commands set status = 'expired', error = coalesce(error, 'lease expired ' || attempts || ' times; the plugin never finished it'), finished_at = now()
   where session_id = p_session and status in ('claimed','running') and lease_expires_at < now() and attempts > p_max_requeues;
  update public.commands set status = 'queued', claimed_at = null, acked_at = null, lease_expires_at = null
   where session_id = p_session and status in ('claimed','running') and lease_expires_at < now() and attempts <= p_max_requeues;
  -- 2. Never-claimed work that has waited far too long is expired too (plugin offline for the whole window).
  update public.commands set status = 'expired', error = 'not claimed within 10 minutes; the plugin was offline', finished_at = now()
   where session_id = p_session and status = 'queued' and created_at < now() - interval '10 minutes';
  -- 3. Claim exactly one. FOR UPDATE SKIP LOCKED means two pollers can never receive the same row.
  --    Strict ordering: while an earlier command is claimed/running we hand out nothing, so a later command cannot overtake it.
  if exists (select 1 from public.commands where session_id = p_session and status in ('claimed','running') and lease_expires_at >= now()) then
    return;
  end if;
  select * into c from public.commands
   where session_id = p_session and status = 'queued' and (needs_confirm = false or confirmed = true)
   order by seq limit 1 for update skip locked;
  if not found then return; end if;
  update public.commands set status = 'claimed', claimed_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_s), attempts = attempts + 1
   where id = c.id returning * into c;
  return next c;
end $$;

-- Plugin says "I have it" (separate from the result). Moves claimed -> running and extends the lease to the command's own timeout.
create or replace function public.ack_command(p_session uuid, p_id uuid)
returns text language plpgsql as $$
declare s text;
begin
  update public.commands set status = 'running', acked_at = coalesce(acked_at, now()), lease_expires_at = now() + make_interval(secs => greatest(30, timeout_s))
   where id = p_id and session_id = p_session and status in ('claimed','running') returning status into s;
  return coalesce(s, 'ignored');
end $$;

-- Heartbeat renews the lease of whatever is still being run.
create or replace function public.heartbeat_command(p_session uuid, p_id uuid, p_lease_s int default 30)
returns boolean language plpgsql as $$
declare n int;
begin
  update public.commands set lease_expires_at = now() + make_interval(secs => p_lease_s)
   where id = p_id and session_id = p_session and status in ('claimed','running');
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Result arrives. Idempotent: a second result for a finished command is ignored (first writer wins) and reported as such.
create or replace function public.finish_command(p_session uuid, p_id uuid, p_ok boolean, p_result jsonb, p_error text, p_truncated boolean default false, p_bytes int default null)
returns text language plpgsql as $$
declare s text;
begin
  update public.commands set status = case when p_ok then 'done' else 'failed' end, result = p_result, error = p_error,
         result_truncated = p_truncated, result_bytes = p_bytes, finished_at = now(), lease_expires_at = null
   where id = p_id and session_id = p_session and status in ('queued','claimed','running') returning status into s;
  if s is null then return 'duplicate'; end if;
  return s;
end $$;

-- Why a command is waiting for approval (shown in the plugin's Allow/Deny card) and the taint flag from section 5.
alter table public.commands add column if not exists approval_reasons text[];
alter table public.sessions add column if not exists tainted boolean not null default false;
alter table public.sessions add column if not exists taint_reason text;
alter table public.sessions add column if not exists tainted_at timestamptz;
alter table public.sessions add column if not exists studio_version text;
alter table public.sessions add column if not exists studio_features jsonb;
alter table public.sessions add column if not exists playtest_active boolean not null default false;

-- SECURITY: Postgres grants EXECUTE on new functions to PUBLIC, and Supabase exposes public functions over its REST API, so with only the
-- public anon key anyone could claim or finish another session's commands. These are for the edge functions (service role) ONLY.
revoke all on function public.claim_command(uuid, int, int) from public, anon, authenticated;
revoke all on function public.ack_command(uuid, uuid) from public, anon, authenticated;
revoke all on function public.heartbeat_command(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.finish_command(uuid, uuid, boolean, jsonb, text, boolean, int) from public, anon, authenticated;
grant execute on function public.claim_command(uuid, int, int) to service_role;
grant execute on function public.ack_command(uuid, uuid) to service_role;
grant execute on function public.heartbeat_command(uuid, uuid, int) to service_role;
grant execute on function public.finish_command(uuid, uuid, boolean, jsonb, text, boolean, int) to service_role;

alter table public.sessions add column if not exists plugin_version int;

-- Section 6: results of the in-Studio self-test (no AI involved). One row per run, one JSON array of steps.
create table if not exists public.selftests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  studio_version text, plugin_version int, features jsonb,
  passed int not null default 0, failed int not null default 0, skipped int not null default 0,
  steps jsonb not null default '[]', created_at timestamptz not null default now()
);
create index if not exists selftests_session_idx on public.selftests(session_id, created_at desc);
alter table public.selftests enable row level security;   -- no policies: only the service role (edge functions) reads or writes
