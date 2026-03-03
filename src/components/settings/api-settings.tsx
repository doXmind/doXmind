"use client";

/**
 * API Settings Component
 *
 * Allows users to configure their own OpenRouter API key and select models.
 * Model list is dynamically fetched from OpenRouter (top 20).
 */

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Key, CheckCircle, XCircle, Loader2, Eye, EyeOff, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAPISettingsStore, type ModelInfo } from "@/stores/api-settings-store";

function formatPrice(price: number): string {
  if (price === 0) return "Free";
  if (price < 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(2)}`;
}

function formatContext(length: number): string {
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(0)}M`;
  if (length >= 1_000) return `${(length / 1_000).toFixed(0)}K`;
  return length.toString();
}

export function APISettings() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const {
    hasAPIKey,
    preferredModel,
    availableModels,
    isLoading,
    loadFromBackend,
    saveAPIKey,
    deleteAPIKey,
    setPreferredModel,
  } = useAPISettingsStore();

  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [modelSearch, setModelSearch] = useState("");

  useEffect(() => {
    loadFromBackend();
  }, [loadFromBackend]);

  const filteredModels = useMemo(() => {
    if (!modelSearch.trim()) return availableModels;
    const q = modelSearch.toLowerCase();
    return availableModels.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [availableModels, modelSearch]);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;

    setIsSaving(true);
    setError(null);

    const result = await saveAPIKey(apiKey);

    if (result.success) {
      setApiKey("");
      setShowKey(false);
    } else {
      setError(result.error || t("failedToSaveApiKey"));
    }

    setIsSaving(false);
  };

  const handleDeleteKey = async () => {
    if (!window.confirm(t("removeApiKeyConfirm"))) return;
    await deleteAPIKey();
    setApiKey("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("openRouterDescription")}</p>

      <div className="space-y-4 rounded-lg border p-4">
        {/* API Key Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">{t("openRouterApiKey")}</span>
            {hasAPIKey && <CheckCircle className="h-4 w-4 text-green-500" />}
          </div>

          {hasAPIKey ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{t("apiKeyConfigured")}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteKey}
                className="text-destructive hover:text-destructive"
              >
                {t("removeApiKey")}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder="sk-or-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="one-time-code"
                    data-form-type="other"
                    className="pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button onClick={handleSaveKey} disabled={!apiKey.trim() || isSaving}>
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : tc("save")}
                </Button>
              </div>
              {error && (
                <p className="flex items-center gap-1 text-sm text-destructive">
                  <XCircle className="h-4 w-4" />
                  {error}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("apiKeyEncrypted")}{" "}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {t("getApiKey")}
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Model Selection (only visible when user has API key) */}
        {hasAPIKey && availableModels.length > 0 && (
          <>
            <hr />
            <div className="space-y-2">
              <span className="font-medium">{t("preferredModel")}</span>
              {/* Search filter */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t("searchModels")}
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  className="h-8 pl-8 text-sm"
                />
              </div>
              {/* Model list */}
              <div className="max-h-[240px] space-y-0.5 overflow-y-auto">
                {filteredModels.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    selected={preferredModel === model.id}
                    onSelect={() => setPreferredModel(model.id)}
                  />
                ))}
                {filteredModels.length === 0 && (
                  <p className="py-3 text-center text-xs text-muted-foreground">
                    {t("noModelsMatch")}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t("withoutApiKey")}</p>
    </div>
  );
}

function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: ModelInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition-colors ${
        selected ? "bg-primary/10" : "hover:bg-muted/50"
      }`}
    >
      <input
        type="radio"
        name="model"
        value={model.id}
        checked={selected}
        onChange={onSelect}
        className="h-3.5 w-3.5 text-primary"
      />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{model.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatContext(model.context_length)} &middot; {formatPrice(model.prompt_price)}/M
        </span>
      </div>
    </label>
  );
}
