-- One row per model call, so truncation (finish_reason = 'length'), token use and iteration counts are visible on /diagnostics.
create table if not exists public.llm_calls (
  id bigserial primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  run_id text,
  message_id uuid,
  iteration int not null default 0,
  finish_reason text not null default 'unknown',
  prompt_tokens int,
  completion_tokens int,
  chars int,
  created_at timestamptz not null default now()
);
create index if not exists llm_calls_session_idx on public.llm_calls(session_id, created_at desc);
alter table public.llm_calls enable row level security;   -- no policies: only the service role (edge functions) can read or write
revoke all on public.llm_calls from anon, authenticated;
revoke all on sequence public.llm_calls_id_seq from anon, authenticated;
