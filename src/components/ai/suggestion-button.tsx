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
      className="w-full text-left px-4 md:px-3 py-3 md:py-2 text-base md:text-sm rounded-lg md:rounded-md border border-border hover:bg-accent active:scale-[0.98] transition-all"
    >
      {children}
    </button>
  );
}
