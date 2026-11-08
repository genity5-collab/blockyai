-- Real progress of the VM boot. vm-start writes the step it has actually finished; the website turns it into a percentage.
alter table public.sessions add column if not exists vm_boot_stage text;
alter table public.sessions add column if not exists vm_boot_started_at timestamptz;
