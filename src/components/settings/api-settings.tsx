"use client";

/**
 * API Settings Component
 *
 * Allows users to configure their own Anthropic API key and select models.
 */

import { useState, useEffect } from "react";
import { Key, CheckCircle, XCircle, Loader2, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAPISettingsStore } from "@/stores/api-settings-store";

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "claude-sonnet-4-5-20250929": "Claude Sonnet 4.5",
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
};

export function APISettings() {
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

  useEffect(() => {
    loadFromBackend();
  }, [loadFromBackend]);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;

    setIsSaving(true);
    setError(null);

    const result = await saveAPIKey(apiKey);

    if (result.success) {
      setApiKey("");
      setShowKey(false);
    } else {
      setError(result.error || "Failed to save API key");
    }

    setIsSaving(false);
  };

  const handleDeleteKey = async () => {
    if (!window.confirm("Are you sure you want to remove your API key?")) return;
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
      <p className="text-sm text-muted-foreground">
        Use your own Anthropic API key to unlock model selection.
      </p>

      <div className="space-y-4 rounded-lg border p-4">
        {/* API Key Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-muted-foreground" />
            <span className="font-medium">Anthropic API Key</span>
            {hasAPIKey && <CheckCircle className="h-4 w-4 text-green-500" />}
          </div>

          {hasAPIKey ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">API key configured</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteKey}
                className="text-destructive hover:text-destructive"
              >
                Remove
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    placeholder="sk-ant-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
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
                Your API key is encrypted and stored securely.{" "}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Get your API key
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Model Selection (only visible when user has API key) */}
        {hasAPIKey && (
          <>
            <hr />
            <div className="space-y-2">
              <span className="font-medium">Preferred Model</span>
              <div className="space-y-1">
                {availableModels.map((model) => (
                  <label
                    key={model}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50"
                  >
                    <input
                      type="radio"
                      name="model"
                      value={model}
                      checked={preferredModel === model}
                      onChange={() => setPreferredModel(model)}
                      className="h-4 w-4 text-primary"
                    />
                    <span className="text-sm">{MODEL_DISPLAY_NAMES[model] || model}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Without your own API key, you&apos;ll use the default model provided by doXmind. Your own
        API key gives you access to more powerful models.
      </p>
    </div>
  );
}
