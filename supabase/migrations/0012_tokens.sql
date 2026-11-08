-- Tokens. Per Discord account. The ledger is the history; token_accounts holds the live balance.
-- Every change goes through the functions below, each one atomic (row lock), so two requests at once can never overspend or double-claim.
-- Prices and limits are decided in the edge functions (_shared/tokens.js); these functions only move numbers safely.

create table if not exists public.token_accounts (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  balance int not null default 0 check (balance between 0 and 100),
  signup_bonus_at timestamptz,
  last_claim_day date,
  last_floor_day date,
  updated_at timestamptz not null default now()
);

create table if not exists public.token_ledger (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  delta int not null,                                   -- + credit, - spend (the amount REALLY applied)
  balance_after int not null check (balance_after between 0 and 100),
  reason text not null check (reason in ('signup','daily_reward','daily_floor','message','ai_work','screenshot')),
  ref text,                                             -- message id, screenshot id, run id, or the UTC day
  created_at timestamptz not null default now()
);
create index if not exists token_ledger_account_idx on public.token_ledger(account_id, created_at desc);
-- A reference can be applied once per reason: this is what makes retries and double-clicks harmless.
create unique index if not exists token_ledger_once on public.token_ledger(account_id, reason, ref) where ref is not null;

alter table public.token_accounts enable row level security;
alter table public.token_ledger enable row level security;
revoke all on public.token_accounts, public.token_ledger from anon, authenticated;

-- Credit (never above p_max). Idempotent per (account, reason, ref). Returns the amount actually added; duplicate = true if this ref was already applied.
create or replace function public.token_credit(p_account uuid, p_amount int, p_reason text, p_ref text, p_max int default 100)
returns table(added int, balance int, duplicate boolean) language plpgsql security definer set search_path = public as $$
declare cur int; nxt int; applied int;
begin
  insert into token_accounts (account_id) values (p_account) on conflict (account_id) do nothing;
  select ta.balance into cur from token_accounts ta where ta.account_id = p_account for update;
  if p_ref is not null and exists (select 1 from token_ledger l where l.account_id = p_account and l.reason = p_reason and l.ref = p_ref) then
    return query select 0, cur, true; return;
  end if;
  nxt := least(p_max, cur + greatest(0, p_amount)); applied := greatest(0, nxt - cur);
  update token_accounts set balance = nxt, updated_at = now() where account_id = p_account;
  insert into token_ledger (account_id, delta, balance_after, reason, ref) values (p_account, applied, nxt, p_reason, p_ref);
  return query select applied, nxt, false;
end $$;

-- Spend up to p_amount. NEVER goes below 0: if the balance is smaller, it takes what is there. Idempotent per (account, reason, ref).
-- Returns what was really taken and whether the account could cover the full price.
create or replace function public.token_spend(p_account uuid, p_amount int, p_reason text, p_ref text)
returns table(spent int, balance int, covered boolean, duplicate boolean) language plpgsql security definer set search_path = public as $$
declare cur int; take int;
begin
  insert into token_accounts (account_id) values (p_account) on conflict (account_id) do nothing;
  select ta.balance into cur from token_accounts ta where ta.account_id = p_account for update;
  if p_ref is not null and exists (select 1 from token_ledger l where l.account_id = p_account and l.reason = p_reason and l.ref = p_ref) then
    return query select 0, cur, true, true; return;
  end if;
  take := least(cur, greatest(0, p_amount));
  update token_accounts set balance = cur - take, updated_at = now() where account_id = p_account;
  insert into token_ledger (account_id, delta, balance_after, reason, ref) values (p_account, -take, cur - take, p_reason, p_ref);
  return query select take, cur - take, (take >= p_amount), false;
end $$;

-- Sign-up bonus: once per account, ever.
create or replace function public.token_signup_bonus(p_account uuid, p_amount int)
returns table(added int, balance int, granted boolean) language plpgsql security definer set search_path = public as $$
declare r record;
begin
  insert into token_accounts (account_id) values (p_account) on conflict (account_id) do nothing;
  perform 1 from token_accounts ta where ta.account_id = p_account for update;
  if exists (select 1 from token_accounts ta where ta.account_id = p_account and ta.signup_bonus_at is not null) then
    return query select 0, (select ta.balance from token_accounts ta where ta.account_id = p_account), false; return;
  end if;
  select * into r from token_credit(p_account, p_amount, 'signup', 'signup');
  update token_accounts set signup_bonus_at = now() where account_id = p_account;
  return query select r.added, r.balance, true;
end $$;

-- Daily claim: only for the given UTC day, once. The edge function decides which day is "today".
create or replace function public.token_claim_daily(p_account uuid, p_day date, p_amount int)
returns table(added int, balance int, claimed boolean) language plpgsql security definer set search_path = public as $$
declare r record;
begin
  insert into token_accounts (account_id) values (p_account) on conflict (account_id) do nothing;
  perform 1 from token_accounts ta where ta.account_id = p_account for update;
  if exists (select 1 from token_accounts ta where ta.account_id = p_account and ta.last_claim_day = p_day) then
    return query select 0, (select ta.balance from token_accounts ta where ta.account_id = p_account), false; return;
  end if;
  select * into r from token_credit(p_account, p_amount, 'daily_reward', p_day::text);
  update token_accounts set last_claim_day = p_day where account_id = p_account;
  return query select r.added, r.balance, true;
end $$;

-- Daily floor: once per UTC day, raises the balance to p_floor if it is lower. Never lowers anything.
create or replace function public.token_daily_floor(p_account uuid, p_day date, p_floor int)
returns table(added int, balance int) language plpgsql security definer set search_path = public as $$
declare cur int; r record;
begin
  insert into token_accounts (account_id) values (p_account) on conflict (account_id) do nothing;
  select ta.balance into cur from token_accounts ta where ta.account_id = p_account for update;
  if exists (select 1 from token_accounts ta where ta.account_id = p_account and ta.last_floor_day = p_day) then return query select 0, cur; return; end if;
  update token_accounts set last_floor_day = p_day where account_id = p_account;
  if cur >= p_floor then return query select 0, cur; return; end if;
  select * into r from token_credit(p_account, p_floor - cur, 'daily_floor', p_day::text);
  return query select r.added, r.balance;
end $$;

revoke all on function public.token_credit(uuid,int,text,text,int), public.token_spend(uuid,int,text,text), public.token_signup_bonus(uuid,int),
  public.token_claim_daily(uuid,date,int), public.token_daily_floor(uuid,date,int) from public, anon, authenticated;
