"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapLayerMouseEvent,
  MapMouseEvent,
  Marker,
} from "maplibre-gl";
import type { Coordinates, MapBounds, ToiletSummary } from "../lib/domain";
import { hasValidCoordinates } from "../lib/domain";
import styles from "./toilet-map.module.css";

type MapLibreModule = typeof import("maplibre-gl");
type ToiletWithCoordinates = ToiletSummary & { latitude: number; longitude: number };
type MarkerStatus = "open" | "noPaper" | "closed" | "unconfirmed" | "help";
type ToiletFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: {
      type: "Point";
      coordinates: [number, number];
    };
    properties: {
      id: string;
      name: string;
      status: MarkerStatus;
      selected: boolean;
    };
  }>;
};

export type MapLocationPick = {
  coordinates: Coordinates;
  placeName: string | null;
};

export type MapViewport = {
  center: Coordinates;
  bounds: MapBounds;
  zoom: number;
};

export type MapFocusRequest = {
  id: number;
  center: Coordinates;
  zoom?: number;
};

const mapStyleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim() ?? "";
const defaultZoom = 15.5;
const toiletSourceId = "laleme-toilets";
const toiletCircleLayerId = "laleme-toilet-circles";

export function ToiletMap({
  label,
  toilets,
  selectedToiletId,
  center,
  pickingMode = false,
  pickedCoordinates = null,
  userLocation = null,
  focusRequest = null,
  compact = false,
  onSelectToilet,
  onPickCoordinates,
  onViewportChange,
}: {
  label?: string;
  toilets: ToiletSummary[];
  selectedToiletId: string;
  center: Coordinates;
  pickingMode?: boolean;
  pickedCoordinates?: Coordinates | null;
  userLocation?: Coordinates | null;
  focusRequest?: MapFocusRequest | null;
  compact?: boolean;
  onSelectToilet: (toiletId: string) => void;
  onPickCoordinates?: (pick: MapLocationPick) => void;
  onViewportChange?: (viewport: MapViewport) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapLibraryRef = useRef<MapLibreModule | null>(null);
  const overlayMarkerRefs = useRef<Marker[]>([]);
  const onViewportChangeRef = useRef(onViewportChange);
  const onSelectToiletRef = useRef(onSelectToilet);
  const pickingModeRef = useRef(pickingMode);
  const lastEmittedCenterRef = useRef<Coordinates | null>(null);
  const previousCenterKeyRef = useRef<string | null>(null);
  const previousFocusRequestIdRef = useRef<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(
    mapStyleUrl ? null : "生产地图样式未配置。请设置 NEXT_PUBLIC_MAP_STYLE_URL。",
  );
  const mapLabel = label ?? "当前地图范围";
  const centerKey = coordinatesKey(center);

  const toiletsWithCoordinates = useMemo(
    () => toilets.filter(isToiletWithCoordinates),
    [toilets],
  );
  const invalidToilets = useMemo(
    () =>
      toilets
        .filter((toilet) => !hasValidCoordinates(toilet))
        .map((toilet) => `${toilet.name} (${toilet.id})`),
    [toilets],
  );
  const invalidToiletsKey = invalidToilets.join("|");

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    onSelectToiletRef.current = onSelectToilet;
  }, [onSelectToilet]);

  useEffect(() => {
    pickingModeRef.current = pickingMode;
  }, [pickingMode]);

  useEffect(() => {
    if (invalidToilets.length === 0) {
      return;
    }

    console.warn(
      "LaLeMe: 以下厕所缺少有效经纬度，真实地图不会显示对应 marker。",
      invalidToilets,
    );
  }, [invalidToilets, invalidToiletsKey]);

  useEffect(() => {
    if (!mapStyleUrl || mapError) {
      return;
    }

    let canceled = false;
    let loaded = false;
    let mapInstance: MapLibreMap | null = null;
    const timeoutId = window.setTimeout(() => {
      if (canceled || loaded) {
        return;
      }

      console.warn("LaLeMe: MapLibre 地图加载超时。");
      setMapError("地图底图加载超时。请检查 NEXT_PUBLIC_MAP_STYLE_URL。");
    }, 10000);

    setMapReady(false);

    void import("maplibre-gl")
      .then((maplibreModule) => {
        if (canceled || !containerRef.current) {
          return;
        }

        mapLibraryRef.current = maplibreModule;
        const maplibregl = maplibreModule;
        mapInstance = new maplibregl.Map({
          container: containerRef.current,
          style: mapStyleUrl,
          center: [center.longitude, center.latitude],
          zoom: defaultZoom,
          attributionControl: {},
        });
        mapRef.current = mapInstance;

        mapInstance.addControl(
          new maplibregl.NavigationControl({ visualizePitch: false }),
          "top-right",
        );

        mapInstance.on("styleimagemissing", (event: { id: string }) => {
          addTransparentMissingStyleImage(mapInstance, event.id);
        });

        const handleToiletClick = (event: MapLayerMouseEvent) => {
          if (pickingModeRef.current) {
            return;
          }

          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string" && id) {
            onSelectToiletRef.current(id);
          }
        };
        const handleToiletEnter = () => {
          if (!pickingModeRef.current) {
            mapInstance?.getCanvas().style.setProperty("cursor", "pointer");
          }
        };
        const handleToiletLeave = () => {
          if (!pickingModeRef.current) {
            mapInstance?.getCanvas().style.removeProperty("cursor");
          }
        };

        mapInstance.on("load", () => {
          if (canceled) {
            return;
          }

          loaded = true;
          window.clearTimeout(timeoutId);
          ensureToiletLayer(mapInstance);
          mapInstance?.on("click", toiletCircleLayerId, handleToiletClick);
          mapInstance?.on("mouseenter", toiletCircleLayerId, handleToiletEnter);
          mapInstance?.on("mouseleave", toiletCircleLayerId, handleToiletLeave);
          setMapReady(true);
          mapInstance?.resize();
          emitViewport(mapInstance, onViewportChangeRef.current, (nextCenter) => {
            lastEmittedCenterRef.current = nextCenter;
          });
        });

        mapInstance.on("moveend", () => {
          emitViewport(mapInstance, onViewportChangeRef.current, (nextCenter) => {
            lastEmittedCenterRef.current = nextCenter;
          });
        });

        mapInstance.on("error", (event) => {
          if (canceled) {
            return;
          }

          window.clearTimeout(timeoutId);
          console.warn("LaLeMe: MapLibre 地图加载失败。", event.error ?? event);
          setMapError("地图底图加载失败。请检查 MapLibre style URL 和 token。");
        });
      })
      .catch((error: unknown) => {
        if (canceled) {
          return;
        }

        window.clearTimeout(timeoutId);
        console.warn("LaLeMe: MapLibre 组件加载失败。", error);
        setMapError("地图组件加载失败。");
      });

    return () => {
      canceled = true;
      window.clearTimeout(timeoutId);
      overlayMarkerRefs.current.forEach((marker) => marker.remove());
      overlayMarkerRefs.current = [];
      mapInstance?.remove();
      if (mapRef.current === mapInstance) {
        mapRef.current = null;
      }
    };
  }, [mapError]);

  useEffect(() => {
    const map = mapRef.current;

    if (!mapReady || !map) {
      return;
    }

    ensureToiletLayer(map);
    const source = map.getSource(toiletSourceId) as GeoJSONSource | undefined;
    source?.setData(
      buildToiletFeatureCollection(toiletsWithCoordinates, selectedToiletId) as Parameters<
        GeoJSONSource["setData"]
      >[0],
    );
  }, [mapReady, selectedToiletId, toiletsWithCoordinates]);

  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = mapLibraryRef.current;

    if (!mapReady || !map || !maplibregl) {
      return;
    }

    overlayMarkerRefs.current.forEach((marker) => marker.remove());
    const nextMarkers: Marker[] = [];

    if (pickingMode && pickedCoordinates) {
      const pickedElement = document.createElement("div");
      pickedElement.className = styles.pickedMarker;
      pickedElement.title = "已选择的位置";
      const pickedMarker = new maplibregl.Marker({ element: pickedElement, anchor: "center" })
        .setLngLat([pickedCoordinates.longitude, pickedCoordinates.latitude])
        .addTo(map);
      nextMarkers.push(pickedMarker);
    }

    if (userLocation) {
      const userElement = document.createElement("div");
      userElement.className = styles.userLocationMarker;
      userElement.title = "你当前的位置";
      userElement.setAttribute("role", "img");
      userElement.setAttribute("aria-label", "你当前的位置");
      const userMarker = new maplibregl.Marker({ element: userElement, anchor: "center" })
        .setLngLat([userLocation.longitude, userLocation.latitude])
        .addTo(map);
      nextMarkers.push(userMarker);
    }

    overlayMarkerRefs.current = nextMarkers;

    return () => {
      nextMarkers.forEach((marker) => marker.remove());
      overlayMarkerRefs.current = overlayMarkerRefs.current.filter(
        (marker) => !nextMarkers.includes(marker),
      );
    };
  }, [mapReady, pickedCoordinates, pickingMode, userLocation]);

  useEffect(() => {
    const map = mapRef.current;

    if (!mapReady || !map) {
      return;
    }

    const previousCenterKey = previousCenterKeyRef.current;
    const centerChanged = previousCenterKey !== centerKey;
    const lastEmittedCenter = lastEmittedCenterRef.current;
    const centerCameFromUserMapMove =
      previousCenterKey && centerChanged && lastEmittedCenter
        ? coordinatesAlmostEqual(center, lastEmittedCenter)
        : false;
    const pendingFocusRequestForCenter =
      focusRequest &&
      previousFocusRequestIdRef.current !== focusRequest.id &&
      coordinatesAlmostEqual(center, focusRequest.center);

    previousCenterKeyRef.current = centerKey;

    if (!centerChanged || centerCameFromUserMapMove || pendingFocusRequestForCenter) {
      return;
    }

    map.flyTo({
      center: [center.longitude, center.latitude],
      duration: 550,
      essential: true,
    });
  }, [center, centerKey, focusRequest, mapReady]);

  useEffect(() => {
    const map = mapRef.current;

    if (!mapReady || !map || !focusRequest) {
      return;
    }

    if (previousFocusRequestIdRef.current === focusRequest.id) {
      return;
    }

    previousFocusRequestIdRef.current = focusRequest.id;
    previousCenterKeyRef.current = coordinatesKey(focusRequest.center);

    map.flyTo({
      center: [focusRequest.center.longitude, focusRequest.center.latitude],
      ...(typeof focusRequest.zoom === "number" ? { zoom: focusRequest.zoom } : {}),
      duration: 550,
      essential: true,
    });
  }, [focusRequest, mapReady]);

  useEffect(() => {
    const map = mapRef.current;

    if (!mapReady || !map || !pickingMode || !onPickCoordinates) {
      return;
    }

    const handleClick = (event: MapMouseEvent) => {
      onPickCoordinates({
        coordinates: {
          latitude: roundCoordinate(event.lngLat.lat),
          longitude: roundCoordinate(event.lngLat.lng),
        },
        placeName: getNearestMapFeatureName(map, event),
      });
    };

    map.getCanvas().style.cursor = "crosshair";
    map.on("click", handleClick);

    return () => {
      map.off("click", handleClick);
      map.getCanvas().style.cursor = "";
    };
  }, [mapReady, onPickCoordinates, pickingMode]);

  return (
    <div className={[styles.mapFrame, compact ? styles.mapFrameCompact : ""].join(" ")}>
      <div ref={containerRef} className={styles.mapContainer} aria-label={`${mapLabel} 真实地图`} />

      {mapError ? <div className={styles.mapError}>{mapError}</div> : null}
      {!mapError && !mapReady ? <div className={styles.mapOverlay}>地图加载中...</div> : null}

      {pickingMode && mapReady ? <div className={styles.pickHint}>点击地图选择厕所经纬度</div> : null}
    </div>
  );
}

function emitViewport(
  map: MapLibreMap | null,
  onViewportChange?: (viewport: MapViewport) => void,
  onEmitCenter?: (center: Coordinates) => void,
) {
  if (!map || !onViewportChange) {
    return;
  }

  const center = map.getCenter();
  const bounds = map.getBounds();
  const viewport = {
    center: {
      latitude: roundCoordinate(center.lat),
      longitude: roundCoordinate(center.lng),
    },
    bounds: {
      south: roundCoordinate(bounds.getSouth()),
      west: roundCoordinate(bounds.getWest()),
      north: roundCoordinate(bounds.getNorth()),
      east: roundCoordinate(bounds.getEast()),
    },
    zoom: roundZoom(map.getZoom()),
  };

  onEmitCenter?.(viewport.center);
  onViewportChange(viewport);
}

function ensureToiletLayer(map: MapLibreMap | null) {
  if (!map || map.getSource(toiletSourceId)) {
    return;
  }

  map.addSource(toiletSourceId, {
    type: "geojson",
    data: buildToiletFeatureCollection([], ""),
  });

  map.addLayer({
    id: toiletCircleLayerId,
    type: "circle",
    source: toiletSourceId,
    layout: {
      "circle-sort-key": ["case", ["==", ["get", "selected"], true], 2, 1],
    },
    paint: {
      "circle-color": [
        "match",
        ["get", "status"],
        "closed",
        "#b94b48",
        "help",
        "#2f6f9f",
        "noPaper",
        "#d66a2c",
        "unconfirmed",
        "#6b7c75",
        "#256d5a",
      ],
      "circle-radius": ["case", ["==", ["get", "selected"], true], 8, 5],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 3, 1.5],
      "circle-opacity": 0.92,
    },
  });
}

function buildToiletFeatureCollection(
  toilets: ToiletWithCoordinates[],
  selectedToiletId: string,
): ToiletFeatureCollection {
  return {
    type: "FeatureCollection",
    features: toilets.map((toilet) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [toilet.longitude, toilet.latitude],
      },
      properties: {
        id: toilet.id,
        name: toilet.name,
        status: getMarkerStatus(toilet),
        selected: toilet.id === selectedToiletId,
      },
    })),
  };
}

function isToiletWithCoordinates(toilet: ToiletSummary): toilet is ToiletWithCoordinates {
  return hasValidCoordinates(toilet);
}

function getNearestMapFeatureName(map: MapLibreMap, event: MapMouseEvent) {
  const radius = 28;
  const features = map.queryRenderedFeatures(
    [
      [event.point.x - radius, event.point.y - radius],
      [event.point.x + radius, event.point.y + radius],
    ],
  );

  return pickBestFeatureName(features);
}

function pickBestFeatureName(features: MapGeoJSONFeature[]) {
  const candidates = features
    .map((feature, index) => ({
      name: getFeatureName(feature),
      score: scoreMapFeature(feature, index),
    }))
    .filter((candidate): candidate is { name: string; score: number } =>
      Boolean(candidate.name),
    )
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.name ?? null;
}

function getFeatureName(feature: MapGeoJSONFeature) {
  const properties = feature.properties ?? {};
  const preferredKeys = [
    "name:zh-Hans",
    "name:zh-Hant",
    "name:zh",
    "name_zh",
    "name",
    "name:en",
    "name_en",
    "name:latin",
    "name_latin",
    "ref",
  ];

  for (const key of preferredKeys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function scoreMapFeature(feature: MapGeoJSONFeature, index: number) {
  const layerId = feature.layer.id.toLowerCase();
  const sourceLayer = feature.sourceLayer?.toLowerCase() ?? "";
  const properties = feature.properties ?? {};
  const classValue = String(properties.class ?? properties.subclass ?? "").toLowerCase();
  let score = 100 - index;

  if (layerId.includes("poi") || sourceLayer.includes("poi")) {
    score += 90;
  }

  if (layerId.includes("building") || sourceLayer.includes("building")) {
    score += 75;
  }

  if (layerId.includes("transport") || sourceLayer.includes("transport")) {
    score += 58;
  }

  if (layerId.includes("road") || sourceLayer.includes("road") || classValue.includes("road")) {
    score += 45;
  }

  if (layerId.includes("place") || sourceLayer.includes("place")) {
    score += 25;
  }

  if (layerId.includes("label") || layerId.includes("name")) {
    score += 18;
  }

  return score;
}

function getMarkerStatus(toilet: ToiletSummary): MarkerStatus {
  if (!toilet.isOpen) {
    return "closed";
  }

  if (toilet.activeHelpRequestCount > 0) {
    return "help";
  }

  if (!toilet.hasPaper) {
    return "noPaper";
  }

  if (toilet.lastUpdated === "未确认") {
    return "unconfirmed";
  }

  return "open";
}

function coordinatesKey(coordinates: Coordinates) {
  return `${coordinates.latitude}:${coordinates.longitude}`;
}

function coordinatesAlmostEqual(left: Coordinates, right: Coordinates) {
  return (
    Math.abs(left.latitude - right.latitude) < 0.000001 &&
    Math.abs(left.longitude - right.longitude) < 0.000001
  );
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(6));
}

function roundZoom(value: number) {
  return Number(value.toFixed(2));
}

function addTransparentMissingStyleImage(map: MapLibreMap | null, imageId: string) {
  if (!map || !imageId || map.hasImage(imageId)) {
    return;
  }

  try {
    map.addImage(imageId, {
      width: 1,
      height: 1,
      data: new Uint8Array([0, 0, 0, 0]),
    });
  } catch {
    // Some styles can request the same sprite id more than once during reloads.
  }
}
