import { NextResponse, type NextRequest } from "next/server";
import { resolvePaperRequestInDatabase } from "../../../../lib/toilet-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ helpId: string }> },
) {
  try {
    const { helpId } = await params;
    const body = await request.json();

    if (body.status !== "resolved") {
      throw new Error("只支持把求助标记为已解决。");
    }

    await resolvePaperRequestInDatabase(helpId);
    return NextResponse.json({ ok: true, data: {} });
  } catch (error) {
    return NextResponse.json({ ok: false, error: formatError(error) }, { status: 400 });
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
