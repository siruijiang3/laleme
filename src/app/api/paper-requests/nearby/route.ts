import { NextResponse, type NextRequest } from "next/server";
import { readDefaultMapCenter } from "../../../../lib/data-config";
import { isValidCoordinate } from "../../../../lib/domain";
import { loadNearbyHelpRequestsFromDatabase } from "../../../../lib/toilet-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const origin = readOrigin(params);
    const helpRequests = await loadNearbyHelpRequestsFromDatabase({
      origin,
      limit: readLimit(params),
    });

    return NextResponse.json({ ok: true, data: { helpRequests } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "未知错误" },
      { status: 400 },
    );
  }
}

function readOrigin(params: URLSearchParams) {
  const latitude = readNumber(params.get("latitude"));
  const longitude = readNumber(params.get("longitude"));

  if (latitude === null || longitude === null) {
    return readDefaultMapCenter();
  }

  if (!isValidCoordinate(latitude, longitude)) {
    throw new Error("定位坐标无效。");
  }

  return { latitude, longitude };
}

function readLimit(params: URLSearchParams) {
  const limit = readNumber(params.get("limit"));
  return limit === null ? undefined : limit;
}

function readNumber(value: string | null) {
  if (value === null || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
