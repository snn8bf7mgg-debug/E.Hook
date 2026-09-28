const TABLE = "daily_check_ins";

/** Database adapter. The Supabase client and its service role key stay server-side. */
export class SupabaseCheckInRepository {
  constructor(client) {
    this.client = client;
  }

  insert(checkIn, telegramUserId) {
    return this.client.from(TABLE).insert({ ...checkIn, telegram_user_id: telegramUserId }).select("*").single();
  }

  findByDate(date, telegramUserId) {
    return this.client.from(TABLE).select("*").eq("date", date).eq("telegram_user_id", telegramUserId).maybeSingle();
  }
}
