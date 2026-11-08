-- Discord login. Anonymous browser keys keep working; signing in LINKS a browser key to an account.
-- Only the Discord id, display name and avatar hash are stored. No email, no Discord tokens (the access token is used once and thrown away).

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  discord_id text not null unique check (discord_id ~ '^[0-9]{15,25}$'),
  name text not null check (char_length(name) between 1 and 64),
  avatar text check (avatar is null or avatar ~ '^[A-Za-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

-- One row per browser key hash that has signed in to an account. A key belongs to at most ONE account.
create table if not exists public.account_keys (
  owner_key_hash text primary key check (owner_key_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid not null references public.accounts(id) on delete cascade,
  linked_at timestamptz not null default now()
);
create index if not exists account_keys_account_idx on public.account_keys(account_id);

alter table public.sessions add column if not exists account_id uuid references public.accounts(id) on delete set null;
create index if not exists sessions_account_idx on public.sessions(account_id, created_at desc);

-- Locked down like every other table: RLS on with NO policies means only the service role (the edge functions) can read or write.
alter table public.accounts enable row level security;
alter table public.account_keys enable row level security;
revoke all on public.accounts, public.account_keys from anon, authenticated;

-- Link a browser key to a Discord account and attach that browser's existing anonymous sessions to the account. One atomic step.
-- If this key was already linked to a DIFFERENT account, it is moved (the person signed in to another account on this browser).
create or replace function public.link_discord_login(p_discord_id text, p_name text, p_avatar text, p_owner text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  insert into public.accounts (discord_id, name, avatar) values (p_discord_id, p_name, p_avatar)
  on conflict (discord_id) do update set name = excluded.name, avatar = excluded.avatar, last_login_at = now()
  returning id into a;
  insert into public.account_keys (owner_key_hash, account_id) values (p_owner, a)
  on conflict (owner_key_hash) do update set account_id = excluded.account_id, linked_at = now();
  update public.sessions set account_id = a where owner_key_hash = p_owner and (account_id is null or account_id <> a);
  return a;
end $$;
revoke all on function public.link_discord_login(text, text, text, text) from public, anon, authenticated;
