import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabaseClient } from "./supabase-server";

export type AdminStatus = "open" | "reviewed" | "resolved" | "dismissed";

export function getAdminClient(): SupabaseClient | null {
  try {
    return getServerSupabaseClient();
  } catch {
    return null;
  }
}

export function verifyAdminRequest(request: Request) {
  const expectedToken = process.env.ADMIN_TOKEN;

  if (!expectedToken) {
    return { ok: false, status: 503, message: "未配置 ADMIN_TOKEN。" };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const headerToken = request.headers.get("x-admin-token")?.trim() ?? "";

  if (bearerToken !== expectedToken && headerToken !== expectedToken) {
    return { ok: false, status: 401, message: "管理员令牌无效。" };
  }

  return { ok: true, status: 200, message: "" };
}

export function isAdminStatus(value: unknown): value is AdminStatus {
  return value === "open" || value === "reviewed" || value === "resolved" || value === "dismissed";
}
