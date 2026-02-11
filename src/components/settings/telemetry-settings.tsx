"use client";

/**
 * Telemetry Settings Component
 *
 * Allows users to control what data is collected for product improvement.
 * Similar to Grammarly's "Product Improvement and Training Control".
 */

import { useEffect } from "react";
import { BarChart3, MessageSquare, Sparkles, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useTelemetryStore } from "@/stores/telemetry-store";

interface SettingRowProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

function SettingRow({
  icon,
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex gap-3">
        <div className="mt-0.5 text-muted-foreground">{icon}</div>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

export function TelemetrySettings() {
  const {
    productImprovementEnabled,
    collectEditFeedback,
    collectChatFeedback,
    collectAutocompleteStats,
    setProductImprovementEnabled,
    setCollectEditFeedback,
    setCollectChatFeedback,
    setCollectAutocompleteStats,
    loadFromBackend,
    isLoading,
  } = useTelemetryStore();

  // Load settings from backend on mount
  useEffect(() => {
    loadFromBackend();
  }, [loadFromBackend]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Control how your data is used to improve doXmind.
      </p>

      <div className="space-y-1 rounded-lg border p-4">
        {/* Master toggle */}
        <SettingRow
          icon={<BarChart3 className="h-5 w-5" />}
          title="Help improve doXmind"
          description="Allow your interactions to be used for product improvement and AI training. Your data is never shared with third parties."
          checked={productImprovementEnabled}
          onCheckedChange={setProductImprovementEnabled}
          disabled={isLoading}
        />

        <hr className="my-2" />

        {/* Sub-toggles (only visible when master is on) */}
        <div
          className={productImprovementEnabled ? "opacity-100" : "pointer-events-none opacity-50"}
        >
          <SettingRow
            icon={<Sparkles className="h-5 w-5" />}
            title="Edit suggestions feedback"
            description="Track which AI editing suggestions you accept or reject"
            checked={collectEditFeedback}
            onCheckedChange={setCollectEditFeedback}
            disabled={!productImprovementEnabled || isLoading}
          />

          <SettingRow
            icon={<MessageSquare className="h-5 w-5" />}
            title="Chat feedback"
            description="Track your feedback on AI chat responses"
            checked={collectChatFeedback}
            onCheckedChange={setCollectChatFeedback}
            disabled={!productImprovementEnabled || isLoading}
          />

          <SettingRow
            icon={<Zap className="h-5 w-5" />}
            title="Autocomplete usage"
            description="Track which autocomplete suggestions you use"
            checked={collectAutocompleteStats}
            onCheckedChange={setCollectAutocompleteStats}
            disabled={!productImprovementEnabled || isLoading}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Even when disabled, we may collect anonymous aggregate statistics (like total word count) to
        improve our service. Learn more in our{" "}
        <a href="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
