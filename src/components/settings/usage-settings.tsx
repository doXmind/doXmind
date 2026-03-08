"use client";

/**
 * Usage Settings Component
 *
 * Displays daily AI usage as a stacked bar chart (by service) + overall usage progress bar.
 * Data sourced from /api/usage/daily-by-service.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useBillingStore } from "@/stores/billing-store";
import { cn } from "@/lib/utils";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Filler,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Filler);

interface DailyServiceBreakdown {
  date: string;
  services: Record<string, number>;
}

interface DailyServiceResponse {
  days: DailyServiceBreakdown[];
  period_days: number;
}

const PERIOD_OPTIONS = [
  { value: 7, labelKey: "days7" },
  { value: 30, labelKey: "days30" },
  { value: 90, labelKey: "days90" },
];

/** Map backend service key → i18n key */
const SERVICE_LABEL_MAP: Record<string, string> = {
  chat: "serviceChat",
  simple_chat: "serviceSimpleChat",
  autocomplete: "serviceAutocomplete",
  inline: "serviceInline",
  quick_edit: "serviceQuickEdit",
  custom_edit: "serviceCustomEdit",
  review: "serviceReview",
  file_conversion: "serviceFileConversion",
  kb_agent: "serviceKbAgent",
  global_agent: "serviceGlobalAgent",
  reranking: "serviceReranking",
  stt: "serviceStt",
};

/** Distinct colours for each service (stacked segments) */
const SERVICE_COLORS: Record<string, string> = {
  chat: "rgba(99, 102, 241, 0.8)", // indigo
  simple_chat: "rgba(59, 130, 246, 0.8)", // blue
  autocomplete: "rgba(20, 184, 166, 0.8)", // teal
  inline: "rgba(139, 92, 246, 0.8)", // violet
  quick_edit: "rgba(168, 85, 247, 0.8)", // purple
  custom_edit: "rgba(192, 132, 252, 0.8)", // light purple
  review: "rgba(245, 158, 11, 0.8)", // amber
  file_conversion: "rgba(156, 163, 175, 0.7)", // gray
  kb_agent: "rgba(16, 185, 129, 0.8)", // emerald
  global_agent: "rgba(6, 182, 212, 0.8)", // cyan
  reranking: "rgba(100, 116, 139, 0.7)", // slate
  stt: "rgba(244, 114, 182, 0.8)", // pink
};

const FALLBACK_COLOR = "rgba(161, 161, 170, 0.6)";

export function UsageSettings() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const credits = useBillingStore((s) => s.credits);
  const [dailyData, setDailyData] = useState<DailyServiceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchUsage = useCallback(
    async (period: number) => {
      setIsLoading(true);
      setError(null);
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const headers = api.getAuthorizationHeaders();
      try {
        const res = await fetch(`${baseUrl}/api/usage/daily-by-service?days=${period}`, {
          headers,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as DailyServiceResponse;
        setDailyData(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("failedToLoadUsageData"));
      } finally {
        setIsLoading(false);
      }
    },
    [t]
  );

  useEffect(() => {
    fetchUsage(days);
  }, [days, fetchUsage]);

  // Overall AI usage percentage from billing store
  const overallPercentage =
    credits && credits.limit > 0 ? ((credits.limit - credits.remaining) / credits.limit) * 100 : 0;
  const remainingPercentage = 100 - overallPercentage;
  const isLow = remainingPercentage < 20;
  const isMedium = remainingPercentage >= 20 && remainingPercentage < 50;

  // Build stacked bar chart data
  const { chartData, totalUsedPct, legendItems } = useMemo(() => {
    if (!dailyData?.days.length || !credits || credits.limit <= 0) {
      return {
        chartData: null,
        totalUsedPct: 0,
        legendItems: [] as { key: string; color: string; label: string }[],
      };
    }

    const creditsUsed = credits.limit - credits.remaining;
    const totalTokens = dailyData.days.reduce(
      (sum, d) => sum + Object.values(d.services).reduce((s, v) => s + v, 0),
      0
    );

    // Collect all services that appear
    const allServices = new Set<string>();
    for (const d of dailyData.days) {
      for (const svc of Object.keys(d.services)) {
        allServices.add(svc);
      }
    }
    const serviceKeys = Array.from(allServices);

    const labels = dailyData.days.map((d) => {
      const date = new Date(d.date + "T00:00:00");
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    });

    // One dataset per service
    const datasets = serviceKeys.map((svc) => ({
      label: t(SERVICE_LABEL_MAP[svc] ?? "serviceOther"),
      data: dailyData.days.map((d) => {
        if (totalTokens === 0) return 0;
        const svcTokens = d.services[svc] ?? 0;
        // This service's contribution to plan usage % for this day
        const dayCredits = (svcTokens / totalTokens) * creditsUsed;
        return (dayCredits / credits.limit) * 100;
      }),
      backgroundColor: SERVICE_COLORS[svc] ?? FALLBACK_COLOR,
      borderRadius: 0,
      borderSkipped: false as const,
    }));

    // Round top corners on the topmost visible dataset
    if (datasets.length > 0) {
      datasets[datasets.length - 1].borderRadius = 3;
    }

    const legend = serviceKeys.map((svc) => ({
      key: svc,
      color: SERVICE_COLORS[svc] ?? FALLBACK_COLOR,
      label: t(SERVICE_LABEL_MAP[svc] ?? "serviceOther"),
    }));

    return {
      chartData: {
        labels,
        datasets,
      },
      totalUsedPct: Math.round((creditsUsed / credits.limit) * 100),
      legendItems: legend,
    };
  }, [dailyData, credits, t]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <p>{error}</p>
        <button onClick={() => fetchUsage(days)} className="mt-2 text-primary hover:underline">
          {tc("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall AI Usage progress bar */}
      {credits && (
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium">{t("aiUsage")}</p>
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                isLow && "text-red-500",
                isMedium && "text-amber-500",
                !isLow && !isMedium && "text-emerald-600 dark:text-emerald-400"
              )}
            >
              {Math.round(remainingPercentage)}% {t("remaining")}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                isLow && "bg-red-500",
                isMedium && "bg-amber-500",
                !isLow && !isMedium && "bg-emerald-500"
              )}
              style={{ width: `${Math.max(remainingPercentage, 1)}%` }}
            />
          </div>
        </div>
      )}

      {/* Header + Period selector */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("dailyUsage")}</p>
        <PeriodSelector value={days} onChange={setDays} t={t} />
      </div>

      {/* Stacked bar chart — daily service breakdown */}
      {chartData ? (
        <>
          <div className="h-52">
            <Bar
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: {
                      maxRotation: 0,
                      autoSkip: true,
                      maxTicksLimit: days <= 7 ? 7 : days <= 30 ? 10 : 12,
                      font: { size: 10 },
                      color: "rgb(161, 161, 170)",
                    },
                    border: { display: false },
                  },
                  y: {
                    stacked: true,
                    beginAtZero: true,
                    display: false,
                  },
                },
                plugins: {
                  tooltip: {
                    mode: "index",
                    callbacks: {
                      title: (items) => items[0]?.label ?? "",
                      label: (ctx) => {
                        const val = ctx.parsed.y ?? 0;
                        if (val < 0.01) return "";
                        return ` ${ctx.dataset.label}: ${val.toFixed(1)}%`;
                      },
                      afterBody: (items) => {
                        const total = items.reduce((s, item) => s + (item.parsed.y ?? 0), 0);
                        if (total < 0.01) return "";
                        return `\n Total: ${total.toFixed(1)}%`;
                      },
                    },
                    filter: (item) => (item.parsed.y ?? 0) >= 0.01,
                  },
                },
              }}
            />
          </div>

          {/* Legend */}
          {legendItems.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {legendItems.map((item) => (
                <div key={item.key} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[11px] text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("noUsageData")}</p>
      )}

      {totalUsedPct > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("usedInPeriod", { percent: totalUsedPct, days })}
        </p>
      )}
    </div>
  );
}

function PeriodSelector({
  value,
  onChange,
  t,
}: {
  value: number;
  onChange: (v: number) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex gap-1 rounded-md border p-0.5">
      {PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t(opt.labelKey)}
        </button>
      ))}
    </div>
  );
}
