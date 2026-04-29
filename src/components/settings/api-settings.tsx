"use client";

/**
 * API Settings — multi-provider edition.
 *
 * One active provider at a time. Pick which (OpenAI / Anthropic / Google),
 * save its API key, and optionally override which model each feature role
 * uses. If the provider has no reasoning model, the thinking-role row is
 * hidden.
 */

import { useState, useEffect, useRef } from "react";
import { CheckCircle, XCircle, Loader2, Eye, EyeOff, ExternalLink, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useAPISettingsStore,
  type ProviderInfo,
  type FeatureRole,
  type ProviderId,
} from "@/stores/api-settings-store";

const ROLE_LABELS: Record<FeatureRole, string> = {
  chat: "Chat",
  thinking: "Thinking",
  fast: "Autocomplete",
  review: "Review",
  file_conversion: "File conversion",
};

function formatContext(length: number): string {
  if (!length) return "—";
  if (length >= 1_000_000) return `${Math.round(length / 1_000_000)}M`;
  if (length >= 1_000) return `${Math.round(length / 1_000)}K`;
  return length.toString();
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return "";
  if (price === 0) return "Free";
  if (price < 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toFixed(2)}`;
}

export function APISettings() {
  const {
    activeProvider,
    providers,
    isLoading,
    loadFromBackend,
    saveProviderKey,
    deleteProviderKey,
    setActiveProvider,
    setRoleModel,
    startClaudeOAuthLogin,
    pollClaudeOAuthStatus,
    claudeLogout,
  } = useAPISettingsStore();

  const [selectedTab, setSelectedTab] = useState<ProviderId>("openai");
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthState, setOauthState] = useState<{
    inProgress: boolean;
    sessionId: string | null;
    error: string | null;
  }>({ inProgress: false, sessionId: null, error: null });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadFromBackend();
  }, [loadFromBackend]);

  useEffect(() => {
    if (activeProvider) setSelectedTab(activeProvider);
  }, [activeProvider]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const currentProvider = providers.find((p) => p.id === selectedTab);

  const handleSaveKey = async () => {
    const key = (keyInputs[selectedTab] || "").trim();
    if (!key) return;
    setIsSaving(true);
    setError(null);
    const result = await saveProviderKey(selectedTab, key);
    if (result.success) {
      setKeyInputs((prev) => ({ ...prev, [selectedTab]: "" }));
      setShowKey((prev) => ({ ...prev, [selectedTab]: false }));
    } else {
      setError(result.error || "Failed to save key");
    }
    setIsSaving(false);
  };

  const handleDeleteKey = async () => {
    if (!window.confirm(`Remove ${currentProvider?.name} API key?`)) return;
    await deleteProviderKey(selectedTab);
  };

  const handleStartClaudeLogin = async () => {
    setOauthState({ inProgress: true, sessionId: null, error: null });
    const result = await startClaudeOAuthLogin();
    if (!result.success) {
      setOauthState({ inProgress: false, sessionId: null, error: result.error });
      return;
    }
    setOauthState({ inProgress: true, sessionId: result.sessionId, error: null });
    window.open(result.authUrl, "_blank", "noopener,noreferrer");

    const sessionId = result.sessionId;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      const status = await pollClaudeOAuthStatus(sessionId);
      if (status.status === "success") {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setOauthState({ inProgress: false, sessionId: null, error: null });
      } else if (status.status === "error") {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        setOauthState({
          inProgress: false,
          sessionId: null,
          error: status.error || "Login failed",
        });
      }
    }, 1500);
  };

  const handleCancelClaudeLogin = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setOauthState({ inProgress: false, sessionId: null, error: null });
  };

  const handleClaudeLogout = async () => {
    if (!window.confirm("Sign out of Claude?")) return;
    await claudeLogout();
  };

  if (isLoading && providers.length === 0) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!currentProvider) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">Loading providers…</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Provider tabs */}
      <div className="flex gap-1 rounded-md border bg-muted/30 p-1">
        {providers.map((p) => (
          <button
            key={p.id}
            onClick={() => setSelectedTab(p.id)}
            className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              selectedTab === p.id
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5 whitespace-nowrap">
              {p.name}
              {p.has_api_key && <CheckCircle className="h-3.5 w-3.5 text-green-500" />}
            </span>
          </button>
        ))}
      </div>

      <ProviderPanel
        provider={currentProvider}
        isActive={activeProvider === currentProvider.id}
        apiKeyInput={keyInputs[selectedTab] || ""}
        onApiKeyInput={(v) => setKeyInputs((prev) => ({ ...prev, [selectedTab]: v }))}
        showKey={!!showKey[selectedTab]}
        onToggleShowKey={() =>
          setShowKey((prev) => ({ ...prev, [selectedTab]: !prev[selectedTab] }))
        }
        isSaving={isSaving}
        error={error}
        onSaveKey={handleSaveKey}
        onDeleteKey={handleDeleteKey}
        onMakeActive={() => setActiveProvider(currentProvider.id)}
        onSetRoleModel={(role, model) => setRoleModel(currentProvider.id, role, model)}
        oauthInProgress={oauthState.inProgress}
        oauthError={oauthState.error}
        onStartOAuth={handleStartClaudeLogin}
        onCancelOAuth={handleCancelClaudeLogin}
        onOAuthLogout={handleClaudeLogout}
      />
    </div>
  );
}

function formatExpiry(expiresAt: number | null): string {
  if (!expiresAt) return "";
  const d = new Date(expiresAt);
  return d.toLocaleString();
}

function ProviderPanel({
  provider,
  isActive,
  apiKeyInput,
  onApiKeyInput,
  showKey,
  onToggleShowKey,
  isSaving,
  error,
  onSaveKey,
  onDeleteKey,
  onMakeActive,
  onSetRoleModel,
  oauthInProgress,
  oauthError,
  onStartOAuth,
  onCancelOAuth,
  onOAuthLogout,
}: {
  provider: ProviderInfo;
  isActive: boolean;
  apiKeyInput: string;
  onApiKeyInput: (v: string) => void;
  showKey: boolean;
  onToggleShowKey: () => void;
  isSaving: boolean;
  error: string | null;
  onSaveKey: () => void;
  onDeleteKey: () => void;
  onMakeActive: () => void;
  onSetRoleModel: (role: FeatureRole, model: string | null) => void;
  oauthInProgress: boolean;
  oauthError: string | null;
  onStartOAuth: () => void;
  onCancelOAuth: () => void;
  onOAuthLogout: () => void;
}) {
  const visibleRoles: FeatureRole[] = (
    ["chat", "thinking", "fast", "review", "file_conversion"] as FeatureRole[]
  ).filter((role) => role !== "thinking" || provider.has_reasoning);

  const isOAuth = provider.auth_mode === "oauth";

  return (
    <div className="space-y-4 rounded-lg border p-4">
      {/* Auth section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {isOAuth ? `${provider.name}` : `${provider.name} API key`}
            </span>
            {provider.has_api_key && (
              <>
                {isOAuth ? (
                  <span className="flex items-center gap-1 rounded bg-green-500/10 px-1.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-500">
                    <CheckCircle className="h-3 w-3" /> Signed in
                  </span>
                ) : (
                  <span className="rounded border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                    {provider.key_preview}
                  </span>
                )}
                {isActive ? (
                  <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-500">
                    Active
                  </span>
                ) : (
                  <Button variant="ghost" size="sm" onClick={onMakeActive}>
                    Make active
                  </Button>
                )}
              </>
            )}
          </div>
          <a
            href={provider.docs_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {isOAuth ? "Subscription" : "Get key"} <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {isOAuth ? (
          provider.has_api_key ? (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={onOAuthLogout}
                className="text-destructive hover:text-destructive"
              >
                Sign out
              </Button>
              <span className="text-xs text-muted-foreground">
                Token expires {formatExpiry(provider.oauth_expires_at)} (auto-refreshes).
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              {oauthInProgress ? (
                <div className="flex items-center gap-2">
                  <Button disabled>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Waiting for browser…
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onCancelOAuth}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button onClick={onStartOAuth}>
                  <LogIn className="mr-2 h-4 w-4" />
                  Sign in with Claude
                </Button>
              )}
              {oauthError && (
                <p className="flex items-center gap-1 text-sm text-destructive">
                  <XCircle className="h-4 w-4" />
                  {oauthError}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Uses your claude.ai subscription — no API key needed.
              </p>
            </div>
          )
        ) : provider.has_api_key ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onDeleteKey}
            className="text-destructive hover:text-destructive"
          >
            Remove key
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  placeholder={provider.api_key_hint}
                  value={apiKeyInput}
                  onChange={(e) => onApiKeyInput(e.target.value)}
                  autoComplete="one-time-code"
                  data-form-type="other"
                  className="pr-10 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={onToggleShowKey}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={onSaveKey} disabled={!apiKeyInput.trim() || isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </div>
            {error && (
              <p className="flex items-center gap-1 text-sm text-destructive">
                <XCircle className="h-4 w-4" />
                {error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Key is stored locally in ~/.doxmind/config.json.
            </p>
          </div>
        )}
      </div>

      {/* Role assignments — only when a key is saved */}
      {provider.has_api_key && (
        <>
          <hr />
          <div className="space-y-2">
            <div className="text-sm font-medium">Model assignments</div>
            <div className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-2">
              {visibleRoles.map((role) => {
                const current = provider.role_overrides[role] || provider.role_defaults[role];
                return (
                  <div key={role} className="contents">
                    <label className="text-sm text-muted-foreground" htmlFor={`role-${role}`}>
                      {ROLE_LABELS[role]}
                    </label>
                    <select
                      id={`role-${role}`}
                      value={current || ""}
                      onChange={(e) =>
                        onSetRoleModel(
                          role,
                          e.target.value === provider.role_defaults[role] ? null : e.target.value
                        )
                      }
                      className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                    >
                      {provider.models
                        .filter((m) => role !== "thinking" || m.supports_reasoning)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} · {formatContext(m.context_length)}
                            {m.prompt_price != null ? ` · ${formatPrice(m.prompt_price)}/M` : ""}
                            {provider.role_defaults[role] === m.id ? " (default)" : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
