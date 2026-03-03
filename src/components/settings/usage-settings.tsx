"use client";

/**
 * Usage Settings Component
 *
 * Displays token usage breakdown by service with a doughnut chart.
 * Data sourced from /api/usage/by-service and /api/usage/summary.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Doughnut } from "react-chartjs-2";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend);

interface ServiceUsage {
  service: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: number | null;
  request_count: number;
}

interface ServiceUsageResponse {
  services: ServiceUsage[];
  period_days: number;
}

interface UsageSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: number | null;
  total_requests: number;
  period_days: number;
}

const SERVICE_LABEL_KEYS: Record<string, string> = {
  chat: "serviceChat",
  autocomplete: "serviceAutocomplete",
  quick_edit: "serviceQuickEdit",
  custom_edit: "serviceCustomEdit",
  review: "serviceReview",
  file_conversion: "serviceFileConversion",
  reranking: "serviceReranking",
  stt: "serviceStt",
  simple_chat: "serviceSimpleChat",
};

const SERVICE_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f43f5e", // rose
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(cost: number | null): string {
  if (cost === null || cost === undefined) return "-";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function getServiceLabel(service: string, t: (key: string) => string): string {
  const key = SERVICE_LABEL_KEYS[service];
  return key ? t(key) : service.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const PERIOD_OPTIONS = [
  { value: 7, labelKey: "days7" },
  { value: 30, labelKey: "days30" },
  { value: 90, labelKey: "days90" },
];

export function UsageSettings() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const [serviceData, setServiceData] = useState<ServiceUsageResponse | null>(null);
  const [summaryData, setSummaryData] = useState<UsageSummary | null>(null);
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
        const [serviceRes, summaryRes] = await Promise.all([
          fetch(`${baseUrl}/api/usage/by-service?days=${period}`, { headers }),
          fetch(`${baseUrl}/api/usage/summary?days=${period}`, { headers }),
        ]);
        if (!serviceRes.ok) throw new Error(`HTTP ${serviceRes.status}`);
        if (!summaryRes.ok) throw new Error(`HTTP ${summaryRes.status}`);
        const [services, summary] = await Promise.all([
          serviceRes.json() as Promise<ServiceUsageResponse>,
          summaryRes.json() as Promise<UsageSummary>,
        ]);
        setServiceData(services);
        setSummaryData(summary);
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

  const chartData = useMemo(() => {
    if (!serviceData?.services.length) return null;
    const sorted = [...serviceData.services].sort((a, b) => b.total_tokens - a.total_tokens);
    return {
      labels: sorted.map((s) => getServiceLabel(s.service, t)),
      datasets: [
        {
          data: sorted.map((s) => s.total_tokens),
          backgroundColor: sorted.map((_, i) => SERVICE_COLORS[i % SERVICE_COLORS.length]),
          borderWidth: 0,
          hoverOffset: 4,
        },
      ],
    };
  }, [serviceData, t]);

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

  const hasServiceData = serviceData && serviceData.services.length > 0;
  const hasSummaryData = summaryData && summaryData.total_requests > 0;

  if (!hasServiceData && !hasSummaryData) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{t("tokenUsageByService")}</p>
          <PeriodSelector value={days} onChange={setDays} t={t} />
        </div>
        <p className="py-8 text-center text-sm text-muted-foreground">{t("noUsageData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("tokenUsageByService")}</p>
        <PeriodSelector value={days} onChange={setDays} t={t} />
      </div>

      {/* Summary totals */}
      {summaryData && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label={t("input")} value={formatTokens(summaryData.total_input_tokens)} />
          <StatCard label={t("output")} value={formatTokens(summaryData.total_output_tokens)} />
          <StatCard label={t("youSaved")} value={formatCost(summaryData.total_cost)} />
        </div>
      )}

      {/* Doughnut chart */}
      {chartData && (
        <div className="flex items-center justify-center py-2">
          <div className="h-48 w-48">
            <Doughnut
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                cutout: "60%",
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => {
                        const value = ctx.parsed;
                        const total = ctx.dataset.data.reduce(
                          (sum: number, v: number) => sum + v,
                          0
                        );
                        const pct = total > 0 ? ((value / total) * 100).toFixed(1) : "0";
                        return ` ${ctx.label}: ${formatTokens(value)} (${pct}%)`;
                      },
                    },
                  },
                },
              }}
            />
          </div>
        </div>
      )}

      {/* Service table */}
      {hasServiceData && (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t("service")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("input")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("output")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("saved")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("reqs")}</th>
              </tr>
            </thead>
            <tbody>
              {[...serviceData!.services]
                .sort((a, b) => b.total_tokens - a.total_tokens)
                .map((svc, i) => (
                  <tr key={svc.service} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: SERVICE_COLORS[i % SERVICE_COLORS.length],
                          }}
                        />
                        {getServiceLabel(svc.service, t)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatTokens(svc.input_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatTokens(svc.output_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatCost(svc.cost)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {svc.request_count}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t("totalRequestsDays", { count: summaryData?.total_requests ?? 0, days })}
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
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
