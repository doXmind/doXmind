"use client";

import { FileText, Sparkles, Zap, History } from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { Button } from "@/components/ui/button";

export function WelcomeScreen() {
  const { createFile } = useFileStore();

  const handleCreateFile = async () => {
    try {
      await createFile("Untitled.md");
    } catch (error) {
      console.error("Failed to create file:", error);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl text-center space-y-8">
        <div className="space-y-4">
          <h1 className="text-4xl font-bold tracking-tight">
            Welcome to doXmind Mini
          </h1>
          <p className="text-xl text-muted-foreground">
            AI-powered writing assistant for markdown editing
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 text-left">
          <FeatureCard
            icon={<Sparkles className="w-5 h-5" />}
            title="AI Chat"
            description="Have conversations with AI about your documents"
          />
          <FeatureCard
            icon={<Zap className="w-5 h-5" />}
            title="Quick Edit"
            description="Select text and instantly improve, translate, or simplify"
          />
          <FeatureCard
            icon={<FileText className="w-5 h-5" />}
            title="Markdown Editor"
            description="Full-featured WYSIWYG editor with live preview"
          />
          <FeatureCard
            icon={<History className="w-5 h-5" />}
            title="Version History"
            description="Track changes and restore previous versions"
          />
        </div>

        <Button size="lg" onClick={handleCreateFile} className="gap-2">
          <FileText className="w-4 h-4" />
          Create New Document
        </Button>

        <p className="text-sm text-muted-foreground">
          Or select a file from the sidebar to get started
        </p>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 p-4 rounded-lg border border-border bg-card">
      <div className="text-primary">{icon}</div>
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
