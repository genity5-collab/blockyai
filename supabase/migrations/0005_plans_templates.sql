-- Plans: the numbered checklist the agent must complete before it may finish a build.
create table if not exists public.agent_plans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  message_id uuid,                                   -- the user message this plan answers
  title text not null default 'Plan',
  items jsonb not null default '[]',                 -- [{id, text, done, note, verified}]
  status text not null default 'active' check (status in ('active','complete','abandoned')),
  target_path text,                                  -- the model/area being built; completion is checked against it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_plans_session_idx on public.agent_plans(session_id, created_at desc);
alter table public.agent_plans enable row level security;

-- Reusable named templates (tree, house, car, ...). session_id null = built-in, shared by everyone.
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete cascade,
  name text not null check (name ~ '^[A-Za-z0-9_-]{1,40}$'),
  kind text not null default 'model' check (kind in ('model','game')),
  description text,
  spec jsonb not null,
  instance_count int not null default 0,
  created_at timestamptz not null default now(),
  unique nulls not distinct (session_id, name)
);
alter table public.templates enable row level security;

-- Plugin version registry + safe cosmetic config (JSON only, never code).
create table if not exists public.plugin_releases (
  version int primary key,
  label text not null,
  changelog text not null default '',
  created_at timestamptz not null default now()
);
alter table public.plugin_releases enable row level security;

-- Per-session knobs the user can change from the website.
alter table public.sessions add column if not exists mode text not null default 'chat' check (mode in ('chat','game'));
alter table public.sessions add column if not exists genre text;
-- Latest screenshots per command, with the angle name, so the site can show a 3D progress strip.
alter table public.screenshots add column if not exists label text;
