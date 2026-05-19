import { NextResponse, type NextRequest } from "next/server";
import { saveReportToDatabase } from "../../../lib/toilet-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    await saveReportToDatabase({
      toiletId: body.toiletId ? String(body.toiletId) : undefined,
      reviewId: body.reviewId ? String(body.reviewId) : undefined,
      paperRequestId: body.paperRequestId ? String(body.paperRequestId) : undefined,
      reason: String(body.reason ?? ""),
      details: body.details ? String(body.details) : undefined,
    });

    return NextResponse.json({ ok: true, data: {} });
  } catch (error) {
    return NextResponse.json({ ok: false, error: formatError(error) }, { status: 400 });
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
