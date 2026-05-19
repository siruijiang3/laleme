import { NextResponse, type NextRequest } from "next/server";
import { savePaperRequestToDatabase } from "../../../../../lib/toilet-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ toiletId: string }> },
) {
  try {
    const { toiletId } = await params;
    const body = await request.json();
    const helpRequest = await savePaperRequestToDatabase(toiletId, String(body.body ?? ""));

    return NextResponse.json({ ok: true, data: { helpRequest } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: formatError(error) }, { status: 400 });
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
