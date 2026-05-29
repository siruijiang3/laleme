"use client";

import {
  Building2,
  CheckCircle2,
  CircleAlert,
  ClipboardPenLine,
  Code2,
  Clock3,
  Droplets,
  Flag,
  Layers,
  MapPin,
  MessageSquare,
  Navigation,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Star,
} from "lucide-react";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getInitialDataMessage,
  getInitialDataSource,
  loadNearbyHelpRequests,
  loadToiletDetail,
  loadViewportToilets,
  createToilet,
  resolvePaperRequest,
  savePaperRequest,
  saveToiletProfile,
  saveReport,
  saveReview,
  saveStatusUpdate,
  type LoadViewportToiletsParams,
} from "../lib/toilet-repository";
import type {
  Coordinates,
  DataSource,
  MapBounds,
  NearbyHelpRequest,
  NewToiletForm,
  Toilet,
  ToiletSummary,
} from "../lib/domain";
import { hasValidCoordinates, parseCoordinate } from "../lib/domain";
import { getPublicRuntimeConfigIssue, readDefaultMapCenter } from "../lib/data-config";
import styles from "./page.module.css";
import {
  type MapFocusRequest,
  type MapLocationPick,
  type MapViewport,
  ToiletMap,
} from "./toilet-map";

const defaultMapCenter = readDefaultMapCenter();

const initialForm: NewToiletForm = {
  name: "",
  location: "",
  floor: "",
  isOpen: true,
  hasPaper: true,
  isClean: true,
  accessibility: false,
  latitude: "",
  longitude: "",
};

const initialToilets: ToiletSummary[] = [];
const listDisplayLimit = 50;
const viewportRefreshDelayMs = 650;
const locationFocusZoom = 15.5;

type NearbyToilet<T extends ToiletSummary = ToiletSummary> = {
  toilet: T;
  distanceMeters: number | null;
};

export default function Home() {
  const [toilets, setToilets] = useState<ToiletSummary[]>(initialToilets);
  const [selectedToiletId, setSelectedToiletId] = useState("");
  const [selectedToilet, setSelectedToilet] = useState<Toilet | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [view, setView] = useState<"map" | "contribute">("map");
  const [dataSource, setDataSource] = useState<DataSource>(getInitialDataSource());
  const [dataMessage, setDataMessage] = useState(getInitialDataMessage());
  const [nearbyHelpRequests, setNearbyHelpRequests] = useState<NearbyHelpRequest[]>([]);
  const [isNearbyHelpLoading, setIsNearbyHelpLoading] = useState(false);
  const [isStatusSaving, setIsStatusSaving] = useState(false);
  const [isViewportTruncated, setIsViewportTruncated] = useState(false);
  const [hasLoadedToilets, setHasLoadedToilets] = useState(false);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState(
    "正在尝试获取当前位置，用于展示附近厕所。",
  );
  const [mapCenter, setMapCenter] = useState<Coordinates>(defaultMapCenter);
  const [mapFocusRequest, setMapFocusRequest] = useState<MapFocusRequest | null>(null);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [reviewBody, setReviewBody] = useState("");
  const [reviewScore, setReviewScore] = useState(5);
  const [profileForm, setProfileForm] = useState({ name: "", location: "", floor: "" });
  const [profileMessage, setProfileMessage] = useState("");
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [helpBody, setHelpBody] = useState("这里没纸了，需要帮助。");
  const [reportReason, setReportReason] = useState("信息不准确");
  const [reportDetails, setReportDetails] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [form, setForm] = useState<NewToiletForm>(initialForm);
  const [formMessage, setFormMessage] = useState("");
  const [autoPickedLocation, setAutoPickedLocation] = useState("");
  const mapFocusRequestIdRef = useRef(0);
  const viewportRefreshTimerRef = useRef<number | null>(null);
  const viewportAbortRef = useRef<AbortController | null>(null);
  const viewportRequestIdRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);
  const nearbyHelpAbortRef = useRef<AbortController | null>(null);
  const nearbyHelpOriginRef = useRef<Coordinates>(defaultMapCenter);
  const publicConfigIssue = getPublicRuntimeConfigIssue();

  const focusMap = useCallback((center: Coordinates, zoom?: number) => {
    setMapCenter(center);
    setMapFocusRequest({
      id: ++mapFocusRequestIdRef.current,
      center,
      ...(typeof zoom === "number" ? { zoom } : {}),
    });
  }, []);

  const refreshViewport = useCallback(async (params: LoadViewportToiletsParams = {}) => {
    viewportAbortRef.current?.abort();
    const requestId = viewportRequestIdRef.current + 1;
    viewportRequestIdRef.current = requestId;
    const controller = new AbortController();
    viewportAbortRef.current = controller;
    const nextParams: LoadViewportToiletsParams = {
      radiusKm: 3,
      center: params.center ?? mapCenter,
      bounds: params.bounds ?? (params.center ? undefined : mapBounds ?? undefined),
      ...params,
    };

    const result = await loadViewportToilets(nextParams, controller.signal);

    if (requestId !== viewportRequestIdRef.current || controller.signal.aborted) {
      return result;
    }

    setToilets(result.toilets);
    setDataSource(result.source);
    setDataMessage(result.message);
    setIsViewportTruncated(result.truncated);
    setHasLoadedToilets(true);

    return result;
  }, [mapBounds, mapCenter]);

  const refreshSelectedDetail = useCallback(async (toiletId: string) => {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    setIsDetailLoading(true);

    const toilet = await loadToiletDetail(toiletId, controller.signal);
    if (controller.signal.aborted) {
      return null;
    }

    setSelectedToilet(toilet);
    setIsDetailLoading(false);
    return toilet;
  }, []);

  const refreshNearbyHelpRequests = useCallback(async (origin?: Coordinates) => {
    nearbyHelpAbortRef.current?.abort();
    const controller = new AbortController();
    nearbyHelpAbortRef.current = controller;
    const nextOrigin = origin ?? nearbyHelpOriginRef.current;
    nearbyHelpOriginRef.current = nextOrigin;
    setIsNearbyHelpLoading(true);

    const helpRequests = await loadNearbyHelpRequests(nextOrigin, controller.signal);
    if (controller.signal.aborted) {
      return helpRequests;
    }

    setNearbyHelpRequests(helpRequests);
    setIsNearbyHelpLoading(false);
    return helpRequests;
  }, []);

  useEffect(() => {
    let isActive = true;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch(() => undefined);
    }

    const urlSelection = readSelectionFromUrl();

    const initialLoad = async () => {
      let initialCenter = defaultMapCenter;

      if (urlSelection) {
        const detail = await loadToiletDetail(urlSelection);
        if (!isActive) {
          return;
        }

        setSelectedToilet(detail);
        const detailCoordinates = getToiletCoordinates(detail);
        if (detailCoordinates) {
          initialCenter = detailCoordinates;
          setMapCenter(detailCoordinates);
        }
      }

      const result = await loadViewportToilets({
        center: initialCenter,
        radiusKm: 3,
      });

      if (!isActive) {
        return;
      }

      setToilets(result.toilets);
      setDataSource(result.source);
      setDataMessage(result.message);
      setIsViewportTruncated(result.truncated);
      setHasLoadedToilets(true);
      setSelectedToiletId(urlSelection ?? result.toilets[0]?.id ?? "");
      void refreshNearbyHelpRequests(defaultMapCenter);
    };

    void initialLoad();

    return () => {
      isActive = false;
      viewportAbortRef.current?.abort();
      detailAbortRef.current?.abort();
      nearbyHelpAbortRef.current?.abort();
    };
  }, [refreshNearbyHelpRequests]);

  useEffect(() => {
    if (!hasLoadedToilets) {
      return;
    }

    void requestUserLocation();
  }, [hasLoadedToilets]);

  useEffect(() => {
    if (!selectedToiletId) {
      detailAbortRef.current?.abort();
      setSelectedToilet(null);
      setIsDetailLoading(false);
      return;
    }

    if (selectedToilet?.id === selectedToiletId) {
      return;
    }

    void refreshSelectedDetail(selectedToiletId);
  }, [refreshSelectedDetail, selectedToilet?.id, selectedToiletId]);

  useEffect(() => {
    if (!selectedToilet) {
      setProfileForm({ name: "", location: "", floor: "" });
      setProfileMessage("");
      return;
    }

    setProfileForm({
      name: selectedToilet.name,
      location: selectedToilet.location,
      floor: selectedToilet.floor,
    });
    setProfileMessage("");
  }, [selectedToilet?.id]);

  const nearbyOrigin = userLocation ?? mapCenter;
  const nearbyToiletEntries = useMemo(
    () => sortToiletsByDistance(toilets, nearbyOrigin),
    [nearbyOrigin, toilets],
  );
  const nearbyToilets = useMemo(
    () => nearbyToiletEntries.map((entry) => entry.toilet),
    [nearbyToiletEntries],
  );
  const visibleToiletEntries = useMemo(
    () => nearbyToiletEntries.slice(0, listDisplayLimit),
    [nearbyToiletEntries],
  );
  const listLimitMessage =
    nearbyToiletEntries.length > listDisplayLimit
      ? `列表仅显示最近 ${listDisplayLimit} 个。`
      : "";

  const selectedSummary = useMemo(() => {
    return (
      toilets.find((toilet) => toilet.id === selectedToiletId) ??
      nearbyToilets[0] ??
      null
    );
  }, [nearbyToilets, selectedToiletId, toilets]);

  const selectedToiletCoordinates = useMemo(
    () => getToiletCoordinates(selectedToilet ?? selectedSummary),
    [selectedSummary, selectedToilet],
  );
  const mainMapCenter = mapCenter;

  const formCoordinates = useMemo(() => readFormCoordinates(form), [form]);
  const visibleMapCenter = selectedToiletCoordinates ?? mainMapCenter;
  const formMapCenter = formCoordinates ?? userLocation ?? visibleMapCenter;
  const formMapToilets = useMemo(
    () => sortToiletsByDistance(toilets, formMapCenter).map((entry) => entry.toilet),
    [formMapCenter, toilets],
  );

  useEffect(() => {
    if (typeof window === "undefined" || view !== "map" || !hasLoadedToilets || !selectedToiletId) {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("area");
    url.searchParams.set("toilet", selectedToiletId);

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [hasLoadedToilets, selectedToiletId, view]);

  const selectToilet = useCallback((toiletId: string) => {
    setSelectedToiletId(toiletId);
    setSelectedToilet((current) => (current?.id === toiletId ? current : null));
    setShareMessage("");
  }, []);

  const selectToiletFromList = useCallback((toilet: ToiletSummary) => {
    selectToilet(toilet.id);
    const coordinates = getToiletCoordinates(toilet);
    if (coordinates) {
      focusMap(coordinates);
    }
  }, [focusMap, selectToilet]);

  const handleViewportChange = useCallback((viewport: MapViewport) => {
    setMapCenter(viewport.center);
    setMapBounds(viewport.bounds);

    if (viewportRefreshTimerRef.current) {
      window.clearTimeout(viewportRefreshTimerRef.current);
    }

    viewportRefreshTimerRef.current = window.setTimeout(() => {
      void refreshViewport({
        bounds: viewport.bounds,
        center: viewport.center,
      });
    }, viewportRefreshDelayMs);
  }, [refreshViewport]);

  const pickCoordinates = useCallback((pick: MapLocationPick) => {
    const placeName = pick.placeName?.trim() ?? "";
    setForm((current) => ({
      ...current,
      latitude: formatCoordinate(pick.coordinates.latitude),
      longitude: formatCoordinate(pick.coordinates.longitude),
      location:
        placeName && (!current.location.trim() || current.location === autoPickedLocation)
          ? placeName
          : current.location,
    }));
    setAutoPickedLocation(placeName);
    setFormMessage(
      placeName
        ? `已记录地图坐标，并填入附近地名：${placeName}。`
        : "已记录地图坐标，未识别到附近地名，可手动填写。",
    );
  }, [autoPickedLocation]);

  async function submitProfileUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedToilet || isProfileSaving) {
      return;
    }

    setIsProfileSaving(true);
    setProfileMessage("正在保存名称和位置修正...");

    try {
      const saved = await saveToiletProfile(selectedToilet.id, profileForm);
      if (!saved) {
        setProfileMessage("保存失败，页面未创建本地假修改。请稍后再试。");
        return;
      }

      await refreshViewport();
      const refreshedToilet = await refreshSelectedDetail(selectedToilet.id);
      if (refreshedToilet) {
        setProfileForm({
          name: refreshedToilet.name,
          location: refreshedToilet.location,
          floor: refreshedToilet.floor,
        });
      }
      setProfileMessage("已保存。后续 OSM 同步不会覆盖这次社区修正。");
    } finally {
      setIsProfileSaving(false);
    }
  }

  async function patchSelectedToilet(patch: Partial<Toilet>) {
    if (!selectedToilet || isStatusSaving) {
      return;
    }

    const nextToilet = {
      ...selectedToilet,
      ...patch,
    };

    const hasStatusPatch = "isOpen" in patch || "hasPaper" in patch || "isClean" in patch;
    const hasAccessibilityPatch = "accessibility" in patch;

    if (hasStatusPatch || hasAccessibilityPatch) {
      setIsStatusSaving(true);
      try {
        const saved = await saveStatusUpdate(selectedToilet.id, {
          ...(hasStatusPatch
            ? {
                isOpen: nextToilet.isOpen,
                hasPaper: nextToilet.hasPaper,
                isClean: nextToilet.isClean,
              }
            : {}),
          ...(hasAccessibilityPatch ? { accessibility: nextToilet.accessibility } : {}),
        });

        if (!saved) {
          setDataMessage("状态写入生产数据库失败，页面未创建本地假状态。请稍后再试。");
          return;
        }

        await refreshViewport();
        await refreshSelectedDetail(selectedToilet.id);
      } finally {
        setIsStatusSaving(false);
      }
    }
  }

  function selectNearbyHelp(help: NearbyHelpRequest) {
    setSelectedToilet(null);
    setSelectedToiletId(help.toiletId);

    if (help.latitude !== null && help.longitude !== null) {
      const coordinates = { latitude: help.latitude, longitude: help.longitude };
      focusMap(coordinates);
      void refreshViewport({
        center: coordinates,
        radiusKm: 3,
      });
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedBody = reviewBody.trim();

    if (!trimmedBody || !selectedToilet) {
      return;
    }

    const saved = await saveReview(selectedToilet.id, reviewScore, trimmedBody);
    if (!saved) {
      setDataMessage("评论写入生产数据库失败，页面未添加本地假评论。请稍后再试。");
      return;
    }

    setReviewBody("");
    setReviewScore(5);
    await refreshViewport();
    await refreshSelectedDetail(selectedToilet.id);
  }

  async function createHelpRequest() {
    const trimmedBody = helpBody.trim();

    if (!trimmedBody || !selectedToilet) {
      return;
    }

    const savedHelp = await savePaperRequest(selectedToilet.id, trimmedBody);
    if (!savedHelp) {
      setDataMessage("求助写入生产数据库失败，页面未添加本地假求助。请稍后再试。");
      return;
    }

    setHelpBody("这里没纸了，需要帮助。");
    await refreshViewport();
    await refreshSelectedDetail(selectedToilet.id);
    await refreshNearbyHelpRequests();
  }

  async function resolveHelp(helpId: string) {
    const saved = await resolvePaperRequest(helpId);
    if (!saved) {
      setDataMessage("求助状态写入生产数据库失败，页面未更新本地假状态。请稍后再试。");
      return;
    }

    if (selectedToilet) {
      await refreshViewport();
      await refreshSelectedDetail(selectedToilet.id);
    }
    await refreshNearbyHelpRequests();
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedToilet) {
      setReportMessage("当前没有可举报的厕所。");
      return;
    }

    const reason = reportReason.trim();
    const details = reportDetails.trim();

    if (!reason) {
      setReportMessage("请先选择或填写举报原因。");
      return;
    }

    const saved = await saveReport({
      toiletId: selectedToilet.id,
      reason,
      details: details || undefined,
    });

    if (saved) {
      setReportMessage("举报已写入生产数据库。");
      setReportDetails("");
      return;
    }

    setReportMessage("举报写入失败，请稍后再试。");
  }

  function useCurrentMapCenter() {
    pickCoordinates({ coordinates: visibleMapCenter, placeName: null });
    setFormMessage("已使用当前地图中心坐标，可按实际位置手动微调。");
  }

  async function requestUserLocation() {
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setIsLocating(false);
      setLocationMessage(getInsecureGeolocationMessage());
      return;
    }

    if (!("geolocation" in navigator)) {
      setIsLocating(false);
      setLocationMessage("当前浏览器不支持定位，已使用默认地图范围。");
      return;
    }

    const permissionState = await readGeolocationPermissionState();
    if (permissionState === "denied") {
      setIsLocating(false);
      setLocationMessage("浏览器定位权限仍是拒绝状态。请在地址栏权限里允许定位，然后点“重新定位”。");
      return;
    }

    setIsLocating(true);
    setLocationMessage("正在获取当前位置...");

    const handleSuccess = (position: GeolocationPosition) => {
      const coordinates = {
        latitude: roundCoordinate(position.coords.latitude),
        longitude: roundCoordinate(position.coords.longitude),
      };
      setUserLocation(coordinates);
      focusMap(coordinates, locationFocusZoom);
      setIsLocating(false);
      setLocationMessage("已使用当前位置排序，并在地图上标出你的位置。");

      void refreshNearbyHelpRequests(coordinates);
      void refreshViewport({ center: coordinates, radiusKm: 3 });
    };

    const handleFailure = (error: GeolocationPositionError) => {
      setIsLocating(false);
      setLocationMessage(getGeolocationFailureMessage(error, permissionState));
    };

    const requestPosition = (
      options: PositionOptions,
      shouldRetryWithHighAccuracy: boolean,
    ) => {
      navigator.geolocation.getCurrentPosition(
        handleSuccess,
        (error) => {
          const canRetry =
            shouldRetryWithHighAccuracy &&
            (error.code === error.POSITION_UNAVAILABLE || error.code === error.TIMEOUT);

          if (canRetry) {
            setLocationMessage("首次定位失败，正在尝试更精确定位...");
            requestPosition(
              {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 15000,
              },
              false,
            );
            return;
          }

          handleFailure(error);
        },
        options,
      );
    };

    requestPosition(
      {
        enableHighAccuracy: false,
        maximumAge: 5 * 60 * 1000,
        timeout: 8000,
      },
      true,
    );
  }

  async function copyShareLink() {
    if (!selectedToilet) {
      setShareMessage("当前没有可分享的厕所。");
      return;
    }

    const url = buildShareUrl(selectedToilet);

    try {
      await navigator.clipboard.writeText(url);
      setShareMessage("已复制这个厕所的分享链接。");
    } catch {
      setShareMessage(`无法自动复制，可手动复制：${url}`);
    }
  }

  async function submitNewToilet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const location = form.location.trim();
    const name = form.name.trim() || buildDefaultToiletName(location, form.floor);

    if (!location) {
      setFormMessage("请先从地图选择位置，或手动填写所属地点。");
      return;
    }

    if (!formCoordinates) {
      setFormMessage("新增厕所必须包含有效经纬度。请点击真实地图选点，或手动填写纬度和经度。");
      return;
    }

    const formForSubmit = {
      ...form,
      name,
      location,
      latitude: formatCoordinate(formCoordinates.latitude),
      longitude: formatCoordinate(formCoordinates.longitude),
    };
    const toiletId = await createToilet(formForSubmit);

    if (!toiletId) {
      setFormMessage("新增厕所写入生产数据库失败，未创建本地假点位。");
      return;
    }

    setView("map");
    setForm(initialForm);
    setAutoPickedLocation("");
    setFormMessage("");
    focusMap(formCoordinates);
    await refreshViewport({
      center: formCoordinates,
      radiusKm: 3,
    });
    setSelectedToilet(null);
    setSelectedToiletId(toiletId);
  }

  return (
    <main className={styles.appShell}>
      <header className={styles.topbar}>
        <div className={styles.brandBlock}>
          <span className={styles.brandMark} aria-hidden="true">
            <MapPin size={21} strokeWidth={2.5} />
          </span>
          <div>
            <p className={styles.brandName}>LaLeMe / 拉了么</p>
            <p className={styles.brandSubline} title={dataMessage}>
              开放厕所地图 · {dataSourceLabel(dataSource)}
            </p>
          </div>
        </div>

        <nav className={styles.navActions} aria-label="主导航">
          <button
            className={view === "map" ? styles.primaryButton : styles.secondaryButton}
            type="button"
            onClick={() => setView("map")}
          >
            <Navigation size={17} />
            地图
          </button>
          <button
            className={view === "contribute" ? styles.primaryButton : styles.secondaryButton}
            type="button"
            onClick={() => setView("contribute")}
          >
            <Plus size={17} />
            贡献新厕所
          </button>
          <a
            className={styles.secondaryButton}
            href="https://github.com/siruijiang3/laleme"
            target="_blank"
            rel="noreferrer"
          >
            <Code2 size={17} />
            源码
          </a>
        </nav>
      </header>

      {publicConfigIssue ? (
        <section className={styles.configBanner} aria-label="生产配置错误">
          <strong>生产配置未就绪</strong>
          <span>{publicConfigIssue}</span>
        </section>
      ) : null}

      {view === "map" ? (
        <section className={styles.mapLayout} aria-label="厕所地图和详情">
          <div className={styles.mapWorkspace}>
            <div className={styles.workspaceHeader}>
              <div>
                <h1>附近厕所</h1>
                <p>按当前位置或当前地图范围读取生产数据库点位。</p>
              </div>
              <div className={styles.locationTools} aria-label="当前位置">
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => void requestUserLocation()}
                >
                  <Navigation size={17} />
                  {isLocating ? "定位中..." : userLocation ? "重新定位" : "使用当前位置"}
                </button>
                <p>{locationMessage}</p>
              </div>
            </div>

            <div className={styles.mapCanvas}>
              <div className={styles.mapMeta}>
                <span>
                  <Layers size={16} />
                  当前地图范围
                </span>
                <span>
                  <MapPin size={16} />
                  {nearbyToilets.length} 个点位
                  {isViewportTruncated ? "（部分）" : ""}
                </span>
              </div>

              <ToiletMap
                label="当前地图范围"
                center={mainMapCenter}
                selectedToiletId={selectedToiletId}
                toilets={nearbyToilets}
                userLocation={userLocation}
                focusRequest={mapFocusRequest}
                onSelectToilet={selectToilet}
                onViewportChange={handleViewportChange}
              />

              <div className={styles.mapLegend} aria-label="状态图例">
                <span>
                  <span className={styles.legendDotOpen} />
                  正常开放
                </span>
                <span>
                  <span className={styles.legendDotNoPaper} />
                  没纸
                </span>
                <span>
                  <span className={styles.legendDotClosed} />
                  关闭
                </span>
                <span>
                  <span className={styles.legendDotUnknown} />
                  未确认
                </span>
                <span>
                  <span className={styles.legendDotHelp} />
                  正在求助
                </span>
                <span>
                  <span className={styles.legendDotCurrent} />
                  当前位置
                </span>
              </div>
            </div>

            <div className={styles.toiletList} aria-label="附近厕所列表">
              {visibleToiletEntries.length > 0 ? (
                <>
                {visibleToiletEntries.map(({ toilet, distanceMeters }) => (
                  <button
                    key={toilet.id}
                    className={
                      selectedToiletId === toilet.id ? styles.toiletRowActive : styles.toiletRow
                    }
                    type="button"
                    onClick={() => selectToiletFromList(toilet)}
                  >
                    <span className={styles.rowTitle}>{toilet.name}</span>
                    <span className={styles.rowMeta}>
                      {toiletRowMeta(toilet, distanceMeters, Boolean(userLocation))}
                    </span>
                  </button>
                ))}
                {listLimitMessage ? (
                  <p className={styles.listLimitNotice}>{listLimitMessage}</p>
                ) : null}
                </>
              ) : dataSource === "error" ? (
                <p className={styles.emptyListState}>{dataMessage}</p>
              ) : null}
            </div>
          </div>

          <aside className={styles.detailPanel} aria-label="厕所详情">
            {isDetailLoading && !selectedToilet ? (
              <div className={styles.emptyDetailState}>
                <h2>{selectedSummary?.name ?? "正在读取厕所详情"}</h2>
                <p>正在按需加载评论、求助和完整状态。</p>
              </div>
            ) : selectedToilet ? (
              <>
                <div className={styles.detailHeader}>
                  <div>
                    <p className={styles.areaLine}>{selectedToilet.regionName}</p>
                    <h2>{selectedToilet.name}</h2>
                  </div>
                  <div className={styles.detailHeaderActions}>
                    <span className={styles.ratingBadge}>
                      <Star size={16} fill="currentColor" />
                      {selectedToilet.rating}
                    </span>
                    <button className={styles.iconTextButton} type="button" onClick={copyShareLink}>
                      <Share2 size={16} />
                      分享
                    </button>
                  </div>
                </div>
                {shareMessage ? <p className={styles.shareMessage}>{shareMessage}</p> : null}

                <div className={styles.locationStack}>
                  <p>
                    <Building2 size={17} />
                    {selectedToilet.location}
                  </p>
                  <p>
                    <Layers size={17} />
                    {selectedToilet.floor}
                  </p>
                  <p>
                    <MapPin size={17} />
                    {formatToiletCoordinates(selectedToilet)}
                  </p>
                  <p>
                    <Clock3 size={17} />
                    {selectedToilet.lastUpdated}更新
                  </p>
                </div>

                {selectedToilet.source === "osm" ? (
                  <p className={styles.sourceNotice}>
                    开放数据底座：
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                      OpenStreetMap
                    </a>
                    （ODbL）。厕所状态、评分、评论和求助仍来自拉了么用户贡献。
                    {selectedToilet.sourceStatus === "needs_verification"
                      ? " 该 OSM 点位后续同步未再次发现，建议现场确认。"
                      : null}
                  </p>
                ) : null}

                <section className={styles.profileBox} aria-label="编辑名称和位置">
                  <div className={styles.sectionTitle}>
                    <ClipboardPenLine size={18} />
                    <h3>编辑名称和位置</h3>
                  </div>
                  <p className={styles.profileHint}>
                    {selectedToilet.source === "osm"
                      ? "OSM 原始数据会持续同步；你提交的修正会作为 LaLeMe 社区数据优先显示。"
                      : "你提交的修正会作为 LaLeMe 社区数据优先显示。"}
                  </p>
                  <form className={styles.profileForm} onSubmit={submitProfileUpdate}>
                    <label>
                      名称
                      <input
                        value={profileForm.name}
                        maxLength={80}
                        disabled={isProfileSaving}
                        onChange={(event) =>
                          setProfileForm((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      地点
                      <input
                        value={profileForm.location}
                        maxLength={120}
                        disabled={isProfileSaving}
                        onChange={(event) =>
                          setProfileForm((current) => ({
                            ...current,
                            location: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      楼层 / 方位
                      <input
                        value={profileForm.floor}
                        maxLength={80}
                        disabled={isProfileSaving}
                        onChange={(event) =>
                          setProfileForm((current) => ({
                            ...current,
                            floor: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <button className={styles.primaryButton} type="submit" disabled={isProfileSaving}>
                      保存
                    </button>
                  </form>
                  {profileMessage ? (
                    <p className={styles.profileMessage}>{profileMessage}</p>
                  ) : null}
                </section>

                <div className={styles.statusGrid}>
                  <StatusTile
                    label="开放"
                    active={selectedToilet.isOpen}
                    activeText="开放中"
                    inactiveText="未开放"
                  />
                  <StatusTile
                    label="厕纸"
                    active={selectedToilet.hasPaper}
                    activeText="有纸"
                    inactiveText="没纸"
                  />
                  <StatusTile
                    label="清洁"
                    active={selectedToilet.isClean}
                    activeText="干净"
                    inactiveText="待清洁"
                  />
                  <StatusTile
                    label="无障碍"
                    active={selectedToilet.accessibility}
                    activeText="支持"
                    inactiveText="未确认"
                  />
                </div>

                <div className={styles.quickActions} aria-label="快速状态更新">
                  <button
                    className={styles.warningButton}
                    type="button"
                    disabled={isStatusSaving}
                    onClick={() => patchSelectedToilet({ hasPaper: false })}
                  >
                    <Droplets size={17} />
                    没纸了
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={isStatusSaving}
                    onClick={() => patchSelectedToilet({ isOpen: !selectedToilet.isOpen })}
                  >
                    <RefreshCw size={17} />
                    更新开放
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={isStatusSaving}
                    onClick={() => patchSelectedToilet({ isClean: !selectedToilet.isClean })}
                  >
                    <ClipboardPenLine size={17} />
                    更新清洁
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={isStatusSaving}
                    onClick={() => patchSelectedToilet({ accessibility: !selectedToilet.accessibility })}
                  >
                    <CheckCircle2 size={17} />
                    更新无障碍
                  </button>
                </div>

                <div className={styles.inlineForm} aria-label="状态修改">
                  <label>
                    开放状态
                    <select
                      value={selectedToilet.isOpen ? "open" : "closed"}
                      disabled={isStatusSaving}
                      onChange={(event) =>
                        patchSelectedToilet({ isOpen: event.target.value === "open" })
                      }
                    >
                      <option value="open">开放</option>
                      <option value="closed">未开放</option>
                    </select>
                  </label>
                  <label>
                    厕纸状态
                    <select
                      value={selectedToilet.hasPaper ? "paper" : "no-paper"}
                      disabled={isStatusSaving}
                      onChange={(event) =>
                        patchSelectedToilet({ hasPaper: event.target.value === "paper" })
                      }
                    >
                      <option value="paper">有纸</option>
                      <option value="no-paper">没纸</option>
                    </select>
                  </label>
                  <label>
                    清洁状态
                    <select
                      value={selectedToilet.isClean ? "clean" : "dirty"}
                      disabled={isStatusSaving}
                      onChange={(event) =>
                        patchSelectedToilet({ isClean: event.target.value === "clean" })
                      }
                    >
                      <option value="clean">干净</option>
                      <option value="dirty">待清洁</option>
                    </select>
                  </label>
                  <label>
                    无障碍
                    <select
                      value={selectedToilet.accessibility ? "accessible" : "unknown"}
                      disabled={isStatusSaving}
                      onChange={(event) =>
                        patchSelectedToilet({ accessibility: event.target.value === "accessible" })
                      }
                    >
                      <option value="accessible">支持</option>
                      <option value="unknown">未确认</option>
                    </select>
                  </label>
                </div>

                <section className={styles.helpBox} aria-label="厕纸求助">
                  <div className={styles.sectionTitle}>
                    <CircleAlert size={18} />
                    <h3>厕纸求助</h3>
                  </div>
                  <div className={styles.helpComposer}>
                    <input
                      value={helpBody}
                      onChange={(event) => setHelpBody(event.target.value)}
                      aria-label="求助内容"
                    />
                    <button className={styles.primaryButton} type="button" onClick={createHelpRequest}>
                      <Send size={16} />
                      发起
                    </button>
                  </div>
                  {selectedToilet.helpRequests.some((help) => help.status === "active") ? (
                    <div className={styles.helpList}>
                      {selectedToilet.helpRequests
                        .filter((help) => help.status === "active")
                        .map((help) => (
                          <div key={help.id} className={styles.helpItem}>
                            <span>{help.body}</span>
                            <button type="button" onClick={() => resolveHelp(help.id)}>
                              标记解决
                            </button>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className={styles.emptyText}>当前没有求助。</p>
                  )}
                </section>

                <section className={styles.reviewBox} aria-label="评分评论">
                  <div className={styles.sectionTitle}>
                    <MessageSquare size={18} />
                    <h3>评分和评论</h3>
                  </div>
                  <form className={styles.reviewForm} onSubmit={submitReview}>
                    <select
                      aria-label="评分"
                      value={reviewScore}
                      onChange={(event) => setReviewScore(Number(event.target.value))}
                    >
                      <option value={5}>5 分</option>
                      <option value={4}>4 分</option>
                      <option value={3}>3 分</option>
                      <option value={2}>2 分</option>
                      <option value={1}>1 分</option>
                    </select>
                    <input
                      value={reviewBody}
                      onChange={(event) => setReviewBody(event.target.value)}
                      placeholder="写一句真实反馈"
                      aria-label="评论内容"
                    />
                    <button className={styles.primaryButton} type="submit">
                      发送
                    </button>
                  </form>

                  <div className={styles.reviewList}>
                    {selectedToilet.reviews.length > 0 ? (
                      selectedToilet.reviews.map((review) => (
                        <article key={review.id} className={styles.reviewItem}>
                          <div>
                            <strong>{review.author}</strong>
                            <span>{review.score} 分 · {review.time}</span>
                          </div>
                          <p>{review.body}</p>
                        </article>
                      ))
                    ) : (
                      <p className={styles.emptyText}>还没有评论。</p>
                    )}
                  </div>
                </section>

                <section className={styles.reportBox} aria-label="举报问题">
                  <div className={styles.sectionTitle}>
                    <Flag size={18} />
                    <h3>举报问题</h3>
                  </div>
                  <form className={styles.reportForm} onSubmit={submitReport}>
                    <label>
                      原因
                      <select
                        value={reportReason}
                        onChange={(event) => setReportReason(event.target.value)}
                      >
                        <option value="信息不准确">信息不准确</option>
                        <option value="重复点位">重复点位</option>
                        <option value="地点不存在">地点不存在</option>
                        <option value="内容不合适">内容不合适</option>
                      </select>
                    </label>
                    <label>
                      补充说明
                      <input
                        value={reportDetails}
                        onChange={(event) => setReportDetails(event.target.value)}
                        placeholder="可选：补充你看到的问题"
                      />
                    </label>
                    <button className={styles.secondaryButton} type="submit">
                      <Flag size={16} />
                      提交举报
                    </button>
                  </form>
                  {reportMessage ? <p className={styles.formMessage}>{reportMessage}</p> : null}
                </section>
              </>
            ) : (
              <div className={styles.emptyDetailState}>
                <h2>{dataSource === "error" ? "数据源不可用" : "当前范围暂无厕所"}</h2>
                <p>{dataMessage}</p>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => void refreshViewport()}
                >
                  <RefreshCw size={17} />
                  重新加载
                </button>
              </div>
            )}
          </aside>

          <aside className={styles.helpPanel} aria-label="附近求助">
            <div className={styles.sectionTitle}>
              <CircleAlert size={18} />
              <h3>附近求助</h3>
            </div>
            {nearbyHelpRequests.length > 0 ? (
              nearbyHelpRequests.map((help) => (
                <button
                  key={help.helpId}
                  className={styles.helpSummary}
                  type="button"
                  onClick={() => selectNearbyHelp(help)}
                >
                  <span>{help.toiletName}</span>
                  <small>{formatHelpSummaryMeta(help)}</small>
                  <small>{help.body}</small>
                </button>
              ))
            ) : isNearbyHelpLoading ? (
              <p className={styles.emptyText}>正在读取附近求助。</p>
            ) : (
              <p className={styles.emptyText}>当前没有附近求助。</p>
            )}
          </aside>
        </section>
      ) : (
        <section className={styles.contributePage} aria-label="贡献新厕所">
          <div className={styles.contributeIntro}>
            <h1>贡献一个厕所点位</h1>
            <p>新增点位必须写入生产数据库；失败时不会创建本地临时点位。</p>
            <p>请在真实地图上选点，或手动填写准确经纬度。</p>
          </div>

          <form className={styles.contributeForm} onSubmit={submitNewToilet}>
            <label>
              名称（可选）
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="不填会按地点和楼层生成"
              />
            </label>
            <label>
              所属地点（地图自动填，可修改）
              <input
                value={form.location}
                onChange={(event) => {
                  setAutoPickedLocation("");
                  setForm({ ...form, location: event.target.value });
                }}
                placeholder="点击地图后自动填入附近地名"
              />
            </label>
            <label>
              楼层 / 方位
              <input
                value={form.floor}
                onChange={(event) => setForm({ ...form, floor: event.target.value })}
                placeholder="例如：B1 / 中庭"
              />
            </label>

            <section className={styles.coordinatePicker} aria-label="从地图选择位置">
              <div className={styles.coordinateHeader}>
                <div>
                  <h2>从地图选择位置</h2>
                  <p>点击真实地图会取坐标并尝试填入附近地名。</p>
                </div>
                <button className={styles.secondaryButton} type="button" onClick={useCurrentMapCenter}>
                  <MapPin size={16} />
                  使用当前地图中心
                </button>
              </div>

              <ToiletMap
                compact
                pickingMode
                label="从地图选择位置"
                center={formMapCenter}
                pickedCoordinates={formCoordinates}
                selectedToiletId={selectedToiletId}
                toilets={formMapToilets}
                userLocation={userLocation}
                onPickCoordinates={pickCoordinates}
                onSelectToilet={selectToilet}
              />

              <div className={styles.coordinateGrid}>
                <label>
                  纬度
                  <input
                    inputMode="decimal"
                    value={form.latitude}
                    onChange={(event) => setForm({ ...form, latitude: event.target.value })}
                    placeholder="例如：22.319300"
                  />
                </label>
                <label>
                  经度
                  <input
                    inputMode="decimal"
                    value={form.longitude}
                    onChange={(event) => setForm({ ...form, longitude: event.target.value })}
                    placeholder="例如：114.169400"
                  />
                </label>
              </div>
            </section>

            <div className={styles.toggleGrid}>
              <ToggleButton
                label="开放中"
                checked={form.isOpen}
                onToggle={() => setForm({ ...form, isOpen: !form.isOpen })}
              />
              <ToggleButton
                label="有厕纸"
                checked={form.hasPaper}
                onToggle={() => setForm({ ...form, hasPaper: !form.hasPaper })}
              />
              <ToggleButton
                label="干净"
                checked={form.isClean}
                onToggle={() => setForm({ ...form, isClean: !form.isClean })}
              />
              <ToggleButton
                label="无障碍"
                checked={form.accessibility}
                onToggle={() => setForm({ ...form, accessibility: !form.accessibility })}
              />
            </div>

            {formMessage ? <p className={styles.formMessage}>{formMessage}</p> : null}

            <div className={styles.formActions}>
              <button className={styles.secondaryButton} type="button" onClick={() => setView("map")}>
                返回地图
              </button>
              <button className={styles.primaryButton} type="submit">
                <Plus size={17} />
                添加到数据库
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}

function StatusTile({
  label,
  active,
  activeText,
  inactiveText,
}: {
  label: string;
  active: boolean;
  activeText: string;
  inactiveText: string;
}) {
  return (
    <div className={active ? styles.statusTileActive : styles.statusTile}>
      <span>{label}</span>
      <strong>
        {active ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}
        {active ? activeText : inactiveText}
      </strong>
    </div>
  );
}

function ToggleButton({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className={checked ? styles.toggleActive : styles.toggle}
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
    >
      {checked ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
      {label}
    </button>
  );
}

function statusText(toilet: ToiletSummary) {
  if (!toilet.isOpen) {
    return "未开放";
  }

  if (toilet.activeHelpRequestCount > 0) {
    return "正在求助";
  }

  if (!toilet.hasPaper) {
    return "没纸";
  }

  if (!toilet.isClean) {
    return "待清洁";
  }

  return "状态良好";
}

function dataSourceLabel(dataSource: DataSource) {
  if (dataSource === "error") {
    return "数据错误";
  }

  return "生产 Supabase";
}

function toiletRowMeta(toilet: ToiletSummary, distanceMeters: number | null, showDistance: boolean) {
  const distanceText = showDistance && distanceMeters !== null ? `${formatDistance(distanceMeters)} · ` : "";
  const locationText = toilet.location ? `${toilet.location} · ` : "";
  const coordinateText = hasValidCoordinates(toilet) ? "" : "暂无坐标 · ";

  return `${distanceText}${locationText}${toilet.floor} · ${coordinateText}${statusText(toilet)}`;
}

function formatHelpSummaryMeta(help: NearbyHelpRequest) {
  const distanceText = help.distanceMeters === null ? "距离未知" : formatDistance(help.distanceMeters);
  return `${distanceText} · ${help.time} · ${help.location} · ${help.floor}`;
}

function sortToiletsByDistance<T extends ToiletSummary>(
  toilets: T[],
  origin: Coordinates,
): NearbyToilet<T>[] {
  return toilets
    .map((toilet, index) => {
      const coordinates = getToiletCoordinates(toilet);

      return {
        toilet,
        index,
        distanceMeters: coordinates ? calculateDistanceMeters(origin, coordinates) : null,
      };
    })
    .sort((left, right) => {
      if (left.distanceMeters === null && right.distanceMeters === null) {
        return left.index - right.index;
      }

      if (left.distanceMeters === null) {
        return 1;
      }

      if (right.distanceMeters === null) {
        return -1;
      }

      return left.distanceMeters - right.distanceMeters;
    })
    .map(({ toilet, distanceMeters }) => ({ toilet, distanceMeters }));
}

function getToiletCoordinates(toilet: ToiletSummary | Toilet | null | undefined): Coordinates | null {
  if (
    !toilet ||
    typeof toilet.latitude !== "number" ||
    typeof toilet.longitude !== "number" ||
    !hasValidCoordinates(toilet)
  ) {
    return null;
  }

  return {
    latitude: toilet.latitude,
    longitude: toilet.longitude,
  };
}

function readFormCoordinates(form: NewToiletForm): Coordinates | null {
  const latitude = parseCoordinate(form.latitude);
  const longitude = parseCoordinate(form.longitude);

  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

function calculateDistanceMeters(origin: Coordinates, target: Coordinates) {
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

function formatDistance(distanceMeters: number) {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatToiletCoordinates(toilet: Toilet) {
  if (
    typeof toilet.latitude !== "number" ||
    typeof toilet.longitude !== "number" ||
    !hasValidCoordinates(toilet)
  ) {
    return "暂无经纬度";
  }

  return `${toilet.latitude.toFixed(6)}, ${toilet.longitude.toFixed(6)}`;
}

function formatCoordinate(value: number) {
  return value.toFixed(6);
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(6));
}

async function readGeolocationPermissionState() {
  if (!("permissions" in navigator) || !navigator.permissions?.query) {
    return "prompt" as PermissionState;
  }

  try {
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state;
  } catch {
    return "prompt" as PermissionState;
  }
}

function getInsecureGeolocationMessage() {
  if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
    return "浏览器只允许 HTTPS 或 localhost 使用定位。请用 HTTPS 生产域名访问。";
  }

  return "当前页面不是安全上下文，浏览器无法提供定位。";
}

function getGeolocationFailureMessage(
  error: GeolocationPositionError,
  permissionState: PermissionState,
) {
  if (permissionState === "denied" || error.code === error.PERMISSION_DENIED) {
    return "定位权限被拒绝。请在浏览器地址栏权限设置里允许定位，然后重新定位。";
  }

  if (error.code === error.TIMEOUT) {
    return "定位超时。已继续使用当前地图范围。";
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return "系统暂时无法获取位置。已继续使用当前地图范围。";
  }

  return "定位失败。已继续使用当前地图范围。";
}

function buildShareUrl(toilet: Toilet) {
  if (typeof window === "undefined") {
    return "";
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("area");
  url.searchParams.set("toilet", toilet.id);
  return url.toString();
}

function readSelectionFromUrl() {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const toiletId = params.get("toilet");

  return toiletId && /^\d+$/.test(toiletId) ? toiletId : null;
}

function buildDefaultToiletName(location: string, floor: string) {
  const floorText = floor.trim() || "未填写楼层";
  return `${location} ${floorText} 卫生间`;
}
