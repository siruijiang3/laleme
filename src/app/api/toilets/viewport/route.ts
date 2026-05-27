import { NextResponse, type NextRequest } from "next/server";
import type { MapBounds } from "../../../../lib/domain";
import { loadToiletSummariesFromDatabase } from "../../../../lib/toilet-service";

export const dynamic = "force-dynamic";

const viewportMaxLimit = 300;

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const bounds = readBounds(params);
    const center = readCenter(params);
    if (!bounds && !center) {
      return NextResponse.json(
        {
          ok: false,
          error: "必须提供地图 bbox，或提供 latitude / longitude 中心点。",
        },
        { status: 400 },
      );
    }

    const limit = clampViewportLimit(readNumber(params.get("limit")));
    const result = await loadToiletSummariesFromDatabase({
      bounds,
      center,
      radiusKm: readNumber(params.get("radiusKm")) ?? undefined,
      limit,
    });

    return NextResponse.json({
      ok: true,
      data: {
        toilets: result.toilets,
        count: result.toilets.length,
        limit: result.limit,
        truncated: result.truncated,
        message: result.truncated ? "正在使用生产 Supabase 数据，当前范围只返回部分点位。" : "",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "未知错误" },
      { status: 400 },
    );
  }
}

function clampViewportLimit(value: number | null) {
  if (value === null || value <= 0) {
    return viewportMaxLimit;
  }

  return Math.min(viewportMaxLimit, Math.max(1, Math.floor(value)));
}

function readBounds(params: URLSearchParams): MapBounds | undefined {
  const south = readNumber(params.get("south"));
  const west = readNumber(params.get("west"));
  const north = readNumber(params.get("north"));
  const east = readNumber(params.get("east"));

  if ([south, west, north, east].some((value) => value === null)) {
    return undefined;
  }

  if (
    south! < -90 ||
    north! > 90 ||
    west! < -180 ||
    east! > 180 ||
    south! >= north! ||
    west! >= east!
  ) {
    throw new Error("地图范围 bbox 无效。");
  }

  return { south: south!, west: west!, north: north!, east: east! };
}

function readCenter(params: URLSearchParams) {
  const latitude = readNumber(params.get("latitude"));
  const longitude = readNumber(params.get("longitude"));

  if (latitude === null || longitude === null) {
    return undefined;
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error("地图中心坐标无效。");
  }

  return { latitude, longitude };
}

function readNumber(value: string | null) {
  if (value === null || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
