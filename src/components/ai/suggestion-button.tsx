"use client";

interface SuggestionButtonProps {
  children: React.ReactNode;
  onClick: () => void;
}

/**
 * Suggestion button for quick prompts in the empty chat state.
 */
export function SuggestionButton({ children, onClick }: SuggestionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-border px-4 py-3 text-left text-base transition-all hover:bg-accent active:scale-[0.98] md:rounded-md md:px-3 md:py-2 md:text-sm"
    >
      {children}
    </button>
  );
}
