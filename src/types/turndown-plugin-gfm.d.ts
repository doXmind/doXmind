/**
 * Type declarations for turndown-plugin-gfm
 */

declare module "turndown-plugin-gfm" {
  import TurndownService from "turndown";

  /**
   * GFM (GitHub Flavored Markdown) plugin for Turndown
   * Adds support for tables, strikethrough, task lists, etc.
   */
  export function gfm(turndownService: TurndownService): void;

  /**
   * Tables plugin only
   */
  export function tables(turndownService: TurndownService): void;

  /**
   * Strikethrough plugin only
   */
  export function strikethrough(turndownService: TurndownService): void;

  /**
   * Task list items plugin only
   */
  export function taskListItems(turndownService: TurndownService): void;
}
