create extension if not exists pgcrypto;

create table if not exists public.daily_check_ins (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  diet_score numeric not null check (diet_score between 0 and 10),
  swim_score numeric null check (swim_score between 0 and 10),
  swim_distance_m numeric null check (swim_distance_m >= 0),
  bike_score numeric null check (bike_score between 0 and 10),
  bike_distance_km numeric null check (bike_distance_km >= 0),
  run_score numeric null check (run_score between 0 and 10),
  run_distance_km numeric null check (run_distance_km >= 0),
  social_score numeric not null check (social_score between 0 and 10),
  work_score numeric not null check (work_score between 0 and 10),
  sleep_score numeric not null check (sleep_score between 0 and 100),
  sleep_duration_minutes integer not null check (sleep_duration_minutes between 0 and 1440),
  money_in numeric not null check (money_in >= 0),
  money_spent numeric not null check (money_spent >= 0),
  unnecessary_spending numeric not null check (unnecessary_spending >= 0),
  happiness numeric not null check (happiness between 0 and 10),
  hrv_ms numeric not null check (hrv_ms between 0 and 1000),
  rhr_bpm numeric not null check (rhr_bpm between 20 and 250),
  weight_kg numeric not null check (weight_kg > 0 and weight_kg <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_check_ins_swim_rest_pair check ((swim_score is null) = (swim_distance_m is null)),
  constraint daily_check_ins_bike_rest_pair check ((bike_score is null) = (bike_distance_km is null)),
  constraint daily_check_ins_run_rest_pair check ((run_score is null) = (run_distance_km is null))
);

create or replace function public.set_daily_check_ins_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists daily_check_ins_set_updated_at on public.daily_check_ins;
create trigger daily_check_ins_set_updated_at
before update on public.daily_check_ins
for each row execute function public.set_daily_check_ins_updated_at();

alter table public.daily_check_ins enable row level security;
revoke all on table public.daily_check_ins from public, anon, authenticated;
grant all on table public.daily_check_ins to service_role;
