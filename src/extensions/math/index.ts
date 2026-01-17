/**
 * Math Extensions for TipTap
 *
 * Provides inline and block math support with LaTeX/KaTeX rendering
 */

export { InlineMath } from "./inline-math";
export { BlockMath } from "./block-math";
export type { MathSymbol, MathNodeAttrs } from "./math-types";
export { MATH_SYMBOLS, SYMBOL_CATEGORIES } from "./math-types";
export { createMathMigrationPlugin, MathMigrationPluginKey } from "./math-migration-plugin";
