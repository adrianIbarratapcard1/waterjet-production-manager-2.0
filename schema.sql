-- Waterjet Production Manager schema
-- No-login/public-write configuration is intentionally broad. Anyone with the anon key
-- and project URL can read/write these tables if these policies are enabled.
-- Get employer approval before using with real company/customer data.

create extension if not exists pgcrypto;

create table if not exists public.jobs (
  id uuid primary key,
  job_name text not null,
  job_number text,
  material text,
  thickness_in numeric,
  quantity integer,
  priority text default 'Normal',
  status text not null default 'Unscheduled',
  estimated_cut_seconds numeric,
  estimated_garnet_lb numeric,
  estimated_cost numeric,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  notes text,
  omex_data jsonb not null default '{}'::jsonb,
  omex_raw text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cut_sessions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  source text not null default 'timer',
  notes text,
  created_at timestamptz not null default now(),
  constraint valid_session_time check (ended_at is null or ended_at > started_at)
);

create index if not exists jobs_scheduled_start_idx on public.jobs(scheduled_start);
create index if not exists cut_sessions_job_id_idx on public.cut_sessions(job_id);
create index if not exists cut_sessions_started_at_idx on public.cut_sessions(started_at);

alter table public.jobs enable row level security;
alter table public.cut_sessions enable row level security;

-- Public no-login mode: broad access by design. Remove these policies and replace
-- with authenticated/team policies if the workspace should not be open to everyone.
drop policy if exists "public can read jobs" on public.jobs;
drop policy if exists "public can insert jobs" on public.jobs;
drop policy if exists "public can update jobs" on public.jobs;
drop policy if exists "public can delete jobs" on public.jobs;
create policy "public can read jobs" on public.jobs for select to anon, authenticated using (true);
create policy "public can insert jobs" on public.jobs for insert to anon, authenticated with check (true);
create policy "public can update jobs" on public.jobs for update to anon, authenticated using (true) with check (true);
create policy "public can delete jobs" on public.jobs for delete to anon, authenticated using (true);

drop policy if exists "public can read sessions" on public.cut_sessions;
drop policy if exists "public can insert sessions" on public.cut_sessions;
drop policy if exists "public can update sessions" on public.cut_sessions;
drop policy if exists "public can delete sessions" on public.cut_sessions;
create policy "public can read sessions" on public.cut_sessions for select to anon, authenticated using (true);
create policy "public can insert sessions" on public.cut_sessions for insert to anon, authenticated with check (true);
create policy "public can update sessions" on public.cut_sessions for update to anon, authenticated using (true) with check (true);
create policy "public can delete sessions" on public.cut_sessions for delete to anon, authenticated using (true);

-- Enable realtime updates for the two shared tables.
do $$ begin
  alter publication supabase_realtime add table public.jobs;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.cut_sessions;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
