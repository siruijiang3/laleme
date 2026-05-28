import { NextResponse, type NextRequest } from "next/server";
import { saveStatusUpdateToDatabase } from "../../../../../lib/toilet-service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ toiletId: string }> },
) {
  try {
    const { toiletId } = await params;
    const body = await request.json();

    const hasOpen = typeof body.isOpen === "boolean";
    const hasPaper = typeof body.hasPaper === "boolean";
    const hasClean = typeof body.isClean === "boolean";
    const hasAccessibility = typeof body.accessibility === "boolean";

    if ((hasOpen || hasPaper || hasClean) && !(hasOpen && hasPaper && hasClean)) {
      throw new Error("开放、厕纸和清洁状态必须同时提交。");
    }

    if (!hasOpen && !hasAccessibility) {
      throw new Error("没有可更新的厕所状态。");
    }

    await saveStatusUpdateToDatabase(toiletId, {
      ...(hasOpen
        ? {
            isOpen: body.isOpen,
            hasPaper: body.hasPaper,
            isClean: body.isClean,
          }
        : {}),
      ...(hasAccessibility ? { accessibility: body.accessibility } : {}),
    });

    return NextResponse.json({ ok: true, data: {} });
  } catch (error) {
    return NextResponse.json({ ok: false, error: formatError(error) }, { status: 400 });
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
