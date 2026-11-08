-- Live view of the AI's own computer. ONE row per session: the latest frame only (a live view, never a recording).
-- The VM sends a picture plus what the page said; the SERVER decides whether the user may see it (screenguard), so a compromised VM cannot push a private frame through.
create table if not exists public.screen_frames (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  seq bigint not null default 0,                     -- grows with every accepted frame; the site only redraws when it changes
  shown boolean not null default false,              -- false = the user gets a black frame
  hidden_kind text check (hidden_kind in ('private','unchecked','error')),
  hidden_why text,                                   -- plain reason naming a KIND of thing, never the secret itself
  storage_path text,                                 -- only when shown
  width int, height int,
  title text,                                        -- tab title, only when shown
  host text,                                         -- site name only (no path, no query), only when shown
  activity text,                                     -- short note of what the AI is doing ("Searching for TweenService"), already screened
  updated_at timestamptz not null default now()
);
alter table public.screen_frames enable row level security;
revoke all on public.screen_frames from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screen','screen', false, 1048576, array['image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg','image/png'];
