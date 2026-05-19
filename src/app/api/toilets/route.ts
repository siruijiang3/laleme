import { NextResponse, type NextRequest } from "next/server";
import type { MapBounds } from "../../../lib/domain";
import {
  createToiletInDatabase,
  loadToiletsFromDatabase,
} from "../../../lib/toilet-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const bounds = readBounds(params);
    const center = readCenter(params);
    const radiusKm = readNumber(params.get("radiusKm"));
    const limit = readNumber(params.get("limit"));
    const toiletId = params.get("toilet");
    const toilets = await loadToiletsFromDatabase({
      bounds,
      center,
      radiusKm: radiusKm ?? undefined,
      limit: limit ?? undefined,
      toiletId,
    });

    return NextResponse.json({ ok: true, data: { toilets } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: formatError(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const toiletId = await createToiletInDatabase({
      name: String(body.name ?? ""),
      location: String(body.location ?? ""),
      floor: String(body.floor ?? ""),
      isOpen: Boolean(body.isOpen),
      hasPaper: Boolean(body.hasPaper),
      isClean: Boolean(body.isClean),
      accessibility: Boolean(body.accessibility),
      latitude: String(body.latitude ?? ""),
      longitude: String(body.longitude ?? ""),
    });

    return NextResponse.json({ ok: true, data: { toiletId } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: formatError(error) },
      { status: 400 },
    );
  }
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

function formatError(error: unknown) {
  return error instanceof Error ? error.message : "未知错误";
}
