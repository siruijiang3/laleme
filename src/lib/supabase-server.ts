import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { validateSupabasePublicUrl } from "./data-config";

let cachedClient: SupabaseClient | null = null;

export function getServerSupabaseClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const validation = validateSupabasePublicUrl(url);

  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  if (!serviceRoleKey?.trim()) {
    throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY。生产 API 不能访问数据库。");
  }

  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = createClient(validation.url.toString(), serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}
