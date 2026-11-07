-- Numeric facts from a tool result (instances built, errors, captures...). Whitelisted keys, numbers/booleans only: no free text, so nothing sensitive can land here.
alter table public.tool_calls add column if not exists result_summary jsonb;
alter table public.tool_calls drop constraint if exists tool_calls_family_check;
alter table public.tool_calls add constraint tool_calls_family_check check (family in ('vm','roblox','local'));
