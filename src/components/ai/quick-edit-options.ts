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
  label: string;
}

export interface QuickEditOption {
  id: string;
  label: string;
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
    label: "Fix Grammar",
    icon: createElement(CheckCircle, { className: "h-4 w-4" }),
  },
  {
    id: "improve",
    label: "Improve Writing",
    icon: createElement(Sparkles, { className: "h-4 w-4" }),
  },
  {
    id: "simplify",
    label: "Simplify",
    icon: createElement(FileText, { className: "h-4 w-4" }),
  },
  {
    id: "expand",
    label: "Make Longer",
    icon: createElement(ArrowUp, { className: "h-4 w-4" }),
  },
  {
    id: "shorten",
    label: "Make Shorter",
    icon: createElement(ArrowDown, { className: "h-4 w-4" }),
  },
  {
    id: "tone",
    label: "Change Tone",
    icon: createElement(MessageSquare, { className: "h-4 w-4" }),
    submenu: [
      { id: "professional", label: "Professional" },
      { id: "casual", label: "Casual" },
      { id: "friendly", label: "Friendly" },
      { id: "confident", label: "Confident" },
    ],
  },
  {
    id: "translate",
    label: "Translate",
    icon: createElement(Languages, { className: "h-4 w-4" }),
    submenu: [
      { id: "translate-en", label: "English" },
      { id: "translate-zh", label: "Chinese" },
      { id: "translate-es", label: "Spanish" },
      { id: "translate-fr", label: "French" },
      { id: "translate-de", label: "German" },
      { id: "translate-ja", label: "Japanese" },
    ],
  },
];
