import { NextResponse, type NextRequest } from "next/server";
import type { MapBounds } from "../../../../lib/domain";
import { loadPublicToiletsFromDatabase } from "../../../../lib/toilet-service";

export const dynamic = "force-dynamic";

const publicHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const cacheHeader = "public, max-age=0, s-maxage=300, stale-while-revalidate=3600";
const cdnCacheHeader = "public, s-maxage=300, stale-while-revalidate=3600";

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: publicHeaders,
  });
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const bounds = readBounds(params);
    const center = readCenter(params);

    if (!bounds && !center) {
      return publicJson(
        {
          ok: false,
          error: "必须提供 bbox 参数 south/west/north/east，或中心点 latitude/longitude。",
        },
        400,
      );
    }

    const result = await loadPublicToiletsFromDatabase({
      bounds,
      center,
      radiusKm: readNumber(params.get("radiusKm")) ?? undefined,
      limit: readNumber(params.get("limit")) ?? undefined,
    });

    return publicJson({
      ok: true,
      data: {
        toilets: result.toilets,
        count: result.toilets.length,
        limit: result.limit,
        truncated: result.truncated,
        license: "ODbL-1.0",
        attribution: ["OpenStreetMap contributors", "LaLeMe contributors"],
      },
    });
  } catch (error) {
    if (error instanceof PublicApiInputError) {
      return publicJson(
        {
          ok: false,
          error: error.message,
        },
        400,
      );
    }

    console.error("[public-toilets-api]", error);
    return publicJson(
      {
        ok: false,
        error: "开放数据接口暂时不可用，请稍后重试。",
      },
      500,
    );
  }
}

function publicJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      ...publicHeaders,
      "Cache-Control": cacheHeader,
      "CDN-Cache-Control": cdnCacheHeader,
      "Vercel-CDN-Cache-Control": cdnCacheHeader,
    },
  });
}

function readBounds(params: URLSearchParams): MapBounds | undefined {
  const hasAnyBoundsParam = ["south", "west", "north", "east"].some((key) => params.has(key));
  if (!hasAnyBoundsParam) {
    return undefined;
  }

  const south = readNumber(params.get("south"));
  const west = readNumber(params.get("west"));
  const north = readNumber(params.get("north"));
  const east = readNumber(params.get("east"));

  if ([south, west, north, east].some((value) => value === null)) {
    throw new PublicApiInputError("bbox 参数必须同时包含有效的 south、west、north、east。");
  }

  if (
    south! < -90 ||
    north! > 90 ||
    west! < -180 ||
    east! > 180 ||
    south! >= north! ||
    west! >= east!
  ) {
    throw new PublicApiInputError("bbox 坐标范围无效。");
  }

  return { south: south!, west: west!, north: north!, east: east! };
}

function readCenter(params: URLSearchParams) {
  const hasAnyCenterParam = ["latitude", "longitude"].some((key) => params.has(key));
  if (!hasAnyCenterParam) {
    return undefined;
  }

  const latitude = readNumber(params.get("latitude"));
  const longitude = readNumber(params.get("longitude"));

  if (latitude === null || longitude === null) {
    throw new PublicApiInputError("中心点参数必须同时包含有效的 latitude 和 longitude。");
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new PublicApiInputError("中心点坐标无效。");
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

class PublicApiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicApiInputError";
  }
}
