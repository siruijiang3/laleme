import { NextResponse } from "next/server";
import { getAdminClient, isAdminStatus, verifyAdminRequest } from "../../../../lib/admin-server";

const reportsSelect = `
  id,
  reason,
  details,
  status,
  created_at,
  resolved_at,
  toilet_id,
  toilet_review_id,
  paper_request_id,
  toilets (
    id,
    name,
    floor,
    direction,
    places (
      name,
      regions (
        name
      )
    )
  ),
  toilet_reviews (
    id,
    rating,
    body,
    author_name,
    is_hidden,
    toilets (
      id,
      name
    )
  ),
  paper_requests (
    id,
    body,
    status,
    toilets (
      id,
      name
    )
  )
`;

export async function GET(request: Request) {
  const admin = verifyAdminRequest(request);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.message }, { status: admin.status });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "未配置 SUPABASE_SERVICE_ROLE_KEY，无法读取举报。" },
      { status: 503 },
    );
  }

  const { data, error } = await supabase
    .from("reports")
    .select(reportsSelect)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ reports: data ?? [] });
}

export async function PATCH(request: Request) {
  const admin = verifyAdminRequest(request);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.message }, { status: admin.status });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "未配置 SUPABASE_SERVICE_ROLE_KEY，无法处理举报。" },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    action?: string;
    reportId?: number;
    status?: unknown;
    reviewId?: number;
    paperRequestId?: number;
  } | null;

  if (!body?.action) {
    return NextResponse.json({ error: "缺少处理动作。" }, { status: 400 });
  }

  if (body.action === "update-report-status") {
    if (!body.reportId || !isAdminStatus(body.status)) {
      return NextResponse.json({ error: "举报状态参数无效。" }, { status: 400 });
    }

    const patch = {
      status: body.status,
      resolved_at:
        body.status === "resolved" || body.status === "dismissed" ? new Date().toISOString() : null,
    };
    const { error } = await supabase.from("reports").update(patch).eq("id", body.reportId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  if (body.action === "hide-review" || body.action === "unhide-review") {
    if (!body.reviewId) {
      return NextResponse.json({ error: "缺少评论 id。" }, { status: 400 });
    }

    const { error } = await supabase
      .from("toilet_reviews")
      .update({ is_hidden: body.action === "hide-review" })
      .eq("id", body.reviewId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  if (body.action === "resolve-paper-request") {
    if (!body.paperRequestId) {
      return NextResponse.json({ error: "缺少求助 id。" }, { status: 400 });
    }

    const { error } = await supabase
      .from("paper_requests")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", body.paperRequestId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "未知处理动作。" }, { status: 400 });
}
