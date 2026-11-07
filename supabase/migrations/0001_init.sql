-- BlockyAI schema
create extension if not exists pgcrypto;

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text default 'New session',
  pairing_code text unique,
  plugin_token_hash text,
  plugin_connected_at timestamptz,
  plugin_last_seen_at timestamptz,
  run_lua_enabled boolean not null default false,
  max_iterations int not null default 12,
  max_commands_per_min int not null default 60,
  max_batch_size int not null default 50,
  vm_id text,
  vm_status text not null default 'none' check (vm_status in ('none','starting','running','suspended','stopped','error')),
  vm_started_at timestamptz,
  last_active_at timestamptz default now(),
  agent_token_hash text,
  agent_token_expires_at timestamptz,
  agent_state text not null default 'idle' check (agent_state in ('idle','thinking','working','error')),
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool','system')),
  content text not null default '',
  tool_calls jsonb,
  created_at timestamptz not null default now()
);
create index on public.messages(session_id, created_at);

create table public.commands (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','running','done','failed','cancelled')),
  result jsonb,
  error text,
  needs_confirm boolean not null default false,
  confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on public.commands(session_id, status, created_at);

create table public.edit_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  command_id uuid references public.commands(id) on delete set null,
  action text not null, target text, before jsonb, after jsonb,
  created_at timestamptz not null default now()
);
create table public.playtest_logs (
  id bigserial primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  level text, message text, source text,
  created_at timestamptz not null default now()
);
create table public.screenshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  command_id uuid, storage_path text not null,
  created_at timestamptz not null default now()
);
create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  label text, data jsonb not null,
  created_at timestamptz not null default now()
);
create table public.script_mirror (
  session_id uuid not null references public.sessions(id) on delete cascade,
  path text not null, class_name text, source text, updated_at timestamptz default now(),
  primary key (session_id, path)
);

alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.commands enable row level security;
alter table public.edit_log enable row level security;
alter table public.playtest_logs enable row level security;
alter table public.screenshots enable row level security;
alter table public.snapshots enable row level security;
alter table public.script_mirror enable row level security;

-- Owners only; the agent/plugin never touch tables directly, they go through edge functions (service role).
create policy own_sessions on public.sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_messages_r on public.messages for select using (exists(select 1 from public.sessions s where s.id=session_id and s.user_id=auth.uid()));
create policy own_messages_i on public.messages for insert with check (role='user' and exists(select 1 from public.sessions s where s.id=session_id and s.user_id=auth.uid()));
create policy own_commands_r on public.commands for select using (exists(select 1 from public.sessions s where s.id=session_id and s.user_id=auth.uid()));
create policy own_commands_u on public.commands for update using (exists(select 1 from public.sessions s where s.id=session_id and s.user_id=auth.uid()));
create policy own_editlog on public.edit_log for select using (exists(select 1 from public.sessions s where s.id=session_id and s.user_id=auth.uid()));
create policy own_playlogs on public.playtest_logs for select using (exists(select 1 from public.sessions s where s.id=session_id and s.user_id=auth.uid()));
create policy own_shots on public.screenshots for select using (exists(select 1 from public.sessions s where s.id=session_id and s.user_id=auth.uid()));
create policy own_snaps on public.snapshots for select using (exists(select 1 from public.sessions s where s.id=session_id and s.user_id=auth.uid()));

alter publication supabase_realtime add table public.messages, public.commands, public.sessions;

insert into storage.buckets (id, name, public) values ('screenshots','screenshots',false) on conflict do nothing;
