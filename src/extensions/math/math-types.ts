/**
 * Math Extension Types and Symbol Definitions
 */

export interface MathSymbol {
  id: string;
  name: string;
  latex: string;
  category: "common" | "greek" | "operators" | "relations" | "arrows" | "structures";
}

export interface MathNodeAttrs {
  latex: string;
  displayMode?: boolean;
}

/**
 * Common math symbols organized by category
 */
export const MATH_SYMBOLS: MathSymbol[] = [
  // Common structures
  { id: "frac", name: "Fraction", latex: "\\frac{a}{b}", category: "common" },
  { id: "sqrt", name: "Square Root", latex: "\\sqrt{x}", category: "common" },
  { id: "nthroot", name: "Nth Root", latex: "\\sqrt[n]{x}", category: "common" },
  { id: "power", name: "Power", latex: "x^{n}", category: "common" },
  { id: "subscript", name: "Subscript", latex: "x_{i}", category: "common" },
  { id: "sum", name: "Sum", latex: "\\sum_{i=1}^{n}", category: "common" },
  { id: "prod", name: "Product", latex: "\\prod_{i=1}^{n}", category: "common" },
  { id: "int", name: "Integral", latex: "\\int_{a}^{b}", category: "common" },
  { id: "lim", name: "Limit", latex: "\\lim_{x \\to \\infty}", category: "common" },
  { id: "inf", name: "Infinity", latex: "\\infty", category: "common" },

  // Greek letters (lowercase)
  { id: "alpha", name: "Alpha", latex: "\\alpha", category: "greek" },
  { id: "beta", name: "Beta", latex: "\\beta", category: "greek" },
  { id: "gamma", name: "Gamma", latex: "\\gamma", category: "greek" },
  { id: "delta", name: "Delta", latex: "\\delta", category: "greek" },
  { id: "epsilon", name: "Epsilon", latex: "\\epsilon", category: "greek" },
  { id: "zeta", name: "Zeta", latex: "\\zeta", category: "greek" },
  { id: "eta", name: "Eta", latex: "\\eta", category: "greek" },
  { id: "theta", name: "Theta", latex: "\\theta", category: "greek" },
  { id: "iota", name: "Iota", latex: "\\iota", category: "greek" },
  { id: "kappa", name: "Kappa", latex: "\\kappa", category: "greek" },
  { id: "lambda", name: "Lambda", latex: "\\lambda", category: "greek" },
  { id: "mu", name: "Mu", latex: "\\mu", category: "greek" },
  { id: "nu", name: "Nu", latex: "\\nu", category: "greek" },
  { id: "xi", name: "Xi", latex: "\\xi", category: "greek" },
  { id: "pi", name: "Pi", latex: "\\pi", category: "greek" },
  { id: "rho", name: "Rho", latex: "\\rho", category: "greek" },
  { id: "sigma", name: "Sigma", latex: "\\sigma", category: "greek" },
  { id: "tau", name: "Tau", latex: "\\tau", category: "greek" },
  { id: "upsilon", name: "Upsilon", latex: "\\upsilon", category: "greek" },
  { id: "phi", name: "Phi", latex: "\\phi", category: "greek" },
  { id: "chi", name: "Chi", latex: "\\chi", category: "greek" },
  { id: "psi", name: "Psi", latex: "\\psi", category: "greek" },
  { id: "omega", name: "Omega", latex: "\\omega", category: "greek" },

  // Greek letters (uppercase)
  { id: "Gamma", name: "Gamma (upper)", latex: "\\Gamma", category: "greek" },
  { id: "Delta", name: "Delta (upper)", latex: "\\Delta", category: "greek" },
  { id: "Theta", name: "Theta (upper)", latex: "\\Theta", category: "greek" },
  { id: "Lambda", name: "Lambda (upper)", latex: "\\Lambda", category: "greek" },
  { id: "Xi", name: "Xi (upper)", latex: "\\Xi", category: "greek" },
  { id: "Pi", name: "Pi (upper)", latex: "\\Pi", category: "greek" },
  { id: "Sigma", name: "Sigma (upper)", latex: "\\Sigma", category: "greek" },
  { id: "Phi", name: "Phi (upper)", latex: "\\Phi", category: "greek" },
  { id: "Psi", name: "Psi (upper)", latex: "\\Psi", category: "greek" },
  { id: "Omega", name: "Omega (upper)", latex: "\\Omega", category: "greek" },

  // Operators
  { id: "plus", name: "Plus", latex: "+", category: "operators" },
  { id: "minus", name: "Minus", latex: "-", category: "operators" },
  { id: "times", name: "Times", latex: "\\times", category: "operators" },
  { id: "div", name: "Division", latex: "\\div", category: "operators" },
  { id: "pm", name: "Plus-minus", latex: "\\pm", category: "operators" },
  { id: "mp", name: "Minus-plus", latex: "\\mp", category: "operators" },
  { id: "cdot", name: "Center Dot", latex: "\\cdot", category: "operators" },
  { id: "ast", name: "Asterisk", latex: "\\ast", category: "operators" },
  { id: "star", name: "Star", latex: "\\star", category: "operators" },
  { id: "circ", name: "Circle", latex: "\\circ", category: "operators" },
  { id: "bullet", name: "Bullet", latex: "\\bullet", category: "operators" },
  { id: "oplus", name: "Circle Plus", latex: "\\oplus", category: "operators" },
  { id: "otimes", name: "Circle Times", latex: "\\otimes", category: "operators" },
  { id: "nabla", name: "Nabla", latex: "\\nabla", category: "operators" },
  { id: "partial", name: "Partial", latex: "\\partial", category: "operators" },

  // Relations
  { id: "eq", name: "Equals", latex: "=", category: "relations" },
  { id: "neq", name: "Not Equal", latex: "\\neq", category: "relations" },
  { id: "approx", name: "Approximately", latex: "\\approx", category: "relations" },
  { id: "equiv", name: "Equivalent", latex: "\\equiv", category: "relations" },
  { id: "sim", name: "Similar", latex: "\\sim", category: "relations" },
  { id: "lt", name: "Less Than", latex: "<", category: "relations" },
  { id: "gt", name: "Greater Than", latex: ">", category: "relations" },
  { id: "leq", name: "Less or Equal", latex: "\\leq", category: "relations" },
  { id: "geq", name: "Greater or Equal", latex: "\\geq", category: "relations" },
  { id: "ll", name: "Much Less", latex: "\\ll", category: "relations" },
  { id: "gg", name: "Much Greater", latex: "\\gg", category: "relations" },
  { id: "subset", name: "Subset", latex: "\\subset", category: "relations" },
  { id: "supset", name: "Superset", latex: "\\supset", category: "relations" },
  { id: "subseteq", name: "Subset or Equal", latex: "\\subseteq", category: "relations" },
  { id: "supseteq", name: "Superset or Equal", latex: "\\supseteq", category: "relations" },
  { id: "in", name: "Element Of", latex: "\\in", category: "relations" },
  { id: "notin", name: "Not Element Of", latex: "\\notin", category: "relations" },
  { id: "ni", name: "Contains", latex: "\\ni", category: "relations" },
  { id: "propto", name: "Proportional", latex: "\\propto", category: "relations" },
  { id: "perp", name: "Perpendicular", latex: "\\perp", category: "relations" },

  // Arrows
  { id: "to", name: "Right Arrow", latex: "\\to", category: "arrows" },
  { id: "gets", name: "Left Arrow", latex: "\\gets", category: "arrows" },
  { id: "leftrightarrow", name: "Left-Right Arrow", latex: "\\leftrightarrow", category: "arrows" },
  { id: "Rightarrow", name: "Double Right Arrow", latex: "\\Rightarrow", category: "arrows" },
  { id: "Leftarrow", name: "Double Left Arrow", latex: "\\Leftarrow", category: "arrows" },
  { id: "Leftrightarrow", name: "Double Left-Right", latex: "\\Leftrightarrow", category: "arrows" },
  { id: "uparrow", name: "Up Arrow", latex: "\\uparrow", category: "arrows" },
  { id: "downarrow", name: "Down Arrow", latex: "\\downarrow", category: "arrows" },
  { id: "mapsto", name: "Maps To", latex: "\\mapsto", category: "arrows" },

  // Structures (brackets, matrices, etc.)
  { id: "paren", name: "Parentheses", latex: "\\left( \\right)", category: "structures" },
  { id: "bracket", name: "Brackets", latex: "\\left[ \\right]", category: "structures" },
  { id: "brace", name: "Braces", latex: "\\left\\{ \\right\\}", category: "structures" },
  { id: "abs", name: "Absolute Value", latex: "\\left| \\right|", category: "structures" },
  { id: "norm", name: "Norm", latex: "\\left\\| \\right\\|", category: "structures" },
  { id: "floor", name: "Floor", latex: "\\lfloor \\rfloor", category: "structures" },
  { id: "ceil", name: "Ceiling", latex: "\\lceil \\rceil", category: "structures" },
  { id: "vec", name: "Vector", latex: "\\vec{v}", category: "structures" },
  { id: "hat", name: "Hat", latex: "\\hat{x}", category: "structures" },
  { id: "bar", name: "Bar", latex: "\\bar{x}", category: "structures" },
  { id: "dot", name: "Dot", latex: "\\dot{x}", category: "structures" },
  { id: "ddot", name: "Double Dot", latex: "\\ddot{x}", category: "structures" },
  { id: "matrix", name: "Matrix", latex: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}", category: "structures" },
  { id: "bmatrix", name: "Bracket Matrix", latex: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}", category: "structures" },
];

export const SYMBOL_CATEGORIES = [
  { id: "common", name: "Common" },
  { id: "greek", name: "Greek" },
  { id: "operators", name: "Operators" },
  { id: "relations", name: "Relations" },
  { id: "arrows", name: "Arrows" },
  { id: "structures", name: "Structures" },
] as const;
