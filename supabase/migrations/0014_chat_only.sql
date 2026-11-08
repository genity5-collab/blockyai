-- Per-account permission: may open the chat workspace WITHOUT a paired Roblox Studio plugin (for testing from a phone).
-- Stored on the account in the database. It is never read from the browser, so nobody can grant it to themselves.
alter table public.accounts add column if not exists chat_only boolean not null default false;
