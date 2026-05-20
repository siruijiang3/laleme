import { NextResponse, type NextRequest } from "next/server";
import { loadToiletDetailFromDatabase } from "../../../../lib/toilet-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ toiletId: string }> },
) {
  try {
    const { toiletId } = await params;
    const toilet = await loadToiletDetailFromDatabase(toiletId);

    if (!toilet) {
      return NextResponse.json({ ok: false, error: "厕所不存在。" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: { toilet } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "未知错误" },
      { status: 400 },
    );
  }
}
