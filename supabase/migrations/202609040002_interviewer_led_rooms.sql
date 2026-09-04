alter table public.interview_configs
  add column if not exists interview_mode text not null default 'candidate_practice';

alter table public.interview_configs
  drop constraint if exists interview_configs_interview_mode_check;

alter table public.interview_configs
  add constraint interview_configs_interview_mode_check
  check (interview_mode in ('candidate_practice', 'interviewer_led'));

comment on column public.interview_configs.interview_mode is
  'candidate_practice means the owner takes the interview; interviewer_led means the owner hosts and invites a candidate.';
