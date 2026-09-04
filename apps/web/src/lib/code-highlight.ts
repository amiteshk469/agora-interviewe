/**
 * A small syntax tokenizer for the shared interview editor.
 *
 * The room already ships a large Agora bundle, and a full editor library would
 * add more weight than a coding round needs: the candidate types, the panel
 * reads. So this covers exactly what makes code legible on screen — comments,
 * strings, numbers, and keywords — for the languages the role packs interview
 * in, and nothing else.
 *
 * Tokens are rendered as React elements, never as HTML, so nothing the
 * candidate types can escape into the page.
 */

export type TokenKind = "comment" | "string" | "number" | "keyword" | "plain";

export type Token = {
  text: string;
  kind: TokenKind;
};

type LanguageRules = {
  label: string;
  lineComments: string[];
  blockComment?: readonly [string, string];
  quotes: string[];
  keywords: readonly string[];
};

const C_FAMILY_QUOTES = ['"', "'"];

const RULES: Record<string, LanguageRules> = {
  python: {
    label: "Python",
    lineComments: ["#"],
    quotes: ['"', "'"],
    keywords: [
      "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
      "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is",
      "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while",
      "with", "yield", "self", "match", "case",
    ],
  },
  javascript: {
    label: "JavaScript",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    keywords: [
      "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "delete",
      "do", "else", "export", "extends", "false", "finally", "for", "function", "if", "import", "in",
      "instanceof", "let", "new", "null", "of", "return", "static", "super", "switch", "this",
      "throw", "true", "try", "typeof", "undefined", "var", "void", "while", "yield",
    ],
  },
  typescript: {
    label: "TypeScript",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    keywords: [
      "any", "as", "async", "await", "boolean", "break", "case", "catch", "class", "const",
      "continue", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally",
      "for", "function", "if", "implements", "import", "in", "instanceof", "interface", "let", "new",
      "null", "number", "of", "private", "protected", "public", "readonly", "return", "static",
      "string", "super", "switch", "this", "throw", "true", "try", "type", "typeof", "undefined",
      "unknown", "var", "void", "while", "yield",
    ],
  },
  java: {
    label: "Java",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: C_FAMILY_QUOTES,
    keywords: [
      "abstract", "boolean", "break", "byte", "case", "catch", "char", "class", "continue",
      "default", "do", "double", "else", "enum", "extends", "final", "finally", "float", "for",
      "if", "implements", "import", "instanceof", "int", "interface", "long", "new", "null",
      "package", "private", "protected", "public", "return", "short", "static", "super", "switch",
      "this", "throw", "throws", "true", "false", "try", "void", "while",
    ],
  },
  c: {
    label: "C",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: C_FAMILY_QUOTES,
    keywords: [
      "auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else",
      "enum", "extern", "float", "for", "goto", "if", "inline", "int", "long", "register",
      "restrict", "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef",
      "union", "unsigned", "void", "volatile", "while",
    ],
  },
  cpp: {
    label: "C++",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: C_FAMILY_QUOTES,
    keywords: [
      "auto", "bool", "break", "case", "catch", "char", "class", "const", "constexpr", "continue",
      "default", "delete", "do", "double", "else", "enum", "explicit", "export", "extern", "false",
      "float", "for", "friend", "if", "inline", "int", "long", "namespace", "new", "nullptr",
      "operator", "private", "protected", "public", "return", "short", "signed", "sizeof", "static",
      "struct", "switch", "template", "this", "throw", "true", "try", "typedef", "typename",
      "union", "unsigned", "using", "virtual", "void", "volatile", "while",
    ],
  },
  csharp: {
    label: "C#",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: C_FAMILY_QUOTES,
    keywords: [
      "abstract", "as", "async", "await", "base", "bool", "break", "case", "catch", "char", "class",
      "const", "continue", "decimal", "default", "do", "double", "else", "enum", "false", "finally",
      "float", "for", "foreach", "if", "in", "int", "interface", "internal", "is", "long",
      "namespace", "new", "null", "object", "out", "override", "private", "protected", "public",
      "readonly", "ref", "return", "sealed", "short", "static", "string", "struct", "switch",
      "this", "throw", "true", "try", "typeof", "using", "var", "virtual", "void", "while",
    ],
  },
  go: {
    label: "Go",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'", "`"],
    keywords: [
      "break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough",
      "for", "func", "go", "goto", "if", "import", "interface", "map", "nil", "package", "range",
      "return", "select", "struct", "switch", "true", "false", "type", "var",
    ],
  },
  rust: {
    label: "Rust",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: C_FAMILY_QUOTES,
    keywords: [
      "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum", "extern",
      "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub",
      "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type",
      "unsafe", "use", "where", "while",
    ],
  },
  scala: {
    label: "Scala",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: C_FAMILY_QUOTES,
    keywords: [
      "abstract", "case", "catch", "class", "def", "do", "else", "enum", "export", "extends",
      "false", "final", "finally", "for", "given", "if", "implicit", "import", "lazy", "match",
      "new", "null", "object", "opaque", "override", "package", "private", "protected", "return",
      "sealed", "super", "then", "this", "throw", "trait", "transparent", "true", "try", "type",
      "using", "val", "var", "while", "with", "yield",
    ],
  },
  sql: {
    label: "SQL",
    lineComments: ["--"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    keywords: [
      "all", "alter", "and", "as", "asc", "avg", "between", "by", "case", "cast", "count", "create",
      "cross", "delete", "desc", "distinct", "drop", "else", "end", "exists", "from", "full",
      "group", "having", "in", "inner", "insert", "intersect", "into", "is", "join", "left", "like",
      "limit", "max", "min", "not", "null", "offset", "on", "or", "order", "outer", "over",
      "partition", "right", "select", "set", "sum", "table", "then", "union", "update", "values",
      "when", "where", "window", "with",
    ],
  },
  r: {
    label: "R",
    lineComments: ["#"],
    quotes: ['"', "'"],
    keywords: [
      "break", "else", "FALSE", "for", "function", "if", "Inf", "NA", "NaN", "next", "NULL",
      "repeat", "return", "TRUE", "while", "library", "require",
    ],
  },
  matlab: {
    label: "MATLAB",
    lineComments: ["%"],
    blockComment: ["%{", "%}"],
    quotes: ['"', "'"],
    keywords: [
      "break", "case", "catch", "classdef", "continue", "else", "elseif", "end", "enumeration",
      "events", "for", "function", "global", "if", "methods", "otherwise", "parfor", "persistent",
      "properties", "return", "spmd", "switch", "try", "while", "true", "false",
    ],
  },
  bash: {
    label: "Bash",
    lineComments: ["#"],
    quotes: ['"', "'"],
    keywords: [
      "case", "do", "done", "elif", "else", "esac", "exit", "export", "fi", "for", "function", "if",
      "in", "local", "read", "return", "set", "shift", "then", "until", "while",
    ],
  },
  yaml: {
    label: "YAML",
    lineComments: ["#"],
    quotes: ['"', "'"],
    keywords: ["true", "false", "null", "yes", "no", "on", "off"],
  },
  verilog: {
    label: "Verilog",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"'],
    keywords: [
      "always", "assign", "begin", "case", "casex", "default", "else", "end", "endcase",
      "endfunction", "endmodule", "function", "generate", "if", "initial", "inout", "input",
      "integer", "localparam", "module", "negedge", "output", "parameter", "posedge", "reg",
      "endgenerate", "wire", "always_ff", "always_comb",
    ],
  },
  systemverilog: {
    label: "SystemVerilog",
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"'],
    keywords: [
      "always", "always_comb", "always_ff", "assert", "assign", "begin", "bit", "case", "class",
      "covergroup", "default", "else", "end", "endcase", "endclass", "endfunction", "endmodule",
      "endtask", "function", "if", "initial", "input", "interface", "logic", "module", "negedge",
      "output", "package", "parameter", "posedge", "property", "task", "typedef", "virtual", "wire",
    ],
  },
  vhdl: {
    label: "VHDL",
    lineComments: ["--"],
    quotes: ['"', "'"],
    keywords: [
      "architecture", "begin", "case", "component", "downto", "else", "elsif", "end", "entity",
      "for", "function", "generate", "if", "in", "is", "loop", "map", "of", "others", "out",
      "port", "process", "signal", "then", "type", "use", "variable", "when", "while", "with",
    ],
  },
};

export const KNOWN_LANGUAGES = Object.keys(RULES);

export function languageLabel(language: string): string {
  return RULES[language]?.label ?? language.toUpperCase();
}

const CODING_TASK = /(?:\b(?:implement|code|debug|refactor)\b|\bwrite\s+(?:a|an|the)?\s*(?:function|method|class|(?:sql\s+)?query|program|solution|api endpoint)\b|\bgiven\b[^.!?\n]{0,180}\b(?:return|find|compute|calculate|print|produce|determine)\b)/i;

/** Open the workspace for an explicit coding task, not every technical discussion. */
export function isCodingQuestion(question: string): boolean {
  return CODING_TASK.test(question);
}

/** Pull explicit agent hints out of spoken turns without treating ordinary follow-ups as hints. */
export function agentHintsFromTurn(turn: string): string[] {
  const hints: string[] = [];
  for (const line of turn.split(/\r?\n/)) {
    const match = line.match(/^\s*Hint:\s*(.+?)\s*$/i);
    if (match?.[1] && !hints.includes(match[1])) hints.push(match[1]);
  }
  return hints;
}

/**
 * Small, progressive prompts for the candidate when the live agent has not sent
 * bespoke hints. They coach the process without revealing an answer.
 */
export function codingHintsForQuestion(question: string, language: string): string[] {
  const normalized = question.toLowerCase();
  const first = language === "sql" || /\b(sql|query|table|join)\b/.test(normalized)
    ? "Name the rows and columns the result must contain before writing the query."
    : /\b(api|service|system design|endpoint|distributed)\b/.test(normalized)
      ? "Separate the interface, state, and failure paths before choosing an implementation."
      : "State the inputs, expected output, and important edge cases before coding.";
  const second = language === "sql" || /\b(sql|query|table|join)\b/.test(normalized)
    ? "Build the smallest correct query first, then check nulls, duplicates, grouping, and ordering."
    : "Start with the simplest correct approach, then justify the data structure you use."
  return [
    first,
    second,
    "Walk through one normal case and one boundary case, then state the time and space cost.",
  ];
}

export function cursorPosition(source: string, selectionStart: number): { line: number; column: number } {
  const before = source.slice(0, Math.max(0, selectionStart));
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const patternCache = new Map<string, RegExp>();

function patternFor(language: string, rules: LanguageRules): RegExp {
  const cached = patternCache.get(language);
  if (cached) return cached;
  const parts: string[] = [];
  if (rules.blockComment) {
    const [open, close] = rules.blockComment.map(escapeForRegex);
    // The unterminated form keeps a comment the candidate is mid-way through
    // typing from repainting the rest of the file as code.
    parts.push(`${open}[\\s\\S]*?${close}`, `${open}[\\s\\S]*$`);
  }
  for (const marker of rules.lineComments) parts.push(`${escapeForRegex(marker)}[^\\n]*`);
  for (const quote of rules.quotes) {
    const q = escapeForRegex(quote);
    // The closing quote is optional so a string being typed still colours as one.
    parts.push(`${q}(?:\\\\[\\s\\S]|[^\\\\\\n${quote}])*${q}?`);
  }
  parts.push(String.raw`\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b`);
  parts.push(String.raw`[A-Za-z_$][A-Za-z0-9_$]*`);
  const pattern = new RegExp(parts.join("|"), "g");
  patternCache.set(language, pattern);
  return pattern;
}

function classify(match: string, rules: LanguageRules, keywords: Set<string>): TokenKind {
  if (rules.blockComment && match.startsWith(rules.blockComment[0])) return "comment";
  if (rules.lineComments.some((marker) => match.startsWith(marker))) return "comment";
  if (rules.quotes.some((quote) => match.startsWith(quote))) return "string";
  if (/^\d/.test(match)) return "number";
  if (keywords.has(match)) return "keyword";
  return "plain";
}

const keywordCache = new Map<string, Set<string>>();

function keywordsFor(language: string, rules: LanguageRules): Set<string> {
  const cached = keywordCache.get(language);
  if (cached) return cached;
  const set = new Set(rules.keywords);
  keywordCache.set(language, set);
  return set;
}

/**
 * Split source into coloured runs. Everything the tokenizer does not recognise
 * comes back as "plain", so the full text is always reproduced exactly —
 * concatenating every token returns the input unchanged.
 */
export function tokenize(source: string, language: string): Token[] {
  const rules = RULES[language];
  if (!rules || !source) return source ? [{ text: source, kind: "plain" }] : [];
  const pattern = patternFor(language, rules);
  const keywords = keywordsFor(language, rules);
  const tokens: Token[] = [];
  let cursor = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    if (match.index > cursor) tokens.push({ text: source.slice(cursor, match.index), kind: "plain" });
    const kind = classify(match[0], rules, keywords);
    tokens.push({ text: match[0], kind });
    cursor = match.index + match[0].length;
    // A zero-length match would spin forever; the identifier and number rules
    // cannot produce one, but a future rule might.
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  if (cursor < source.length) tokens.push({ text: source.slice(cursor), kind: "plain" });
  return tokens;
}

/** Line numbers for the gutter, counting the empty line a trailing newline opens. */
export function lineNumbers(source: string): number[] {
  const count = source ? source.split("\n").length : 1;
  return Array.from({ length: count }, (_, index) => index + 1);
}

const INDENT = "  ";

/**
 * Tab indents instead of leaving the editor, because losing the caret mid-answer
 * is worse than losing the shortcut. Returns the new value and caret position.
 */
export function indentSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  outdent: boolean,
): { value: string; selectionStart: number; selectionEnd: number } {
  if (!outdent && selectionStart === selectionEnd) {
    return {
      value: `${value.slice(0, selectionStart)}${INDENT}${value.slice(selectionEnd)}`,
      selectionStart: selectionStart + INDENT.length,
      selectionEnd: selectionStart + INDENT.length,
    };
  }
  const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  const before = value.slice(0, lineStart);
  const block = value.slice(lineStart, selectionEnd);
  const after = value.slice(selectionEnd);
  let firstDelta = 0;
  let total = 0;
  const lines = block.split("\n").map((line, index) => {
    if (outdent) {
      const removed = line.startsWith(INDENT) ? INDENT.length : line.startsWith(" ") ? 1 : 0;
      if (index === 0) firstDelta = -removed;
      total -= removed;
      return line.slice(removed);
    }
    if (index === 0) firstDelta = INDENT.length;
    total += INDENT.length;
    return `${INDENT}${line}`;
  });
  return {
    value: `${before}${lines.join("\n")}${after}`,
    selectionStart: Math.max(lineStart, selectionStart + firstDelta),
    selectionEnd: Math.max(lineStart, selectionEnd + total),
  };
}
