import { config } from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

config();
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY as string;

export const MAX_LIMIT = 1000;

export class DbService {
  private supabase: SupabaseClient;
  private static db: DbService;

  constructor() {
    this.supabase = createClient(supabaseUrl, supabaseAnonKey);
  }

  public static shared() {
    if (!DbService.db) {
      DbService.db = new DbService();
    }
    return DbService.db;
  }

  public instance() {
    return this.supabase;
  }

}
