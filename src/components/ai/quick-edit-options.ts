import {
  CheckCircle,
  Sparkles,
  FileText,
  ArrowUp,
  ArrowDown,
  MessageSquare,
  Languages,
} from "lucide-react";
import { createElement } from "react";

export interface QuickEditSubmenuItem {
  id: string;
  labelKey: string;
}

export interface QuickEditOption {
  id: string;
  labelKey: string;
  icon: React.ReactNode;
  submenu?: QuickEditSubmenuItem[];
}

/**
 * Quick edit menu options configuration.
 * Defines all available AI quick edit actions.
 */
export const QUICK_EDIT_OPTIONS: QuickEditOption[] = [
  {
    id: "fix-grammar",
    labelKey: "fixGrammar",
    icon: createElement(CheckCircle, { className: "h-4 w-4" }),
  },
  {
    id: "improve",
    labelKey: "improveWriting",
    icon: createElement(Sparkles, { className: "h-4 w-4" }),
  },
  {
    id: "simplify",
    labelKey: "simplify",
    icon: createElement(FileText, { className: "h-4 w-4" }),
  },
  {
    id: "expand",
    labelKey: "makeLonger",
    icon: createElement(ArrowUp, { className: "h-4 w-4" }),
  },
  {
    id: "shorten",
    labelKey: "makeShorter",
    icon: createElement(ArrowDown, { className: "h-4 w-4" }),
  },
  {
    id: "tone",
    labelKey: "changeTone",
    icon: createElement(MessageSquare, { className: "h-4 w-4" }),
    submenu: [
      { id: "professional", labelKey: "professional" },
      { id: "casual", labelKey: "casual" },
      { id: "friendly", labelKey: "friendly" },
      { id: "confident", labelKey: "confident" },
    ],
  },
  {
    id: "translate",
    labelKey: "translate",
    icon: createElement(Languages, { className: "h-4 w-4" }),
    submenu: [
      { id: "translate-en", labelKey: "english" },
      { id: "translate-zh", labelKey: "chinese" },
      { id: "translate-es", labelKey: "spanish" },
      { id: "translate-fr", labelKey: "french" },
      { id: "translate-de", labelKey: "german" },
      { id: "translate-ja", labelKey: "japanese" },
    ],
  },
];
