import { describe, expect, it } from "vitest";
import { KNOWN_LANGUAGES, agentHintsFromTurn, codingHintsForQuestion, cursorPosition, indentSelection, isCodingQuestion, languageLabel, lineNumbers, tokenize } from "@/lib/code-highlight";

function kinds(source: string, language: string) {
  return tokenize(source, language).map((token) => `${token.kind}:${token.text}`);
}

describe("tokenize", () => {
  it("reproduces the source exactly for every supported language", () => {
    const source = "a = 1 // \"x\" /* y */ # z -- w\nfoo(bar)\n";
    for (const language of KNOWN_LANGUAGES) {
      const joined = tokenize(source, language).map((token) => token.text).join("");
      expect(joined, language).toBe(source);
    }
  });

  it("returns the whole source as plain text for an unknown language", () => {
    expect(tokenize("select 1", "brainfuck")).toEqual([{ text: "select 1", kind: "plain" }]);
  });

  it("handles empty input", () => {
    expect(tokenize("", "python")).toEqual([]);
  });

  it("colours python keywords, strings, numbers and comments", () => {
    expect(kinds('def f():\n    return "hi"  # note\n', "python")).toEqual([
      "keyword:def",
      "plain: ",
      "plain:f",
      "plain:():\n    ",
      "keyword:return",
      "plain: ",
      'string:"hi"',
      "plain:  ",
      "comment:# note",
      "plain:\n",
    ]);
  });

  it("keeps a line comment from swallowing the next line", () => {
    const tokens = tokenize("// gone\nkept\n", "javascript");
    expect(tokens[0]).toEqual({ text: "// gone", kind: "comment" });
    expect(tokens.some((token) => token.text === "kept")).toBe(true);
  });

  it("treats an unterminated block comment as a comment to end of file", () => {
    const tokens = tokenize("/* still typing\nconst x = 1", "typescript");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe("comment");
  });

  it("treats an unterminated string as a string rather than repainting the line", () => {
    const tokens = tokenize('name = "unfinished', "python");
    expect(tokens.at(-1)).toEqual({ text: '"unfinished', kind: "string" });
  });

  it("does not end a string on an escaped quote", () => {
    const tokens = tokenize('x = "a\\"b" + y', "javascript");
    expect(tokens.some((token) => token.kind === "string" && token.text === '"a\\"b"')).toBe(true);
  });

  it("reads -- as a comment in SQL but as an operator elsewhere", () => {
    expect(tokenize("select 1 -- note", "sql").at(-1)).toEqual({ text: "-- note", kind: "comment" });
    expect(tokenize("i--;", "cpp").some((token) => token.kind === "comment")).toBe(false);
  });

  it("recognises hardware keywords for the VLSI track", () => {
    const tokens = tokenize("always_ff @(posedge clk) begin", "systemverilog");
    const keywords = tokens.filter((token) => token.kind === "keyword").map((token) => token.text);
    expect(keywords).toContain("always_ff");
    expect(keywords).toContain("posedge");
    expect(keywords).toContain("begin");
  });

  it("recognises MATLAB comments and control-flow keywords for robotics tracks", () => {
    const tokens = tokenize("for i = 1:3 % sweep\nend", "matlab");
    expect(tokens.some((token) => token.kind === "keyword" && token.text === "for")).toBe(true);
    expect(tokens.some((token) => token.kind === "comment" && token.text === "% sweep")).toBe(true);
    expect(tokens.some((token) => token.kind === "keyword" && token.text === "end")).toBe(true);
  });

  it("recognises Scala declarations for data-engineering tracks", () => {
    const tokens = tokenize("object Job { def run = true }", "scala");
    const keywords = tokens.filter((token) => token.kind === "keyword").map((token) => token.text);
    expect(keywords).toEqual(["object", "def", "true"]);
  });

  it("marks numbers including decimals and exponents", () => {
    const numbers = tokenize("x = 1 + 2.5 + 3e10", "python")
      .filter((token) => token.kind === "number")
      .map((token) => token.text);
    expect(numbers).toEqual(["1", "2.5", "3e10"]);
  });

  it("does not mistake an identifier containing a keyword for a keyword", () => {
    const tokens = tokenize("returnValue = 1", "javascript");
    expect(tokens[0]).toEqual({ text: "returnValue", kind: "plain" });
  });
});

describe("languageLabel", () => {
  it("names known languages and falls back for unknown ones", () => {
    expect(languageLabel("cpp")).toBe("C++");
    expect(languageLabel("systemverilog")).toBe("SystemVerilog");
    expect(languageLabel("matlab")).toBe("MATLAB");
    expect(languageLabel("cobol")).toBe("COBOL");
  });
});

describe("lineNumbers", () => {
  it("always shows at least one line", () => {
    expect(lineNumbers("")).toEqual([1]);
  });

  it("counts the empty line a trailing newline opens", () => {
    expect(lineNumbers("a\nb\n")).toEqual([1, 2, 3]);
  });
});

describe("indentSelection", () => {
  it("inserts two spaces at the caret when nothing is selected", () => {
    expect(indentSelection("ab", 1, 1, false)).toEqual({
      value: "a  b",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("indents every line the selection touches", () => {
    const result = indentSelection("one\ntwo", 0, 7, false);
    expect(result.value).toBe("  one\n  two");
    expect(result.selectionEnd).toBe(11);
  });

  it("outdents only the whitespace that is there", () => {
    expect(indentSelection("  one\n two", 0, 10, true).value).toBe("one\ntwo");
  });

  it("leaves an unindented line alone when outdenting", () => {
    expect(indentSelection("one", 0, 3, true).value).toBe("one");
  });

  it("indents from the start of the line the caret sits inside", () => {
    const result = indentSelection("first\nsecond", 8, 10, false);
    expect(result.value).toBe("first\n  second");
  });
});

describe("coding workspace guidance", () => {
  it("opens for explicit coding tasks without treating every technical question as code", () => {
    expect(isCodingQuestion("Implement an LRU cache and explain its time complexity.")).toBe(true);
    expect(isCodingQuestion("Write a SQL query that returns the top customers.")).toBe(true);
    expect(isCodingQuestion("Given an array of orders, return the highest-value three.")).toBe(true);
    expect(isCodingQuestion("How would you prioritize reliability against speed?")).toBe(false);
    expect(isCodingQuestion("What is the time complexity of the approach you just described?")).toBe(false);
    expect(isCodingQuestion("Hint: a hash map can reduce the runtime.")).toBe(false);
  });

  it("extracts only explicitly marked agent hints", () => {
    expect(agentHintsFromTurn("Hint: Start by sorting the intervals.\nWhat is the runtime?")).toEqual([
      "Start by sorting the intervals.",
    ]);
    expect(agentHintsFromTurn("Consider a hash map next.")).toEqual([]);
  });

  it("gives SQL-specific progressive hints without revealing an answer", () => {
    const hints = codingHintsForQuestion("Write a query joining orders and customers", "sql");
    expect(hints).toHaveLength(3);
    expect(hints[0]).toContain("rows and columns");
    expect(hints[1]).toContain("nulls");
  });

  it("reports a one-based cursor position", () => {
    expect(cursorPosition("first\nsecond", 8)).toEqual({ line: 2, column: 3 });
  });
});
