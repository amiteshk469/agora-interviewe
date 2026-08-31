create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  parent_id uuid references public.prompt_templates(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9-]{2,100}$'),
  version integer not null default 1 check (version > 0),
  name text not null check (char_length(name) between 2 and 120),
  role text not null check (char_length(role) between 2 and 80),
  description text not null default '',
  prompt text not null check (char_length(prompt) between 40 and 20000),
  knowledge jsonb not null default '{}'::jsonb,
  behavior jsonb not null default '{}'::jsonb,
  is_builtin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompt_templates_builtin_owner_check check (
    (is_builtin and owner_id is null) or (not is_builtin and owner_id is not null)
  )
);

create unique index prompt_templates_builtin_slug_version_key
  on public.prompt_templates (slug, version) where owner_id is null;
create unique index prompt_templates_owner_slug_version_key
  on public.prompt_templates (owner_id, slug, version) where owner_id is not null;
create index prompt_templates_owner_role_idx on public.prompt_templates (owner_id, role);
create index prompt_templates_parent_id_idx on public.prompt_templates (parent_id);

create or replace function public.protect_prompt_template_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'prompt template versions are immutable';
  end if;
  if new.owner_id is distinct from old.owner_id
    or new.parent_id is distinct from old.parent_id
    or new.slug is distinct from old.slug
    or new.version is distinct from old.version
    or new.name is distinct from old.name
    or new.role is distinct from old.role
    or new.description is distinct from old.description
    or new.prompt is distinct from old.prompt
    or new.knowledge is distinct from old.knowledge
    or new.behavior is distinct from old.behavior
    or new.is_builtin is distinct from old.is_builtin then
    raise exception 'prompt template content is immutable; create a fork';
  end if;
  return new;
end;
$$;

create trigger prompt_templates_immutable
before update or delete on public.prompt_templates
for each row execute function public.protect_prompt_template_version();

create table public.job_descriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes integer not null check (size_bytes >= 0),
  status text not null default 'ready' check (status in ('processing', 'ready', 'failed')),
  raw_text text not null default '',
  extracted jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index job_descriptions_user_created_idx
  on public.job_descriptions (user_id, created_at desc);

create table public.job_description_chunks (
  id uuid primary key default gen_random_uuid(),
  job_description_id uuid not null references public.job_descriptions(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null check (char_length(content) > 0),
  search_vector tsvector generated always as (to_tsvector('english', content)) stored,
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (job_description_id, chunk_index)
);
create index job_description_chunks_job_id_idx
  on public.job_description_chunks (job_description_id);
create index job_description_chunks_search_idx
  on public.job_description_chunks using gin (search_vector);

create table public.interview_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_description_id uuid references public.job_descriptions(id) on delete set null,
  title text not null check (char_length(title) between 2 and 160),
  profession text not null default 'product_management' check (profession = 'product_management'),
  difficulty text not null default 'balanced'
    check (difficulty in ('supportive', 'balanced', 'challenging', 'executive')),
  duration_minutes integer not null default 45 check (duration_minutes between 10 and 120),
  panel jsonb not null check (jsonb_typeof(panel) = 'array' and jsonb_array_length(panel) between 2 and 5),
  rubric jsonb not null check (jsonb_typeof(rubric) = 'array'),
  enabled_tools jsonb not null default '[]'::jsonb check (jsonb_typeof(enabled_tools) = 'array'),
  status text not null default 'ready' check (status in ('draft', 'ready', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint interview_configs_job_owner_fkey
    foreign key (job_description_id, user_id)
    references public.job_descriptions(id, user_id)
);
create index interview_configs_user_status_idx
  on public.interview_configs (user_id, status, created_at desc);
create index interview_configs_job_description_id_idx
  on public.interview_configs (job_description_id);

create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interview_config_id uuid not null references public.interview_configs(id) on delete restrict,
  status text not null default 'configured'
    check (status in ('configured', 'starting', 'live', 'ending', 'ended', 'failed')),
  config_snapshot jsonb not null,
  memory_state jsonb not null default '{}'::jsonb,
  channel_name text unique,
  user_uid integer check (user_uid is null or user_uid > 0),
  agent_uid integer check (agent_uid is null or agent_uid > 0),
  agora_agent_id text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_sessions_config_owner_fkey
    foreign key (interview_config_id, user_id)
    references public.interview_configs(id, user_id)
);
create index interview_sessions_user_status_idx
  on public.interview_sessions (user_id, status, created_at desc);
create index interview_sessions_config_created_idx
  on public.interview_sessions (interview_config_id, created_at desc);
create index interview_sessions_agora_agent_id_idx
  on public.interview_sessions (agora_agent_id) where agora_agent_id is not null;

create or replace function public.protect_session_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.config_snapshot is distinct from old.config_snapshot
    or new.interview_config_id is distinct from old.interview_config_id
    or new.user_id is distinct from old.user_id then
    raise exception 'session configuration snapshots are immutable';
  end if;
  return new;
end;
$$;
create trigger interview_sessions_snapshot_immutable
before update on public.interview_sessions
for each row execute function public.protect_session_snapshot();

create table public.panel_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  panelist_id text not null check (char_length(panelist_id) between 1 and 100),
  display_name text not null check (char_length(display_name) between 2 and 80),
  role text not null check (char_length(role) between 2 and 80),
  agent_uid integer not null check (agent_uid > 0),
  avatar_uid integer not null check (avatar_uid > 0),
  agora_agent_id text unique,
  avatar_vendor text check (
    avatar_vendor is null or avatar_vendor in ('liveavatar', 'generic', 'akool', 'anam')
  ),
  avatar_id text,
  avatar_image text,
  video_mode text not null default 'audio' check (video_mode in ('avatar', 'static', 'audio')),
  status text not null default 'allocated'
    check (status in ('allocated', 'starting', 'running', 'stopping', 'stopped', 'failed')),
  last_event_type text,
  created_at timestamptz not null default now(),
  unique (session_id, panelist_id),
  unique (session_id, agent_uid),
  unique (session_id, avatar_uid)
);
create index panel_participants_session_status_idx
  on public.panel_participants (session_id, status);
create index panel_participants_agent_uid_idx on public.panel_participants (agent_uid);
create index panel_participants_avatar_uid_idx on public.panel_participants (avatar_uid);

create table public.transcript_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  agora_turn_id text,
  speaker_type text not null check (speaker_type in ('candidate', 'interviewer', 'system')),
  speaker_id text,
  content text not null check (char_length(content) > 0),
  interrupted boolean not null default false,
  confidence double precision check (confidence is null or confidence between 0 and 1),
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, sequence),
  unique (session_id, agora_turn_id),
  unique (id, session_id)
);
create index transcript_turns_session_sequence_idx
  on public.transcript_turns (session_id, sequence);
create index transcript_turns_agora_turn_id_idx
  on public.transcript_turns (agora_turn_id) where agora_turn_id is not null;

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  transcript_turn_id uuid not null references public.transcript_turns(id) on delete cascade,
  competency text not null check (char_length(competency) between 2 and 80),
  note text not null default '',
  strength text not null default 'supports'
    check (strength in ('supports', 'contradicts', 'neutral')),
  created_at timestamptz not null default now(),
  constraint evidence_items_turn_session_fkey
    foreign key (transcript_turn_id, session_id)
    references public.transcript_turns(id, session_id),
  unique (session_id, transcript_turn_id, competency)
);
create index evidence_items_session_competency_idx
  on public.evidence_items (session_id, competency);
create index evidence_items_transcript_turn_id_idx
  on public.evidence_items (transcript_turn_id);

create table public.tool_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  transcript_turn_id uuid references public.transcript_turns(id) on delete set null,
  panelist_id text,
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('started', 'completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  constraint tool_runs_turn_session_fkey
    foreign key (transcript_turn_id, session_id)
    references public.transcript_turns(id, session_id)
);
create index tool_runs_session_created_idx on public.tool_runs (session_id, created_at desc);
create index tool_runs_transcript_turn_id_idx on public.tool_runs (transcript_turn_id);
create index tool_runs_panelist_id_idx on public.tool_runs (panelist_id) where panelist_id is not null;
create index tool_runs_tool_status_idx on public.tool_runs (tool_name, status, created_at desc);

create table public.assessment_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.interview_sessions(id) on delete cascade,
  overall_score double precision check (overall_score is null or overall_score between 0 and 100),
  readiness text not null check (
    readiness in ('interview_ready', 'developing', 'needs_practice', 'insufficient_evidence')
  ),
  summary text not null,
  competencies jsonb not null check (jsonb_typeof(competencies) = 'array'),
  interviewer_assessments jsonb not null check (jsonb_typeof(interviewer_assessments) = 'array'),
  evidence_map jsonb not null check (jsonb_typeof(evidence_map) = 'array'),
  generated_at timestamptz not null default now()
);
create index assessment_reports_session_id_idx on public.assessment_reports (session_id);

create table public.rubric_scores (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.assessment_reports(id) on delete cascade,
  competency text not null,
  panelist_id text,
  score double precision check (score is null or score between 0 and 100),
  confidence double precision not null check (confidence between 0 and 1),
  evidence_turn_ids uuid[] not null default '{}',
  feedback text not null,
  created_at timestamptz not null default now(),
  unique (report_id, competency, panelist_id)
);
create index rubric_scores_report_id_idx on public.rubric_scores (report_id);

create table public.replay_drills (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  competency text not null,
  prompt text not null,
  source_turn_ids jsonb not null default '[]'::jsonb,
  status text not null default 'ready' check (status in ('ready', 'in_progress', 'completed')),
  created_at timestamptz not null default now()
);
create index replay_drills_session_created_idx
  on public.replay_drills (session_id, created_at desc);

create table public.agora_webhook_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.interview_sessions(id) on delete set null,
  panel_participant_id uuid references public.panel_participants(id) on delete set null,
  event_key text not null unique,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);
create index agora_webhook_events_type_received_idx
  on public.agora_webhook_events (event_type, received_at desc);
create index agora_webhook_events_session_id_idx
  on public.agora_webhook_events (session_id) where session_id is not null;
create index agora_webhook_events_participant_id_idx
  on public.agora_webhook_events (panel_participant_id) where panel_participant_id is not null;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger prompt_templates_updated_at before update on public.prompt_templates
for each row execute function public.set_updated_at();
create trigger job_descriptions_updated_at before update on public.job_descriptions
for each row execute function public.set_updated_at();
create trigger interview_configs_updated_at before update on public.interview_configs
for each row execute function public.set_updated_at();
create trigger interview_sessions_updated_at before update on public.interview_sessions
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.prompt_templates enable row level security;
alter table public.job_descriptions enable row level security;
alter table public.job_description_chunks enable row level security;
alter table public.interview_configs enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.panel_participants enable row level security;
alter table public.transcript_turns enable row level security;
alter table public.evidence_items enable row level security;
alter table public.tool_runs enable row level security;
alter table public.assessment_reports enable row level security;
alter table public.rubric_scores enable row level security;
alter table public.replay_drills enable row level security;
alter table public.agora_webhook_events enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy prompt_templates_select_available on public.prompt_templates for select to authenticated
using (is_builtin or owner_id = (select auth.uid()));
create policy prompt_templates_insert_own on public.prompt_templates for insert to authenticated
with check (owner_id = (select auth.uid()) and not is_builtin);
create policy prompt_templates_update_status_own on public.prompt_templates for update to authenticated
using (owner_id = (select auth.uid()) and not is_builtin)
with check (owner_id = (select auth.uid()) and not is_builtin);

create policy job_descriptions_all_own on public.job_descriptions for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy job_description_chunks_select_own on public.job_description_chunks for select to authenticated
using (exists (
  select 1 from public.job_descriptions jd
  where jd.id = job_description_id and jd.user_id = (select auth.uid())
));
create policy job_description_chunks_insert_own on public.job_description_chunks for insert to authenticated
with check (exists (
  select 1 from public.job_descriptions jd
  where jd.id = job_description_id and jd.user_id = (select auth.uid())
));

create policy interview_configs_all_own on public.interview_configs for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy interview_sessions_all_own on public.interview_sessions for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy panel_participants_select_own on public.panel_participants for select to authenticated
using (exists (
  select 1 from public.interview_sessions s
  where s.id = session_id and s.user_id = (select auth.uid())
));

create policy transcript_turns_select_own on public.transcript_turns for select to authenticated
using (exists (
  select 1 from public.interview_sessions s
  where s.id = session_id and s.user_id = (select auth.uid())
));
create policy transcript_turns_insert_own on public.transcript_turns for insert to authenticated
with check (exists (
  select 1 from public.interview_sessions s
  where s.id = session_id and s.user_id = (select auth.uid())
));

create policy evidence_items_select_own on public.evidence_items for select to authenticated
using (exists (
  select 1 from public.interview_sessions s
  where s.id = session_id and s.user_id = (select auth.uid())
));
create policy evidence_items_insert_own on public.evidence_items for insert to authenticated
with check (exists (
  select 1 from public.interview_sessions s
  where s.id = session_id and s.user_id = (select auth.uid())
));

create policy tool_runs_select_own on public.tool_runs for select to authenticated
using (exists (
  select 1 from public.interview_sessions s
  where s.id = session_id and s.user_id = (select auth.uid())
));
create policy assessment_reports_select_own on public.assessment_reports for select to authenticated
using (exists (
  select 1 from public.interview_sessions s
  where s.id = session_id and s.user_id = (select auth.uid())
));
create policy rubric_scores_select_own on public.rubric_scores for select to authenticated
using (exists (
  select 1 from public.assessment_reports r
  join public.interview_sessions s on s.id = r.session_id
  where r.id = report_id and s.user_id = (select auth.uid())
));
create policy replay_drills_select_own on public.replay_drills for select to authenticated
using (exists (
  select 1 from public.interview_sessions s
  where s.id = session_id and s.user_id = (select auth.uid())
));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'candidate-documents',
    'candidate-documents',
    false,
    10485760,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown'
    ]
  ),
  ('session-artifacts', 'session-artifacts', false, 52428800, null)
on conflict (id) do update set public = false;

create policy storage_objects_select_own on storage.objects for select to authenticated
using (
  bucket_id in ('candidate-documents', 'session-artifacts')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy storage_objects_insert_own on storage.objects for insert to authenticated
with check (
  bucket_id in ('candidate-documents', 'session-artifacts')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy storage_objects_delete_own on storage.objects for delete to authenticated
using (
  bucket_id in ('candidate-documents', 'session-artifacts')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name'));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
