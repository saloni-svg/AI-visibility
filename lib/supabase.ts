import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

// Server-side client using the service role key. Never import this into
// browser code: the key has full access to the database.
export const supabase = createClient(
  requireEnv("SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);
