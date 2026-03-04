"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Type,
  MessageSquare,
  GitCompare,
  BookOpen,
  Search,
  FolderOpen,
  Presentation,
  List,
  Settings,
  Share2,
  Keyboard,
  Zap,
  Layout,
  Home,
  ChevronDown,
  LayoutTemplate,
  ChevronRight,
  MousePointerClick,
  FileText,
  CheckCircle,
  ArrowUp,
  ArrowDown,
  Languages,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { FeatureCard } from "@/components/help/feature-card";
import { StepGuide } from "@/components/help/step-guide";
import { ShortcutCombo, ShortcutKey, useIsMac } from "@/components/help/shortcut-key";
import {
  LayoutIllustration,
  ToolbarIllustration,
  QuickEditIllustration,
  AutocompleteIllustration,
  ChatIllustration,
  DiffReviewIllustration,
  KnowledgeBaseIllustration,
  CommandPaletteIllustration,
  FileTreeIllustration,
  PresentationIllustration,
  OutlineIllustration,
  CustomizationIllustration,
  SharingIllustration,
  HomeDashboardIllustration,
} from "@/components/help/help-illustrations";

const TOC_CONFIG = [
  { id: "getting-started", labelKey: "gettingStarted" as const, icon: Layout },
  { id: "home-dashboard", labelKey: "homeDashboard" as const, icon: Home },
  { id: "editor", labelKey: "editorBasics" as const, icon: Type },
  { id: "quick-edit", labelKey: "aiQuickEdit" as const, icon: Sparkles },
  { id: "autocomplete", labelKey: "aiAutocomplete" as const, icon: Zap },
  { id: "chat", labelKey: "aiChat" as const, icon: MessageSquare },
  { id: "diff-review", labelKey: "diffReview" as const, icon: GitCompare },
  { id: "knowledge-base", labelKey: "knowledgeBase" as const, icon: BookOpen },
  { id: "search", labelKey: "searchNav" as const, icon: Search },
  { id: "documents", labelKey: "docManagement" as const, icon: FolderOpen },
  { id: "presentation", labelKey: "presentationMode" as const, icon: Presentation },
  { id: "outline", labelKey: "outlineMindlines" as const, icon: List },
  { id: "customization", labelKey: "customization" as const, icon: Settings },
  { id: "sharing", labelKey: "sharing" as const, icon: Share2 },
  { id: "shortcuts", labelKey: "keyboardShortcuts" as const, icon: Keyboard },
] as const;

function useActiveSection() {
  const [activeId, setActiveId] = useState<string>("");
  const headingIds = useRef(TOC_CONFIG.map((item) => item.id));

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Find all currently intersecting sections
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );

    const ids = headingIds.current;
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) observer.unobserve(el);
      });
    };
  }, []);

  return activeId;
}

function TocNav() {
  const [open, setOpen] = useState(false);
  const activeId = useActiveSection();
  const t = useTranslations("help");

  return (
    <>
      {/* Desktop: sticky sidebar */}
      <nav className="fixed right-8 top-24 hidden w-48 xl:block" aria-label={t("tableOfContents")}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("onThisPage")}
        </p>
        <ul className="space-y-1">
          {TOC_CONFIG.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                  activeId === item.id
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="h-3 w-3 shrink-0" />
                {t(item.labelKey)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* Mobile: collapsible dropdown */}
      <div className="sticky top-0 z-30 mb-8 border-b border-border bg-background/80 backdrop-blur-sm xl:hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          <span className="flex items-center gap-2">
            <List className="h-4 w-4" />
            {activeId
              ? TOC_CONFIG.find((item) => item.id === activeId)
                ? t(TOC_CONFIG.find((item) => item.id === activeId)!.labelKey)
                : t("tableOfContents")
              : t("tableOfContents")}
          </span>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {open && (
          <ul className="max-h-60 overflow-y-auto border-t border-border px-4 pb-3 pt-2">
            {TOC_CONFIG.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs",
                    activeId === item.id
                      ? "font-medium text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <item.icon className="h-3 w-3 shrink-0" />
                  {t(item.labelKey)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function SectionHeading({
  id,
  icon: Icon,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <h2 id={id} className="mb-4 flex scroll-mt-20 items-center gap-3 text-2xl font-bold">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      {children}
    </h2>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  const t = useTranslations("help");
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
      <span className="mr-2 font-semibold text-primary">{t("tipLabel")}</span>
      {children}
    </div>
  );
}

export default function HelpPage() {
  const isMac = useIsMac();
  const t = useTranslations("help");

  const rich = {
    b: (chunks: ReactNode) => <strong className="text-foreground">{chunks}</strong>,
    code: (chunks: ReactNode) => (
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{chunks}</code>
    ),
  };

  return (
    <div className="min-h-screen bg-background">
      <TocNav />

      <div className="mx-auto max-w-4xl px-4 py-12 xl:pr-56">
        {/* Header */}
        <div className="mb-8">
          <Link href="/" className="inline-block">
            <Logo size="md" />
          </Link>
        </div>

        <h1 className="mb-2 text-3xl font-bold">{t("pageTitle")}</h1>
        <p className="mb-12 text-muted-foreground">{t("pageSubtitle")}</p>

        <div className="space-y-16">
          {/* ─── 1. Getting Started ──────────────────────────────────────── */}
          <section>
            <SectionHeading id="getting-started" icon={Layout}>
              {t("gettingStarted")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              {t.rich("gettingStartedIntro", rich)}
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <LayoutIllustration />
            </div>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                {t.rich("createFirstDocDesc", {
                  ...rich,
                  ctrlK: () => <ShortcutCombo keys={["Ctrl", "K"]} />,
                })}
              </p>
              <p>{t.rich("onboardingTourDesc", rich)}</p>
            </div>
          </section>

          {/* ─── Home Dashboard ─────────────────────────────────────────── */}
          <section>
            <SectionHeading id="home-dashboard" icon={Home}>
              {t("homeDashboard")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">{t("homeDashboardIntro")}</p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <HomeDashboardIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("searchAskAI")}</h3>
            <div className="mb-6 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t("searchBarIntro")}</p>
              <p>
                {t.rich("askAIMode", {
                  ...rich,
                  enter: () => <ShortcutKey>Enter</ShortcutKey>,
                })}
              </p>
              <p>{t.rich("searchMode", rich)}</p>
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("recentFavorites")}</h3>
            <div className="mb-6 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("continueWriting", rich)}</p>
              <p>{t.rich("favorites", rich)}</p>
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("creatingDocuments")}</h3>
            <div className="mb-6 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t("creatingDocumentsIntro")}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-border px-3 py-2.5">
                  <p className="text-sm font-medium text-foreground">{t("newDocument")}</p>
                  <p className="text-xs">{t("newDocumentDesc")}</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-2.5">
                  <p className="text-sm font-medium text-foreground">{t("newFolder")}</p>
                  <p className="text-xs">{t("newFolderDesc")}</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-2.5">
                  <p className="text-sm font-medium text-foreground">{t("fromTemplate")}</p>
                  <p className="text-xs">{t("fromTemplateDesc")}</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-2.5">
                  <p className="text-sm font-medium text-foreground">{t("importFile")}</p>
                  <p className="text-xs">{t("importFileDesc")}</p>
                </div>
              </div>
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("fileActions")}</h3>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t("fileActionsIntro")}</p>
              <ul className="ml-4 list-disc space-y-1">
                <li>{t.rich("fileActionRename", rich)}</li>
                <li>{t.rich("fileActionShare", rich)}</li>
                <li>{t.rich("fileActionFavorite", rich)}</li>
                <li>{t.rich("fileActionExport", rich)}</li>
                <li>{t.rich("fileActionDelete", rich)}</li>
              </ul>
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("viewSort")}</h3>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("gridListView", rich)}</p>
              <p>{t.rich("sort", rich)}</p>
              <p>{t.rich("dragDrop", rich)}</p>
            </div>
          </section>

          {/* ─── 2. Editor Basics ────────────────────────────────────────── */}
          <section>
            <SectionHeading id="editor" icon={Type}>
              {t("editorBasics")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">{t("editorBasicsIntro")}</p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <ToolbarIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("textFormatting")}</h3>
            <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { label: t("bold"), keys: ["Ctrl", "B"] },
                { label: t("italic"), keys: ["Ctrl", "I"] },
                { label: t("underline"), keys: ["Ctrl", "U"] },
                { label: t("strikethrough"), keys: ["Ctrl", "Shift", "S"] },
                { label: t("highlight"), keys: ["Ctrl", "Shift", "H"] },
                { label: t("inlineCode"), keys: ["Ctrl", "E"] },
                { label: t("addLink"), keys: ["Ctrl", "K"] },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <span className="text-sm">{item.label}</span>
                  <ShortcutCombo keys={item.keys} />
                </div>
              ))}
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("blockTypes")}</h3>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                {t.rich("headingsDesc", {
                  ...rich,
                  ctrlAlt1: () => <ShortcutCombo keys={["Ctrl", "Alt", "1"]} />,
                  key2: () => <ShortcutKey>2</ShortcutKey>,
                  key3: () => <ShortcutKey>3</ShortcutKey>,
                })}
              </p>
              <p>
                {t.rich("listsDesc", {
                  ...rich,
                  ctrlShift8: () => <ShortcutCombo keys={["Ctrl", "Shift", "8"]} />,
                  ctrlShift7: () => <ShortcutCombo keys={["Ctrl", "Shift", "7"]} />,
                  ctrlShift9: () => <ShortcutCombo keys={["Ctrl", "Shift", "9"]} />,
                })}
              </p>
              <p>{t.rich("codeBlocksDesc", rich)}</p>
              <p>{t.rich("mathBlocksDesc", rich)}</p>
              <p>{t.rich("tablesDesc", rich)}</p>
              <p>{t.rich("otherBlocksDesc", rich)}</p>
            </div>

            <Tip>{t.rich("slashCommandTip", rich)}</Tip>
          </section>

          {/* ─── 3. AI Quick Edit ────────────────────────────────────────── */}
          <section>
            <SectionHeading id="quick-edit" icon={Sparkles}>
              {t("aiQuickEdit")}
            </SectionHeading>
            <p className="mb-4 leading-relaxed text-muted-foreground">{t("aiQuickEditIntro")}</p>

            <StepGuide
              steps={[
                { label: t("stepSelectText"), icon: <MousePointerClick className="h-4 w-4" /> },
                { label: t("stepMenuAppears"), icon: <Sparkles className="h-4 w-4" /> },
                { label: t("stepChooseAction"), icon: <CheckCircle className="h-4 w-4" /> },
                { label: t("stepReviewDiff"), icon: <GitCompare className="h-4 w-4" /> },
              ]}
            />

            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <QuickEditIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("availableActions")}</h3>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                {
                  icon: <CheckCircle className="h-4 w-4" />,
                  label: t("fixGrammar"),
                  desc: t("fixGrammarDesc"),
                },
                {
                  icon: <Sparkles className="h-4 w-4" />,
                  label: t("improveWriting"),
                  desc: t("improveWritingDesc"),
                },
                {
                  icon: <FileText className="h-4 w-4" />,
                  label: t("simplify"),
                  desc: t("simplifyDesc"),
                },
                {
                  icon: <ArrowUp className="h-4 w-4" />,
                  label: t("makeLonger"),
                  desc: t("makeLongerDesc"),
                },
                {
                  icon: <ArrowDown className="h-4 w-4" />,
                  label: t("makeShorter"),
                  desc: t("makeShorterDesc"),
                },
                {
                  icon: <MessageSquare className="h-4 w-4" />,
                  label: t("changeTone"),
                  desc: t("changeToneDesc"),
                },
                {
                  icon: <Languages className="h-4 w-4" />,
                  label: t("translate"),
                  desc: t("translateDesc"),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
                >
                  <div className="mt-0.5 text-primary">{item.icon}</div>
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <Tip>{t.rich("askInChatTip", rich)}</Tip>
          </section>

          {/* ─── 4. AI Autocomplete ──────────────────────────────────────── */}
          <section>
            <SectionHeading id="autocomplete" icon={Zap}>
              {t("aiAutocomplete")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">{t("aiAutocompleteIntro")}</p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <AutocompleteIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("howToUse")}</h3>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                {t.rich("autoTriggerDesc", {
                  ...rich,
                  tab: () => <ShortcutKey>Tab</ShortcutKey>,
                  esc: () => <ShortcutKey>Esc</ShortcutKey>,
                })}
              </p>
              <p>
                {t.rich("manualTriggerDesc", {
                  ...rich,
                  altSlash: () => <ShortcutCombo keys={["Alt", "/"]} />,
                })}
              </p>
              <p>
                {t.rich("longModeDesc", {
                  ...rich,
                  ctrlShiftSpace: () => <ShortcutCombo keys={["Ctrl", "Shift", "Space"]} />,
                })}
              </p>
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("autocompleteModes")}</h3>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                { mode: t("adaptiveMode"), desc: t("adaptiveModeDesc") },
                { mode: t("shortMode"), desc: t("shortModeDesc") },
                { mode: t("longMode"), desc: t("longModeDesc") },
              ].map((item) => (
                <div
                  key={item.mode}
                  className="rounded-lg border border-border px-3 py-2.5 text-center"
                >
                  <p className="text-sm font-medium">{item.mode}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>

            <Tip>{t("autocompleteTip")}</Tip>
          </section>

          {/* ─── 5. AI Chat ──────────────────────────────────────────────── */}
          <section>
            <SectionHeading id="chat" icon={MessageSquare}>
              {t("aiChat")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">{t("aiChatIntro")}</p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <ChatIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("chatModes")}</h3>
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="text-sm font-medium">{t("sidebarMode")}</p>
                <p className="text-xs text-muted-foreground">{t("sidebarModeDesc")}</p>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="text-sm font-medium">{t("floatingMode")}</p>
                <p className="text-xs text-muted-foreground">{t("floatingModeDesc")}</p>
              </div>
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("chatFeatures")}</h3>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                {t.rich("sendMessagesDesc", {
                  ...rich,
                  enter: () => <ShortcutKey>Enter</ShortcutKey>,
                  shiftEnter: () => <ShortcutCombo keys={["Shift", "Enter"]} />,
                })}
              </p>
              <p>{t.rich("voiceInputDesc", rich)}</p>
              <p>{t.rich("imageAttachmentsDesc", rich)}</p>
              <p>{t.rich("quickSuggestionsDesc", rich)}</p>
              <p>{t.rich("documentEditingDesc", rich)}</p>
              <p>{t.rich("extendedThinkingDesc", rich)}</p>
            </div>
          </section>

          {/* ─── 6. Diff Review ──────────────────────────────────────────── */}
          <section>
            <SectionHeading id="diff-review" icon={GitCompare}>
              {t("diffReview")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">{t("diffReviewIntro")}</p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <DiffReviewIllustration />
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("acceptRejectIndividually", rich)}</p>
              <p>{t.rich("bulkActions", rich)}</p>
              <p>{t.rich("versionSnapshots", rich)}</p>
            </div>
          </section>

          {/* ─── 7. Knowledge Base ───────────────────────────────────────── */}
          <section>
            <SectionHeading id="knowledge-base" icon={BookOpen}>
              {t("knowledgeBase")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">{t("knowledgeBaseIntro")}</p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <KnowledgeBaseIllustration />
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("supportedFormats", rich)}</p>
              <p>{t.rich("processing", rich)}</p>
              <p>{t.rich("howItWorks", rich)}</p>
              <p>{t.rich("perConversation", rich)}</p>
            </div>
          </section>

          {/* ─── 8. Search & Navigation ──────────────────────────────────── */}
          <section>
            <SectionHeading id="search" icon={Search}>
              {t("searchNav")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">{t("searchNavIntro")}</p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <CommandPaletteIllustration />
            </div>

            <div className="space-y-4">
              <FeatureCard
                icon={<Search className="h-5 w-5" />}
                title={t("semanticSearch")}
                className="border-0 bg-transparent p-0"
              >
                <p>
                  {t.rich("semanticSearchDesc", {
                    ...rich,
                    ctrlShiftF: () => <ShortcutCombo keys={["Ctrl", "Shift", "F"]} />,
                  })}
                </p>
              </FeatureCard>

              <FeatureCard
                icon={<Search className="h-5 w-5" />}
                title={t("findReplace")}
                className="border-0 bg-transparent p-0"
              >
                <p>
                  {t.rich("findReplaceDesc", {
                    ...rich,
                    ctrlF: () => <ShortcutCombo keys={["Ctrl", "F"]} />,
                    enter: () => <ShortcutKey>Enter</ShortcutKey>,
                    shiftEnter: () => <ShortcutCombo keys={["Shift", "Enter"]} />,
                  })}
                </p>
              </FeatureCard>

              <FeatureCard
                icon={<Zap className="h-5 w-5" />}
                title={t("commandPalette")}
                className="border-0 bg-transparent p-0"
              >
                <p>
                  {t.rich("commandPaletteDesc", {
                    ...rich,
                    ctrlK: () => <ShortcutCombo keys={["Ctrl", "K"]} />,
                  })}
                </p>
              </FeatureCard>

              <FeatureCard
                icon={<FolderOpen className="h-5 w-5" />}
                title={t("quickFileSwitcher")}
                className="border-0 bg-transparent p-0"
              >
                <p>
                  {t.rich("quickFileSwitcherDesc", {
                    ...rich,
                    ctrlTab: () => <ShortcutCombo keys={["Ctrl", "Tab"]} />,
                  })}
                </p>
              </FeatureCard>
            </div>
          </section>

          {/* ─── 9. Document Management ──────────────────────────────────── */}
          <section>
            <SectionHeading id="documents" icon={FolderOpen}>
              {t("docManagement")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">{t("docManagementIntro")}</p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <FileTreeIllustration />
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("organization")}</h3>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("foldersDesc", rich)}</p>
              <p>{t.rich("bulkActionsDoc", rich)}</p>
              <p>{t.rich("trashDesc", rich)}</p>
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("importTemplates")}</h3>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("importDesc", rich)}</p>
              <p>{t.rich("templatesDesc", rich)}</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-border px-3 py-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary" /> {t("welcomeTutorial")}
                  </p>
                  <p className="text-xs">{t("welcomeTutorialDesc")}</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <FileText className="h-3.5 w-3.5 text-primary" /> {t("blankDocument")}
                  </p>
                  <p className="text-xs">{t("blankDocumentDesc")}</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <LayoutTemplate className="h-3.5 w-3.5 text-primary" /> {t("blogPost")}
                  </p>
                  <p className="text-xs">{t("blogPostDesc")}</p>
                </div>
                <div className="rounded-lg border border-border px-3 py-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <FileText className="h-3.5 w-3.5 text-primary" /> {t("meetingNotes")}
                  </p>
                  <p className="text-xs">{t("meetingNotesDesc")}</p>
                </div>
              </div>
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("versionHistory")}</h3>
            <div className="mb-4 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t("versionHistoryDesc")}</p>
              <p>{t.rich("versionHistoryRestore", rich)}</p>
            </div>

            <h3 className="mb-3 text-lg font-semibold">{t("export")}</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { format: t("markdown"), ext: t("markdownExt") },
                { format: t("pdf"), ext: t("pdfExt") },
                { format: t("word"), ext: t("wordExt") },
              ].map((item) => (
                <div
                  key={item.format}
                  className="flex flex-col items-center rounded-lg border border-border px-3 py-3"
                >
                  <p className="text-sm font-medium">{item.format}</p>
                  <p className="text-xs text-muted-foreground">{item.ext}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ─── 10. Presentation Mode ───────────────────────────────────── */}
          <section>
            <SectionHeading id="presentation" icon={Presentation}>
              {t("presentationMode")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              {t("presentationModeIntro")}
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <PresentationIllustration />
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                {t.rich("activate", {
                  ...rich,
                  f5: () => <ShortcutKey>F5</ShortcutKey>,
                })}
              </p>
              <p>{t.rich("slideSplitting", rich)}</p>
              <p>
                {t.rich("navigate", {
                  ...rich,
                  leftArrow: () => <ShortcutKey>←</ShortcutKey>,
                  rightArrow: () => <ShortcutKey>→</ShortcutKey>,
                })}
              </p>
              <p>
                {t.rich("exit", {
                  ...rich,
                  esc: () => <ShortcutKey>Esc</ShortcutKey>,
                })}
              </p>
            </div>

            <Tip>{t.rich("presentationTip", rich)}</Tip>
          </section>

          {/* ─── 11. Outline & Mindlines ─────────────────────────────────── */}
          <section>
            <SectionHeading id="outline" icon={List}>
              {t("outlineMindlines")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              {t("outlineMindlinesIntro")}
            </p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <OutlineIllustration />
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>
                {t.rich("outlineSidebar", {
                  ...rich,
                  ctrlShiftO: () => <ShortcutCombo keys={["Ctrl", "Shift", "O"]} />,
                })}
              </p>
              <p>{t.rich("mindlines", rich)}</p>
            </div>
          </section>

          {/* ─── 12. Customization ───────────────────────────────────────── */}
          <section>
            <SectionHeading id="customization" icon={Settings}>
              {t("customization")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">{t("customizationIntro")}</p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <CustomizationIllustration />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="mb-1 text-sm font-medium">{t("typography")}</p>
                <p className="text-xs text-muted-foreground">{t("typographyDesc")}</p>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="mb-1 text-sm font-medium">{t("editorWidth")}</p>
                <p className="text-xs text-muted-foreground">{t("editorWidthDesc")}</p>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="mb-1 text-sm font-medium">{t("themes")}</p>
                <p className="text-xs text-muted-foreground">{t("themesDesc")}</p>
              </div>
              <div className="rounded-lg border border-border px-4 py-3">
                <p className="mb-1 text-sm font-medium">{t("spellcheck")}</p>
                <p className="text-xs text-muted-foreground">{t("spellcheckDesc")}</p>
              </div>
            </div>
          </section>

          {/* ─── 13. Sharing ─────────────────────────────────────────────── */}
          <section>
            <SectionHeading id="sharing" icon={Share2}>
              {t("sharing")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">{t("sharingIntro")}</p>
            <div className="mb-6 flex justify-center rounded-lg bg-muted/50 p-6">
              <SharingIllustration />
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <p>{t.rich("generateLink", rich)}</p>
              <p>{t.rich("viewerExperience", rich)}</p>
            </div>
          </section>

          {/* ─── 14. Keyboard Shortcuts ──────────────────────────────────── */}
          <section>
            <SectionHeading id="shortcuts" icon={Keyboard}>
              {t("keyboardShortcuts")}
            </SectionHeading>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              {t.rich("keyboardShortcutsIntro", {
                ...rich,
                ctrlQuestion: () => <ShortcutCombo keys={["Ctrl", "?"]} />,
              })}
              {isMac ? t("showingMacKeys") : t("showingWinKeys")}
            </p>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Text Formatting */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  {t("textFormattingGroup")}
                </h3>
                <div className="space-y-2">
                  {[
                    { keys: ["Ctrl", "B"], desc: t("shortcutBold") },
                    { keys: ["Ctrl", "I"], desc: t("shortcutItalic") },
                    { keys: ["Ctrl", "U"], desc: t("shortcutUnderline") },
                    { keys: ["Ctrl", "Shift", "S"], desc: t("shortcutStrikethrough") },
                    { keys: ["Ctrl", "E"], desc: t("shortcutInlineCode") },
                    { keys: ["Ctrl", "Shift", "H"], desc: t("shortcutHighlight") },
                    { keys: ["Ctrl", "K"], desc: t("shortcutAddLink") },
                  ].map((s) => (
                    <div key={s.desc} className="flex items-center justify-between py-1">
                      <span className="text-sm">{s.desc}</span>
                      <ShortcutCombo keys={s.keys} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Headings & Blocks */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  {t("headingsBlocksGroup")}
                </h3>
                <div className="space-y-2">
                  {[
                    { keys: ["Ctrl", "Alt", "1"], desc: t("heading1") },
                    { keys: ["Ctrl", "Alt", "2"], desc: t("heading2") },
                    { keys: ["Ctrl", "Alt", "3"], desc: t("heading3") },
                    { keys: ["Ctrl", "Shift", "8"], desc: t("bulletList") },
                    { keys: ["Ctrl", "Shift", "7"], desc: t("numberedList") },
                    { keys: ["Ctrl", "Shift", "9"], desc: t("taskList") },
                  ].map((s) => (
                    <div key={s.desc} className="flex items-center justify-between py-1">
                      <span className="text-sm">{s.desc}</span>
                      <ShortcutCombo keys={s.keys} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Navigation & View */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  {t("navigationViewGroup")}
                </h3>
                <div className="space-y-2">
                  {[
                    { keys: ["Ctrl", "K"], desc: t("commandPaletteShortcut") },
                    { keys: ["Ctrl", "F"], desc: t("findInDocument") },
                    { keys: ["Ctrl", "Shift", "F"], desc: t("semanticSearchShortcut") },
                    { keys: ["Ctrl", "Shift", "O"], desc: t("toggleOutline") },
                    { keys: ["Ctrl", "Tab"], desc: t("quickFileSwitcherShortcut") },
                    { keys: ["Ctrl", "?"], desc: t("keyboardShortcutsShortcut") },
                  ].map((s) => (
                    <div key={s.desc} className="flex items-center justify-between py-1">
                      <span className="text-sm">{s.desc}</span>
                      <ShortcutCombo keys={s.keys} />
                    </div>
                  ))}
                </div>
              </div>

              {/* AI & Editing */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  {t("aiEditingGroup")}
                </h3>
                <div className="space-y-2">
                  {[
                    { keys: ["Alt", "/"], desc: t("triggerAutocomplete") },
                    { keys: ["Ctrl", "Shift", "Space"], desc: t("forceLongAutocomplete") },
                    { keys: ["Ctrl", "Z"], desc: t("undo") },
                    { keys: ["Ctrl", "Y"], desc: t("redo") },
                  ].map((s) => (
                    <div key={s.desc} className="flex items-center justify-between py-1">
                      <span className="text-sm">{s.desc}</span>
                      <ShortcutCombo keys={s.keys} />
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">{t("acceptAutocomplete")}</span>
                    <ShortcutKey>Tab</ShortcutKey>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">{t("showQuickEditMenu")}</span>
                    <span className="text-xs text-muted-foreground">{t("selectText")}</span>
                  </div>
                </div>
              </div>

              {/* Chat */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  {t("chatGroup")}
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">{t("sendMessage")}</span>
                    <ShortcutKey>Enter</ShortcutKey>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">{t("newLineInChat")}</span>
                    <ShortcutCombo keys={["Shift", "Enter"]} />
                  </div>
                </div>
              </div>

              {/* Presentation */}
              <div>
                <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                  {t("presentationGroup")}
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">{t("startPresentation")}</span>
                    <ShortcutKey>F5</ShortcutKey>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">{t("navigateSlides")}</span>
                    <span className="inline-flex gap-1">
                      <ShortcutKey>←</ShortcutKey>
                      <ShortcutKey>→</ShortcutKey>
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span className="text-sm">{t("exitPresentation")}</span>
                    <ShortcutKey>Esc</ShortcutKey>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-16 border-t border-border pt-8">
          <Link href="/" className="text-primary hover:underline">
            {t("backToHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}
