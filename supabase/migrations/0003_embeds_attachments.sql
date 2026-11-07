-- Rich AI messages (embeds) + user file/image attachments. No browser access: everything goes through web-api / agent-*.
alter table public.messages add column if not exists embeds jsonb;
alter table public.messages add column if not exists attachment_ids uuid[] not null default '{}';

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  kind text not null check (kind in ('image','text')),
  name text not null,
  mime text not null,
  size int not null,
  storage_path text not null,
  description text,          -- qwen25-vl caption for images
  ocr_text text,             -- paddleocr-vl text for images
  text_content text,         -- inlined content for text/code files
  created_at timestamptz not null default now()
);
create index if not exists attachments_session on public.attachments(session_id, created_at);
alter table public.attachments enable row level security;
revoke all on public.attachments from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments','attachments', false, 5242880) on conflict (id) do nothing;
