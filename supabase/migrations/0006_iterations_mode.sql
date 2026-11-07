-- Builds need more steps than chat. Default 40, user adjustable up to a hard cap of 80 (enforced again in web-api and the agent).
alter table public.sessions alter column max_iterations set default 40;
update public.sessions set max_iterations = 40 where max_iterations = 12;          -- only rows still on the old default; custom values are kept
alter table public.sessions drop constraint if exists sessions_max_iterations_range;
alter table public.sessions add constraint sessions_max_iterations_range check (max_iterations between 1 and 80);
