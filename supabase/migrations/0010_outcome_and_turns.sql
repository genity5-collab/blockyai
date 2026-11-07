-- Phase 1 items 7+8: a final message records HOW the run ended, so INCOMPLETE is never shown as success and stays visible after the next run.
alter table public.messages add column if not exists outcome text check (outcome is null or outcome in ('complete','incomplete','stopped','error'));
-- A plan belongs to the user message it answers. At the start of a new turn every older active plan is abandoned.
create index if not exists agent_plans_session_status_idx on public.agent_plans(session_id, status);
