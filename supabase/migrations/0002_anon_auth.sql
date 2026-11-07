-- Anonymous ownership: sessions belong to whoever holds the client_key. Only a hash is stored.
alter table public.sessions alter column user_id drop not null;
alter table public.sessions add column if not exists client_id text;
alter table public.sessions add column if not exists owner_key_hash text;
alter table public.sessions add column if not exists place_name text;
alter table public.sessions add column if not exists live_sync boolean not null default true;
alter table public.sessions add column if not exists pairing_expires_at timestamptz;
create index if not exists sessions_owner_idx on public.sessions(owner_key_hash, created_at desc);

-- Source badge for the live edit log (AI / USER / BULK) + batch grouping for "undo batch".
alter table public.edit_log add column if not exists source text not null default 'ai';
alter table public.edit_log add column if not exists batch_id text;
alter table public.edit_log add column if not exists undone boolean not null default false;

-- Lock the tables down: browsers never touch them directly. Everything goes through edge functions (service role, server side).
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where schemaname='public' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop; end $$;
revoke all on public.sessions, public.messages, public.commands, public.edit_log, public.playtest_logs, public.screenshots, public.snapshots, public.script_mirror from anon, authenticated;
-- RLS stays ENABLED with no policies = deny-all for anon/authenticated. The service role bypasses RLS.
