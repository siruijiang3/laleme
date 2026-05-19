import type { Coordinates, HelpRequest, MapBounds, NewToiletForm, Review, Toilet } from "./domain";
import { isValidCoordinate, parseCoordinate } from "./domain";
import { getServerSupabaseClient } from "./supabase-server";

const defaultLimit = 500;
const maxLimit = 1000;
const defaultRadiusKm = 3;
const osmNote = "OpenStreetMap amenity=toilets 导入点位，等待用户确认状态。";

export type LoadToiletsOptions = {
  bounds?: MapBounds;
  center?: Coordinates;
  radiusKm?: number;
  limit?: number;
  toiletId?: string | null;
};

type RegionRow = {
  id: number;
  name: string;
  slug: string;
  center_latitude: number | string | null;
  center_longitude: number | string | null;
};

type PlaceRow = {
  id: number;
  name: string;
  regions: RegionRow | null;
};

type ToiletRow = {
  id: number;
  name: string;
  floor: string;
  direction: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  is_accessible: boolean;
  notes: string | null;
  source: string | null;
  source_license: string | null;
  source_attribution: string | null;
  source_status: string | null;
  last_imported_at: string | null;
  places: PlaceRow | null;
};

type StatusRow = {
  id: number;
  toilet_id: number;
  is_open: boolean;
  has_paper: boolean;
  is_clean: boolean;
  created_at: string;
};

type ReviewRow = {
  id: number;
  toilet_id: number;
  rating: number;
  body: string;
  author_name: string;
  created_at: string;
};

type PaperRequestRow = {
  id: number;
  toilet_id: number;
  body: string;
  status: "active" | "resolved";
  created_at: string;
};

export async function loadToiletsFromDatabase(options: LoadToiletsOptions) {
  const supabase = getServerSupabaseClient();
  const limit = clampLimit(options.limit);
  const bounds = options.bounds ?? boundsAround(options.center, options.radiusKm ?? defaultRadiusKm);

  let query = supabase
    .from("toilets")
    .select(
      `
        id,
        name,
        floor,
        direction,
        latitude,
        longitude,
        is_accessible,
        notes,
        source,
        source_license,
        source_attribution,
        source_status,
        last_imported_at,
        places (
          id,
          name,
          regions (
            id,
            name,
            slug,
            center_latitude,
            center_longitude
          )
        )
      `,
    )
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .gte("latitude", bounds.south)
    .lte("latitude", bounds.north)
    .gte("longitude", bounds.west)
    .lte("longitude", bounds.east)
    .order("updated_at", { ascending: false })
    .limit(limit);

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const rows = [...((data ?? []) as unknown as ToiletRow[])];
  const requestedToiletId = normalizeDatabaseId(options.toiletId);
  if (requestedToiletId && !rows.some((row) => row.id === requestedToiletId)) {
    const { data: selectedRows, error: selectedError } = await supabase
      .from("toilets")
      .select(
        `
          id,
          name,
          floor,
          direction,
          latitude,
          longitude,
          is_accessible,
          notes,
          source,
          source_license,
          source_attribution,
          source_status,
          last_imported_at,
          places (
            id,
            name,
            regions (
              id,
              name,
              slug,
              center_latitude,
              center_longitude
            )
          )
        `,
      )
      .eq("id", requestedToiletId)
      .limit(1);

    if (selectedError) {
      throw selectedError;
    }

    rows.unshift(...((selectedRows ?? []) as unknown as ToiletRow[]));
  }

  const uniqueRows = uniqueToiletRows(rows);
  const related = await loadRelatedRows(uniqueRows.map((row) => row.id));
  return mapRowsToToilets(uniqueRows, related.statuses, related.reviews, related.requests);
}

export async function saveStatusUpdateToDatabase(
  toiletId: string,
  status: Pick<Toilet, "isOpen" | "hasPaper" | "isClean">,
) {
  const id = requireDatabaseId(toiletId, "toiletId");
  const supabase = getServerSupabaseClient();
  const { error } = await supabase.from("toilet_status_updates").insert({
    toilet_id: id,
    is_open: status.isOpen,
    has_paper: status.hasPaper,
    is_clean: status.isClean,
    source: "web",
  });

  if (error) {
    throw error;
  }
}

export async function saveReviewToDatabase(toiletId: string, score: number, body: string) {
  const id = requireDatabaseId(toiletId, "toiletId");
  const normalizedScore = Math.min(5, Math.max(1, Math.round(score)));
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    throw new Error("评论内容不能为空。");
  }

  const supabase = getServerSupabaseClient();
  const { error } = await supabase.from("toilet_reviews").insert({
    toilet_id: id,
    rating: normalizedScore,
    body: trimmedBody,
    author_name: "匿名用户",
  });

  if (error) {
    throw error;
  }
}

export async function savePaperRequestToDatabase(toiletId: string, body: string) {
  const id = requireDatabaseId(toiletId, "toiletId");
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    throw new Error("求助内容不能为空。");
  }

  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase
    .from("paper_requests")
    .insert({
      toilet_id: id,
      body: trimmedBody,
      status: "active",
    })
    .select("id, toilet_id, body, status, created_at")
    .single();

  if (error || !data) {
    throw error ?? new Error("求助写入失败。");
  }

  return mapPaperRequest(data as PaperRequestRow);
}

export async function resolvePaperRequestInDatabase(helpId: string) {
  const id = requireDatabaseId(helpId, "helpId");
  const supabase = getServerSupabaseClient();
  const { error } = await supabase
    .from("paper_requests")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw error;
  }
}

export async function saveReportToDatabase(input: {
  toiletId?: string;
  reviewId?: string;
  paperRequestId?: string;
  reason: string;
  details?: string;
}) {
  const reason = input.reason.trim();
  if (!reason) {
    throw new Error("举报原因不能为空。");
  }

  const supabase = getServerSupabaseClient();
  const { error } = await supabase.from("reports").insert({
    toilet_id: input.toiletId ? requireDatabaseId(input.toiletId, "toiletId") : null,
    toilet_review_id: input.reviewId ? requireDatabaseId(input.reviewId, "reviewId") : null,
    paper_request_id: input.paperRequestId
      ? requireDatabaseId(input.paperRequestId, "paperRequestId")
      : null,
    reason,
    details: input.details?.trim() || null,
    status: "open",
  });

  if (error) {
    throw error;
  }
}

export async function createToiletInDatabase(input: NewToiletForm) {
  const latitude = parseCoordinate(input.latitude);
  const longitude = parseCoordinate(input.longitude);

  if (!isValidCoordinate(latitude, longitude)) {
    throw new Error("新增厕所必须包含有效经纬度。");
  }

  const coordinates = {
    latitude: Number(latitude),
    longitude: Number(longitude),
  };

  const location = input.location.trim();
  const name = input.name.trim() || buildDefaultToiletName(location, input.floor);

  if (!location) {
    throw new Error("所属地点不能为空。");
  }

  const supabase = getServerSupabaseClient();
  const region = (await findNearestRegion(coordinates)) ?? (await ensureDefaultRegion(coordinates));
  const place = await upsertPlace(region.id, location, coordinates.latitude, coordinates.longitude);
  const floorParts = splitFloor(input.floor.trim() || "未填写");
  const { data, error } = await supabase
    .from("toilets")
    .insert({
      place_id: place.id,
      name,
      floor: floorParts.floor,
      direction: floorParts.direction,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      is_accessible: input.accessibility,
      notes: "用户贡献点位，等待更多人确认。",
      source: "user",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw error ?? new Error("新增厕所失败。");
  }

  const toiletId = String((data as { id: number }).id);
  await saveStatusUpdateToDatabase(toiletId, {
    isOpen: input.isOpen,
    hasPaper: input.hasPaper,
    isClean: input.isClean,
  });

  return toiletId;
}

async function loadRelatedRows(toiletIds: number[]) {
  if (toiletIds.length === 0) {
    return { statuses: [], reviews: [], requests: [] };
  }

  const supabase = getServerSupabaseClient();
  const [statusResult, reviewsResult, requestsResult] = await Promise.all([
    supabase
      .from("toilet_status_updates")
      .select("id, toilet_id, is_open, has_paper, is_clean, created_at")
      .in("toilet_id", toiletIds)
      .order("created_at", { ascending: false })
      .limit(toiletIds.length * 5),
    supabase
      .from("toilet_reviews")
      .select("id, toilet_id, rating, body, author_name, created_at")
      .in("toilet_id", toiletIds)
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(toiletIds.length * 10),
    supabase
      .from("paper_requests")
      .select("id, toilet_id, body, status, created_at")
      .in("toilet_id", toiletIds)
      .order("created_at", { ascending: false })
      .limit(toiletIds.length * 5),
  ]);

  if (statusResult.error) {
    throw statusResult.error;
  }

  if (reviewsResult.error) {
    throw reviewsResult.error;
  }

  if (requestsResult.error) {
    throw requestsResult.error;
  }

  return {
    statuses: (statusResult.data ?? []) as StatusRow[],
    reviews: (reviewsResult.data ?? []) as ReviewRow[],
    requests: (requestsResult.data ?? []) as PaperRequestRow[],
  };
}

function mapRowsToToilets(
  rows: ToiletRow[],
  statuses: StatusRow[],
  reviews: ReviewRow[],
  requests: PaperRequestRow[],
) {
  const statusByToilet = new Map<number, StatusRow>();
  for (const status of statuses) {
    if (!statusByToilet.has(status.toilet_id)) {
      statusByToilet.set(status.toilet_id, status);
    }
  }

  const reviewsByToilet = groupByToiletId(reviews);
  const requestsByToilet = groupByToiletId(requests);

  return rows.map((row) => {
    const toiletReviews = reviewsByToilet.get(row.id) ?? [];
    const toiletRequests = requestsByToilet.get(row.id) ?? [];
    const latestStatus = statusByToilet.get(row.id);
    const regionCenter = getRegionCenter(row.places?.regions);
    const rating =
      toiletReviews.length > 0
        ? Math.round(
            (toiletReviews.reduce((total, review) => total + review.rating, 0) /
              toiletReviews.length) *
              10,
          ) / 10
        : 0;

    return {
      id: String(row.id),
      name: row.name,
      regionName: row.places?.regions?.name ?? "未归属区域",
      location: row.places?.name ?? "未填写地点",
      floor: joinFloor(row.floor, row.direction),
      isOpen: latestStatus?.is_open ?? true,
      hasPaper: latestStatus?.has_paper ?? true,
      isClean: latestStatus?.is_clean ?? true,
      accessibility: row.is_accessible,
      rating,
      reviewCount: toiletReviews.length,
      lastUpdated: latestStatus ? formatRelativeTime(latestStatus.created_at) : "未确认",
      note: buildToiletNote(row),
      source: row.source ?? undefined,
      sourceLicense: row.source_license,
      sourceAttribution: row.source_attribution,
      sourceStatus: row.source_status ?? undefined,
      lastImportedAt: row.last_imported_at,
      latitude: toNumberOrNull(row.latitude),
      longitude: toNumberOrNull(row.longitude),
      regionCenter,
      reviews: toiletReviews.map(mapReview),
      helpRequests: toiletRequests.map(mapPaperRequest),
    } satisfies Toilet;
  });
}

function groupByToiletId<T extends { toilet_id: number }>(rows: T[]) {
  const grouped = new Map<number, T[]>();

  for (const row of rows) {
    const group = grouped.get(row.toilet_id) ?? [];
    group.push(row);
    grouped.set(row.toilet_id, group);
  }

  return grouped;
}

async function findNearestRegion(coordinates: Coordinates) {
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase
    .from("regions")
    .select("id, slug, name, center_latitude, center_longitude")
    .limit(1000);

  if (error) {
    throw error;
  }

  const candidates = ((data ?? []) as RegionRow[]).filter((region) =>
    isValidCoordinate(region.center_latitude, region.center_longitude),
  );

  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((region) => ({
      region,
      distance: distanceMeters(coordinates, {
        latitude: Number(region.center_latitude),
        longitude: Number(region.center_longitude),
      }),
    }))
    .sort((left, right) => left.distance - right.distance)[0].region;
}

async function ensureDefaultRegion(coordinates: Coordinates) {
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase
    .from("regions")
    .upsert(
      {
        slug: "global",
        name: "全球服务范围",
        description: "生产默认服务范围。具体点位按地图范围读取。",
        center_latitude: coordinates.latitude,
        center_longitude: coordinates.longitude,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slug" },
    )
    .select("id, slug, name, center_latitude, center_longitude")
    .single();

  if (error || !data) {
    throw error ?? new Error("无法创建默认服务范围。");
  }

  return data as RegionRow;
}

async function upsertPlace(regionId: number, name: string, latitude: number, longitude: number) {
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase
    .from("places")
    .upsert(
      {
        region_id: regionId,
        name,
        place_type: "user_contributed",
        latitude,
        longitude,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "region_id,name",
      },
    )
    .select("id, name")
    .single();

  if (error || !data) {
    throw error ?? new Error("无法写入地点。");
  }

  return data as { id: number; name: string };
}

function uniqueToiletRows(rows: ToiletRow[]) {
  const seen = new Set<number>();
  const uniqueRows: ToiletRow[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }

    seen.add(row.id);
    uniqueRows.push(row);
  }

  return uniqueRows;
}

function boundsAround(center: Coordinates | undefined, radiusKm: number): MapBounds {
  const safeCenter = center ?? { latitude: 22.3193, longitude: 114.1694 };
  const latitudeDelta = radiusKm / 111.32;
  const longitudeDelta =
    radiusKm / (111.32 * Math.max(0.2, Math.cos((safeCenter.latitude * Math.PI) / 180)));

  return {
    south: clampCoordinate(safeCenter.latitude - latitudeDelta, -90, 90),
    west: clampCoordinate(safeCenter.longitude - longitudeDelta, -180, 180),
    north: clampCoordinate(safeCenter.latitude + latitudeDelta, -90, 90),
    east: clampCoordinate(safeCenter.longitude + longitudeDelta, -180, 180),
  };
}

function clampLimit(limit: number | undefined) {
  const parsed = Number(limit ?? defaultLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }

  return Math.min(maxLimit, Math.max(1, Math.floor(parsed)));
}

function normalizeDatabaseId(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  return Number(value);
}

function requireDatabaseId(value: string, label: string) {
  const id = normalizeDatabaseId(value);
  if (!id) {
    throw new Error(`${label} 必须是数据库 ID。`);
  }

  return id;
}

function mapReview(row: ReviewRow): Review {
  return {
    id: String(row.id),
    author: row.author_name,
    score: row.rating,
    body: row.body,
    time: formatRelativeTime(row.created_at),
  };
}

function mapPaperRequest(row: PaperRequestRow): HelpRequest {
  return {
    id: String(row.id),
    body: row.body,
    time: formatRelativeTime(row.created_at),
    status: row.status,
  };
}

function buildToiletNote(row: ToiletRow) {
  const baseNote = row.notes ?? "暂无备注。";

  if (row.source !== "osm") {
    return baseNote;
  }

  if (row.source_status === "needs_verification") {
    return `${baseNote} OSM 后续同步未再次发现该点位，建议现场确认。`;
  }

  return `${baseNote} 数据底座来自 OpenStreetMap，状态仍需用户确认。`;
}

function joinFloor(floor: string, direction: string | null) {
  if (!direction) {
    return floor;
  }

  return `${floor} / ${direction}`;
}

function splitFloor(value: string) {
  const [floor, direction] = value.split("/").map((part) => part.trim());

  return {
    floor: floor || "未填写",
    direction: direction || null,
  };
}

function getRegionCenter(region: RegionRow | null | undefined) {
  const latitude = toNumberOrNull(region?.center_latitude);
  const longitude = toNumberOrNull(region?.center_longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function toNumberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function buildDefaultToiletName(location: string, floor: string) {
  const floorText = floor.trim() || "未填写楼层";
  return `${location} ${floorText} 卫生间`;
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return "刚刚";
  }

  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (diffSeconds < 60) {
    return "刚刚";
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  return `${Math.floor(diffHours / 24)} 天前`;
}

function distanceMeters(origin: Coordinates, target: Coordinates) {
  const earthRadiusMeters = 6371000;
  const originLatitude = toRadians(origin.latitude);
  const targetLatitude = toRadians(target.latitude);
  const latitudeDelta = toRadians(target.latitude - origin.latitude);
  const longitudeDelta = toRadians(target.longitude - origin.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(targetLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function clampCoordinate(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
