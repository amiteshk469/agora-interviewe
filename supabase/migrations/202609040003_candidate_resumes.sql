create table if not exists public.candidate_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes integer not null check (size_bytes >= 0),
  status text not null default 'ready' check (status in ('processing', 'ready', 'failed')),
  raw_text text not null default '',
  extracted jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists candidate_resumes_user_created_idx
  on public.candidate_resumes (user_id, created_at desc);

alter table public.interview_configs
  add column if not exists candidate_resume_id uuid;

alter table public.interview_sessions
  add column if not exists candidate_resume_id uuid;

create index if not exists interview_configs_candidate_resume_id_idx
  on public.interview_configs (candidate_resume_id);
create index if not exists interview_sessions_candidate_resume_id_idx
  on public.interview_sessions (candidate_resume_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'interview_configs_resume_owner_fkey'
      and conrelid = 'public.interview_configs'::regclass
  ) then
    alter table public.interview_configs
      add constraint interview_configs_resume_owner_fkey
      foreign key (candidate_resume_id, user_id)
      references public.candidate_resumes(id, user_id)
      on delete set null (candidate_resume_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'interview_sessions_resume_owner_fkey'
      and conrelid = 'public.interview_sessions'::regclass
  ) then
    alter table public.interview_sessions
      add constraint interview_sessions_resume_owner_fkey
      foreign key (candidate_resume_id, user_id)
      references public.candidate_resumes(id, user_id)
      on delete set null (candidate_resume_id);
  end if;
end $$;

drop trigger if exists candidate_resumes_updated_at on public.candidate_resumes;
create trigger candidate_resumes_updated_at before update on public.candidate_resumes
for each row execute function public.set_updated_at();

alter table public.candidate_resumes enable row level security;

drop policy if exists candidate_resumes_all_own on public.candidate_resumes;
create policy candidate_resumes_all_own on public.candidate_resumes for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.candidate_resumes is
  'Private candidate CV text and storage metadata. Guest uploads inherit the owning recruiter session user.';
