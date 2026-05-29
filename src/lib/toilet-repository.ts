import type {
  Coordinates,
  DataSource,
  HelpRequest,
  MapBounds,
  NearbyHelpRequest,
  NewToiletForm,
  Toilet,
  ToiletSummary,
} from "./domain";

export type LoadToiletsResult = {
  source: DataSource;
  toilets: Toilet[];
  message: string;
};

export type LoadViewportToiletsResult = {
  source: DataSource;
  toilets: ToiletSummary[];
  message: string;
  limit: number;
  truncated: boolean;
};

export type LoadToiletsParams = {
  bounds?: MapBounds;
  center?: Coordinates;
  radiusKm?: number;
  limit?: number;
  toiletId?: string | null;
};

export type LoadViewportToiletsParams = Omit<LoadToiletsParams, "toiletId">;

export type StatusUpdateInput = Partial<
  Pick<Toilet, "isOpen" | "hasPaper" | "isClean" | "accessibility">
>;

export type ToiletProfileUpdateInput = Pick<Toilet, "name" | "location" | "floor">;

type ApiResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export function getInitialToilets() {
  return [];
}

export function getInitialDataSource(): DataSource {
  return "supabase";
}

export function getInitialDataMessage() {
  return "正在读取生产数据库。";
}

export async function loadToilets(params: LoadToiletsParams = {}): Promise<LoadToiletsResult> {
  const searchParams = new URLSearchParams();

  if (params.bounds) {
    searchParams.set("south", String(params.bounds.south));
    searchParams.set("west", String(params.bounds.west));
    searchParams.set("north", String(params.bounds.north));
    searchParams.set("east", String(params.bounds.east));
  } else if (params.center) {
    searchParams.set("latitude", String(params.center.latitude));
    searchParams.set("longitude", String(params.center.longitude));
  }

  if (params.radiusKm) {
    searchParams.set("radiusKm", String(params.radiusKm));
  }

  if (params.limit) {
    searchParams.set("limit", String(params.limit));
  }

  if (params.toiletId) {
    searchParams.set("toilet", params.toiletId);
  }

  const result = await requestApi<{ toilets: Toilet[] }>(`/api/toilets?${searchParams}`);

  if (!result.ok) {
    return {
      source: "error",
      toilets: [],
      message: result.error ?? "生产数据库读取失败。",
    };
  }

  return {
    source: "supabase",
    toilets: result.data?.toilets ?? [],
    message: "正在使用生产 Supabase 数据。",
  };
}

export async function loadViewportToilets(
  params: LoadViewportToiletsParams = {},
  signal?: AbortSignal,
): Promise<LoadViewportToiletsResult> {
  const searchParams = new URLSearchParams();

  if (params.bounds) {
    searchParams.set("south", String(params.bounds.south));
    searchParams.set("west", String(params.bounds.west));
    searchParams.set("north", String(params.bounds.north));
    searchParams.set("east", String(params.bounds.east));
  } else if (params.center) {
    searchParams.set("latitude", String(params.center.latitude));
    searchParams.set("longitude", String(params.center.longitude));
  }

  if (params.radiusKm) {
    searchParams.set("radiusKm", String(params.radiusKm));
  }

  if (params.limit) {
    searchParams.set("limit", String(params.limit));
  }

  const result = await requestApi<{
    toilets: ToiletSummary[];
    limit: number;
    truncated: boolean;
    message: string;
  }>(`/api/toilets/viewport?${searchParams}`, { signal });

  if (!result.ok) {
    return {
      source: "error",
      toilets: [],
      message: result.error ?? "生产数据库读取失败。",
      limit: 0,
      truncated: false,
    };
  }

  return {
    source: "supabase",
    toilets: result.data?.toilets ?? [],
    message: result.data?.message || "正在使用生产 Supabase 数据。",
    limit: result.data?.limit ?? 0,
    truncated: Boolean(result.data?.truncated),
  };
}

export async function loadToiletDetail(toiletId: string, signal?: AbortSignal) {
  const result = await requestApi<{ toilet: Toilet }>(
    `/api/toilets/${encodeURIComponent(toiletId)}`,
    { signal },
  );
  return result.data?.toilet ?? null;
}

export async function loadNearbyHelpRequests(origin?: Coordinates, signal?: AbortSignal) {
  const searchParams = new URLSearchParams();

  if (origin) {
    searchParams.set("latitude", String(origin.latitude));
    searchParams.set("longitude", String(origin.longitude));
  }

  const result = await requestApi<{ helpRequests: NearbyHelpRequest[] }>(
    `/api/paper-requests/nearby?${searchParams}`,
    { signal },
  );

  return result.data?.helpRequests ?? [];
}

export async function saveStatusUpdate(
  toiletId: string,
  status: StatusUpdateInput,
) {
  const result = await requestApi(`/api/toilets/${toiletId}/status`, {
    method: "POST",
    body: JSON.stringify(status),
  });

  return result.ok;
}

export async function saveToiletProfile(
  toiletId: string,
  input: ToiletProfileUpdateInput,
) {
  const result = await requestApi(`/api/toilets/${toiletId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });

  return result.ok;
}

export async function saveReview(toiletId: string, score: number, body: string) {
  const result = await requestApi(`/api/toilets/${toiletId}/reviews`, {
    method: "POST",
    body: JSON.stringify({ score, body }),
  });

  return result.ok;
}

export async function savePaperRequest(toiletId: string, body: string): Promise<HelpRequest | null> {
  const result = await requestApi<{ helpRequest: HelpRequest }>(
    `/api/toilets/${toiletId}/paper-requests`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
  );

  return result.data?.helpRequest ?? null;
}

export async function resolvePaperRequest(helpId: string) {
  const result = await requestApi(`/api/paper-requests/${helpId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved" }),
  });

  return result.ok;
}

export async function createToilet(input: NewToiletForm) {
  const result = await requestApi<{ toiletId: string }>("/api/toilets", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return result.data?.toiletId ?? null;
}

export async function saveReport(input: {
  toiletId?: string;
  reviewId?: string;
  paperRequestId?: string;
  reason: string;
  details?: string;
}) {
  const result = await requestApi("/api/reports", {
    method: "POST",
    body: JSON.stringify(input),
  });

  return result.ok;
}

async function requestApi<T>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as ApiResult<T>;

    if (!response.ok || payload.ok === false) {
      return {
        ok: false,
        error: payload.error ?? `请求失败：${response.status}`,
      };
    }

    return {
      ok: true,
      data: payload.data,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "网络请求失败。",
    };
  }
}
