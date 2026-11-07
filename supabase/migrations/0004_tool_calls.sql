-- Every tool call the agent makes, so VM vs Studio usage is auditable (and the routing self-test can read it).
create table if not exists public.tool_calls (
  id bigserial primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  run_id text,                                   -- groups the calls made while answering one user message
  seq int not null default 0,                    -- order within the run
  name text not null,
  family text not null check (family in ('vm','roblox','local')),
  args_summary text,                             -- short, redacted
  ok boolean,
  error text,                                    -- raw error text (redacted), null on success
  duration_ms int,
  created_at timestamptz not null default now()
);
create index if not exists tool_calls_session_idx on public.tool_calls(session_id, created_at);
alter table public.tool_calls enable row level security;   -- no policies: only service role (edge functions) can read or write
-- Which message triggered a run, so the self-test can match calls to its prompt.
alter table public.tool_calls add column if not exists message_id uuid;
