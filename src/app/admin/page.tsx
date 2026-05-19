"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import styles from "./admin.module.css";

type AdminReportStatus = "open" | "reviewed" | "resolved" | "dismissed";

type AdminReport = {
  id: number;
  reason: string;
  details: string | null;
  status: AdminReportStatus;
  created_at: string;
  resolved_at: string | null;
  toilet_id: number | null;
  toilet_review_id: number | null;
  paper_request_id: number | null;
  toilets: TargetToilet | null;
  toilet_reviews: TargetReview | null;
  paper_requests: TargetPaperRequest | null;
};

type TargetToilet = {
  id: number;
  name: string;
  floor: string;
  direction: string | null;
  places: {
    name: string;
    regions: {
      name: string;
    } | null;
  } | null;
};

type TargetReview = {
  id: number;
  rating: number;
  body: string;
  author_name: string;
  is_hidden: boolean;
  toilets: {
    id: number;
    name: string;
  } | null;
};

type TargetPaperRequest = {
  id: number;
  body: string;
  status: "active" | "resolved";
  toilets: {
    id: number;
    name: string;
  } | null;
};

const tokenStorageKey = "laleme-admin-token";

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");

  const openReports = useMemo(
    () => reports.filter((report) => report.status === "open").length,
    [reports],
  );

  useEffect(() => {
    const savedToken = window.sessionStorage.getItem(tokenStorageKey) ?? "";
    if (!savedToken) {
      return;
    }

    setToken(savedToken);
    setTokenInput(savedToken);
    void loadReports(savedToken);
  }, []);

  async function loadReports(nextToken = token) {
    if (!nextToken) {
      setMessage("请先输入管理员令牌。");
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/reports", {
        headers: {
          Authorization: `Bearer ${nextToken}`,
        },
      });
      const payload = (await response.json()) as { reports?: AdminReport[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "读取举报失败。");
      }

      setReports(payload.reports ?? []);
      setMessage("举报列表已更新。");
    } catch (error) {
      setReports([]);
      setMessage(error instanceof Error ? error.message : "读取举报失败。");
    } finally {
      setIsLoading(false);
    }
  }

  async function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextToken = tokenInput.trim();

    if (!nextToken) {
      setMessage("请先输入管理员令牌。");
      return;
    }

    window.sessionStorage.setItem(tokenStorageKey, nextToken);
    setToken(nextToken);
    await loadReports(nextToken);
  }

  async function runAction(label: string, body: Record<string, unknown>) {
    if (!token) {
      setMessage("请先输入管理员令牌。");
      return;
    }

    setBusyAction(label);
    setMessage("");

    try {
      const response = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "处理失败。");
      }

      await loadReports(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "处理失败。");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <main className={styles.adminShell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>LaLeMe Admin</p>
          <h1>举报处理</h1>
          <p>用于公开试用前的最小运营闭环：查看举报、隐藏不合适评论、解决求助、更新举报状态。</p>
        </div>
        <a href="/" className={styles.backLink}>
          返回地图
        </a>
      </header>

      <section className={styles.toolbar}>
        <form className={styles.tokenForm} onSubmit={submitToken}>
          <label>
            管理员令牌
            <input
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="输入 ADMIN_TOKEN"
              type="password"
            />
          </label>
          <button type="submit">连接</button>
        </form>
        <button type="button" onClick={() => void loadReports()} disabled={!token || isLoading}>
          {isLoading ? "刷新中..." : "刷新举报"}
        </button>
        <div className={styles.summary}>
          <strong>{openReports}</strong>
          <span>待处理</span>
        </div>
      </section>

      {message ? <p className={styles.message}>{message}</p> : null}

      <section className={styles.reportList} aria-label="举报列表">
        {reports.length > 0 ? (
          reports.map((report) => (
            <article key={report.id} className={styles.reportCard}>
              <div className={styles.reportHeader}>
                <div>
                  <p className={styles.reportMeta}>
                    #{report.id} · {formatDate(report.created_at)}
                  </p>
                  <h2>{report.reason}</h2>
                </div>
                <span className={styles.statusPill}>{statusText(report.status)}</span>
              </div>

              <p className={styles.targetLine}>{targetText(report)}</p>
              {report.details ? <p className={styles.details}>{report.details}</p> : null}
              {report.toilet_reviews ? (
                <blockquote className={styles.reviewQuote}>
                  {report.toilet_reviews.is_hidden ? "已隐藏" : "可见"} · {report.toilet_reviews.rating} 分：
                  {report.toilet_reviews.body}
                </blockquote>
              ) : null}
              {report.paper_requests ? (
                <p className={styles.details}>
                  求助状态：{report.paper_requests.status === "resolved" ? "已解决" : "进行中"} ·{" "}
                  {report.paper_requests.body}
                </p>
              ) : null}

              <div className={styles.actions}>
                {report.toilet_reviews ? (
                  <button
                    type="button"
                    onClick={() => {
                      const review = report.toilet_reviews;
                      if (!review) {
                        return;
                      }

                      void runAction(`${report.id}-review`, {
                        action: review.is_hidden ? "unhide-review" : "hide-review",
                        reviewId: review.id,
                      });
                    }}
                    disabled={Boolean(busyAction)}
                  >
                    {report.toilet_reviews.is_hidden ? "恢复评论" : "隐藏评论"}
                  </button>
                ) : null}
                {report.paper_requests?.status === "active" ? (
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(`${report.id}-paper`, {
                        action: "resolve-paper-request",
                        paperRequestId: report.paper_requests?.id,
                      })
                    }
                    disabled={Boolean(busyAction)}
                  >
                    标记求助解决
                  </button>
                ) : null}
                <StatusButton report={report} status="reviewed" onRunAction={runAction} />
                <StatusButton report={report} status="resolved" onRunAction={runAction} />
                <StatusButton report={report} status="dismissed" onRunAction={runAction} />
              </div>
            </article>
          ))
        ) : (
          <p className={styles.emptyState}>暂无可显示的举报。输入令牌后点击刷新。</p>
        )}
      </section>
    </main>
  );
}

function StatusButton({
  report,
  status,
  onRunAction,
}: {
  report: AdminReport;
  status: AdminReportStatus;
  onRunAction: (label: string, body: Record<string, unknown>) => Promise<void>;
}) {
  if (report.status === status) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() =>
        void onRunAction(`${report.id}-${status}`, {
          action: "update-report-status",
          reportId: report.id,
          status,
        })
      }
    >
      标记{statusText(status)}
    </button>
  );
}

function targetText(report: AdminReport) {
  if (report.toilets) {
    const place = report.toilets.places?.name ?? "未填写地点";
    const region = report.toilets.places?.regions?.name ?? "未知区域";
    return `厕所：${report.toilets.name} · ${region} · ${place}`;
  }

  if (report.toilet_reviews) {
    return `评论：${report.toilet_reviews.toilets?.name ?? "未知厕所"} · ${report.toilet_reviews.author_name}`;
  }

  if (report.paper_requests) {
    return `求助：${report.paper_requests.toilets?.name ?? "未知厕所"}`;
  }

  return "未知目标";
}

function statusText(status: AdminReportStatus) {
  if (status === "reviewed") {
    return "已查看";
  }

  if (status === "resolved") {
    return "已解决";
  }

  if (status === "dismissed") {
    return "已驳回";
  }

  return "待处理";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
