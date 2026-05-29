import { NextResponse, type NextRequest } from "next/server";
import {
  loadToiletDetailFromDatabase,
  saveToiletProfileToDatabase,
} from "../../../../lib/toilet-service";

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ toiletId: string }> },
) {
  try {
    const { toiletId } = await params;
    const payload = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      location?: unknown;
      floor?: unknown;
    };

    await saveToiletProfileToDatabase(toiletId, {
      name: typeof payload.name === "string" ? payload.name : "",
      location: typeof payload.location === "string" ? payload.location : "",
      floor: typeof payload.floor === "string" ? payload.floor : "",
    });

    return NextResponse.json({ ok: true, data: {} });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "未知错误" },
      { status: 400 },
    );
  }
}
