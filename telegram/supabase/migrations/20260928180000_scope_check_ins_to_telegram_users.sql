-- Associate new check-ins with the Telegram user authenticated by the API.
-- Existing Stage 3 rows are left unassigned; no historical owner is inferred.
alter table public.daily_check_ins
  add column if not exists telegram_user_id bigint;

alter table public.daily_check_ins
  drop constraint if exists daily_check_ins_date_key;

create unique index if not exists daily_check_ins_telegram_user_date_key
  on public.daily_check_ins (telegram_user_id, date);

-- NOT VALID preserves any existing unassigned rows while requiring an account
-- identity for all new rows and any subsequently updated rows.
alter table public.daily_check_ins
  drop constraint if exists daily_check_ins_telegram_user_id_required;
alter table public.daily_check_ins
  add constraint daily_check_ins_telegram_user_id_required
  check (telegram_user_id is not null) not valid;

grant all on table public.daily_check_ins to service_role;
