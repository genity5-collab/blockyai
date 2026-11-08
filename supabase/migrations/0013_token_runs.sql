-- A user message the token gate refused is stored (so the chat shows it) but flagged, and agent-messages never hands it to the agent.
alter table public.messages add column if not exists blocked boolean not null default false;
-- AI work time is measured on the server, with no agent change: from the message being accepted until the agent reports idle.
alter table public.messages add column if not exists run_started_at timestamptz;
alter table public.messages add column if not exists run_billed_at timestamptz;
create index if not exists messages_unbilled_idx on public.messages(session_id, run_started_at) where run_started_at is not null and run_billed_at is null;
