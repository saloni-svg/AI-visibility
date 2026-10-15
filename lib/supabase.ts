import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./env";

// Server-side client using the service role key. Never import this into
// browser code: the key has full access to the database. Created on first use
// so that importing this file never fails before the keys are needed.
let client: SupabaseClient | undefined;

export function db(): SupabaseClient {
  client ??= createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  return client;
}
