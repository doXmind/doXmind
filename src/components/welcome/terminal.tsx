"use client";

import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";

import {
  formatRelativeTime,
  type WelcomeRecentFile,
  type WelcomeVariantProps,
} from "@/components/welcome/types";

const SHELL_PATH_PREFIX = "~";

function formatHeaderTimestamp(now: Date): string {
  const day = now.toLocaleDateString(undefined, { weekday: "long" }).toLowerCase();
  const time = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${day} ${time}`;
}

function shortenPath(absolutePath: string): string {
  const home = typeof process !== "undefined" ? process.env.HOME : undefined;
  if (home && absolutePath.startsWith(home)) {
    return `${SHELL_PATH_PREFIX}${absolutePath.slice(home.length)}`;
  }
  return absolutePath;
}

function rowDirectory(file: WelcomeRecentFile): string {
  const idx = file.absolutePath.lastIndexOf("/");
  if (idx <= 0) return shortenPath(file.absolutePath);
  return shortenPath(file.absolutePath.slice(0, idx));
}

export function TerminalWelcome({
  recentFiles,
  recentWorkspaces,
  onOpenRecentFile,
  onOpenRecentWorkspace,
}: WelcomeVariantProps) {
  const t = useTranslations("welcome");
  const hero = recentFiles[0];
  const rows = recentFiles.slice(0, 8);

  const headerTimestamp = useMemo(() => formatHeaderTimestamp(new Date()), []);
  const docCount = recentFiles.length;

  const lastEdit = hero ? formatRelativeTime(hero.lastOpened) : null;

  useEffect(() => {
    if (!hero) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        onOpenRecentFile(hero);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hero, onOpenRecentFile]);

  return (
    // The terminal variant is intentionally locked to a dark zinc palette so
    // the shell aesthetic survives in light mode; this is the only place a
    // raw color literal is allowed for this variant.
    <div className="flex h-full flex-col bg-zinc-950 px-9 pt-6 font-mono text-[13.5px] text-zinc-100">
      <style>{`@keyframes dxBlink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }`}</style>

      <div className="mb-5 flex items-center justify-between text-[10.5px] uppercase tracking-[0.18em] text-zinc-500">
        <span>~ doxmind / session — {headerTimestamp}</span>
        <span>{docCount} docs</span>
      </div>

      <div className="mb-3.5 leading-[1.7] text-zinc-500">
        <div>
          <span className="text-zinc-500">$</span>{" "}
          <span className="text-zinc-400">doxmind status</span>
        </div>
        <div>
          {"  "}
          {docCount} {docCount === 1 ? "doc" : "docs"} tracked
          {lastEdit ? (
            <>
              {" · last edit "}
              <span className="text-amber-400">{lastEdit}</span>
            </>
          ) : (
            " · last edit —"
          )}
          {" · 0 conflicts"}
        </div>
        <div>
          {"  "}external folder watcher: <span className="text-emerald-400">ok</span>
        </div>
      </div>

      {hero ? (
        <button
          type="button"
          onClick={() => onOpenRecentFile(hero)}
          className="group cursor-pointer text-left"
        >
          <div className="mb-1 flex items-baseline gap-3">
            <span className="text-[19px] font-medium text-amber-400">{">"}</span>
            <span className="text-[19px] text-zinc-400">resume</span>
            <span className="font-sans text-[20px] font-medium tracking-tight text-zinc-50">
              {hero.name}
            </span>
            <span
              aria-hidden
              className="ml-0.5 inline-block h-[22px] w-[9px] bg-zinc-50"
              style={{ animation: "dxBlink 1.05s steps(2) infinite" }}
            />
          </div>
          <div className="mb-6 ml-7 flex gap-4 text-xs text-zinc-500">
            <span>{shortenPath(hero.absolutePath)}</span>
            <span>·</span>
            <span>{hero.wordCount.toLocaleString()}w</span>
            <span>·</span>
            <span>{hero.editCount} edits</span>
            <span>·</span>
            <span>{formatRelativeTime(hero.lastOpened)}</span>
          </div>
        </button>
      ) : (
        <div className="mb-6">
          <div className="mb-1 flex items-baseline gap-3">
            <span className="text-[19px] font-medium text-amber-400">{">"}</span>
            <span className="text-[19px] text-zinc-400">resume</span>
            <span className="font-sans text-[20px] font-medium tracking-tight text-zinc-500">
              no recent file
            </span>
            <span
              aria-hidden
              className="ml-0.5 inline-block h-[22px] w-[9px] bg-zinc-50"
              style={{ animation: "dxBlink 1.05s steps(2) infinite" }}
            />
          </div>
          <div className="ml-7 text-xs text-zinc-500">type a command or pick a workspace below</div>
        </div>
      )}

      <div className="flex-1 overflow-hidden border-t border-dashed border-zinc-800 pt-4">
        {rows.length > 0 ? (
          <>
            <div
              className="mb-2.5 grid gap-3.5 text-[10.5px] uppercase tracking-[0.18em] text-zinc-500"
              style={{ gridTemplateColumns: "32px 1fr 220px 70px 70px 100px" }}
            >
              <span>#</span>
              <span>name</span>
              <span>path</span>
              <span className="text-right">words</span>
              <span className="text-right">edits</span>
              <span className="text-right">last</span>
            </div>
            {rows.map((row, i) => {
              const selected = i === 0;
              return (
                <button
                  key={row.absolutePath}
                  type="button"
                  onClick={() => onOpenRecentFile(row)}
                  className={`grid w-full gap-3.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-zinc-900 ${
                    selected
                      ? "border-l-2 border-amber-400 bg-amber-400/10 pl-2"
                      : "border-l-2 border-transparent"
                  }`}
                  style={{ gridTemplateColumns: "32px 1fr 220px 70px 70px 100px" }}
                >
                  <span className="text-zinc-600">{String(i).padStart(2, "0")}</span>
                  <span
                    className={`overflow-hidden text-ellipsis whitespace-nowrap font-sans ${
                      selected ? "font-medium text-zinc-50" : "text-zinc-300"
                    }`}
                  >
                    {row.name}
                  </span>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-zinc-500">
                    {rowDirectory(row)}
                  </span>
                  <span className="text-right text-zinc-400">{row.wordCount.toLocaleString()}</span>
                  <span className="text-right text-zinc-400">{row.editCount}</span>
                  <span className="text-right text-zinc-500">
                    {formatRelativeTime(row.lastOpened)}
                  </span>
                </button>
              );
            })}
          </>
        ) : (
          <div className="space-y-3">
            <div className="text-zinc-500">
              <span className="text-zinc-600">$</span> history
            </div>
            <div className="ml-2 text-zinc-500">no history yet</div>
            {recentWorkspaces.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 text-[10.5px] uppercase tracking-[0.18em] text-zinc-500">
                  {t("recentWorkspaces")}
                </div>
                {recentWorkspaces.slice(0, 8).map((ws) => (
                  <button
                    key={ws.path}
                    type="button"
                    onClick={() => onOpenRecentWorkspace(ws.path)}
                    className="flex w-full gap-3 py-1.5 text-left text-[12.5px] text-zinc-300 hover:bg-zinc-900"
                  >
                    <span className="text-zinc-600">~</span>
                    <span className="font-sans">{ws.name}</span>
                    <span className="text-zinc-500">{ws.parent}</span>
                  </button>
                ))}
              </div>
            )}
            {recentWorkspaces.length === 0 && (
              <div className="ml-2 text-zinc-600">{t("noRecentWorkspaces")}</div>
            )}
          </div>
        )}
      </div>

      <div className="-mx-9 mt-3 flex items-center gap-4 border-t border-zinc-100/[0.08] bg-zinc-950 px-9 py-2 text-[11.5px] text-zinc-100">
        <span className="bg-amber-400 px-2 py-px font-semibold tracking-[0.08em] text-zinc-950">
          NORMAL
        </span>
        <span className="text-zinc-400">:resume {hero ? hero.name : ""}</span>
        <div className="flex-1" />
        <span className="text-zinc-500">↵ run</span>
        <span className="text-zinc-500">⌘N new</span>
        <span className="text-zinc-500">⌘O open</span>
        <span className="text-zinc-500">⌘K palette</span>
        <span className="text-zinc-500">esc</span>
      </div>
    </div>
  );
}

export default TerminalWelcome;
