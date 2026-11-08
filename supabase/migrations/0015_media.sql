-- Images the AI shows in chat (found on the web, made on the VM). Separate from the user's own `attachments`.
-- The bytes live in a PRIVATE bucket; the website gets a short-lived signed URL only for a session the caller owns.
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null,
  mime text not null check (mime in ('image/png','image/jpeg','image/gif','image/webp')),
  size int not null check (size > 0 and size <= 4194304),
  width int not null check (width > 0),
  height int not null check (height > 0),
  storage_path text not null,
  source_url text,                       -- where the AI says it came from (shown as text only)
  created_at timestamptz not null default now()
);
create index if not exists media_session on public.media(session_id, created_at);
alter table public.media enable row level security;
revoke all on public.media from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media','media', false, 4194304, array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 4194304, allowed_mime_types = array['image/png','image/jpeg','image/gif','image/webp'];
