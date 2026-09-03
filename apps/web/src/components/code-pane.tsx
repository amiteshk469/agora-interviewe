"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, CloudUpload, TriangleAlert } from "lucide-react";
import { indentSelection, languageLabel, lineNumbers, tokenize, type TokenKind } from "@/lib/code-highlight";
import { saveSessionCode } from "@/lib/api";
import { cn } from "@/lib/utils";

// Long enough that a burst of typing is one write, short enough that a panelist
// challenging the code is never more than a couple of seconds behind the screen.
const SYNC_DEBOUNCE_MS = 900;

const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: "text-[var(--code-comment)] italic",
  string: "text-[var(--code-string)]",
  number: "text-[var(--code-number)]",
  keyword: "text-[var(--code-keyword)] font-medium",
  plain: "",
};

type SyncState = "idle" | "saving" | "saved" | "error";

type CodePaneProps = {
  sessionId?: string;
  languages: string[];
  defaultLanguage: string;
  prompt: string;
  className?: string;
};

function Highlighted({ source, language }: { source: string; language: string }) {
  const tokens = useMemo(() => tokenize(source, language), [source, language]);
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} className={TOKEN_CLASS[token.kind]}>
          {token.text}
        </span>
      ))}
      {/* Keeps the final line paintable when the buffer ends without a newline. */}
      {"\n"}
    </>
  );
}

/** What the human interviewer sees: the candidate's editor, without a caret in it. */
export function CodeView({
  source,
  language,
  className,
}: {
  source: string;
  language: string;
  className?: string;
}) {
  const lines = useMemo(() => lineNumbers(source), [source]);
  return (
    <div
      className={cn("flex min-h-0 overflow-auto rounded-xl border bg-[var(--code-surface)]", className)}
      aria-label={`Candidate's ${languageLabel(language)} code`}
    >
      {source ? (
        <>
          <div
            aria-hidden
            className="select-none border-r px-2 py-3 text-right font-mono text-xs leading-5 text-[var(--code-gutter)]"
          >
            {lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
          <pre className="min-w-0 flex-1 whitespace-pre px-3 py-3 font-mono text-xs leading-5">
            <Highlighted source={source} language={language} />
          </pre>
        </>
      ) : (
        <p className="p-4 text-xs text-muted-foreground">The candidate has not written anything yet.</p>
      )}
    </div>
  );
}

export function CodePane({ sessionId, languages, defaultLanguage, prompt, className }: CodePaneProps) {
  const [language, setLanguage] = useState(defaultLanguage);
  const [source, setSource] = useState("");
  const [sync, setSync] = useState<SyncState>("idle");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => lineNumbers(source), [source]);

  // One write per pause, and the latest content always wins.
  const pending = useRef<{ language: string; content: string } | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    const snapshot = { language, content: source };
    if (!snapshot.content) return;
    pending.current = snapshot;
    const timer = window.setTimeout(() => {
      setSync("saving");
      saveSessionCode(sessionId, snapshot.language, snapshot.content)
        .then(() => {
          // A newer keystroke has already queued another write; leave its state alone.
          if (pending.current === snapshot) setSync("saved");
        })
        .catch(() => {
          if (pending.current === snapshot) setSync("error");
        });
    }, SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [sessionId, language, source]);

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const next = indentSelection(
      textarea.value,
      textarea.selectionStart,
      textarea.selectionEnd,
      event.shiftKey,
    );
    setSource(next.value);
    // Restore the caret after React has painted the new value.
    window.requestAnimationFrame(() => {
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }, []);

  return (
    <section
      className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-[var(--code-surface)]", className)}
      aria-label="Shared code editor"
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <label className="sr-only" htmlFor="code-language">
          Language
        </label>
        <select
          id="code-language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs font-medium"
        >
          {languages.map((value) => (
            <option key={value} value={value}>
              {languageLabel(value)}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          {sync === "saving" ? (
            <>
              <CloudUpload className="size-3.5" aria-hidden /> Sending to the panel
            </>
          ) : null}
          {sync === "saved" ? (
            <>
              <Check className="size-3.5" aria-hidden /> The panel can see this
            </>
          ) : null}
          {sync === "error" ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <TriangleAlert className="size-3.5" aria-hidden /> Not sent — keep typing, it will retry
            </span>
          ) : null}
        </span>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div
          ref={gutterRef}
          aria-hidden
          className="select-none overflow-hidden border-r bg-[var(--code-surface)] px-2 py-3 text-right font-mono text-xs leading-5 text-[var(--code-gutter)]"
        >
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>

        <div className="relative min-h-0 flex-1">
          <pre
            ref={highlightRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-3 py-3 font-mono text-xs leading-5"
          >
            <Highlighted source={source} language={language} />
          </pre>
          <textarea
            ref={textareaRef}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            onScroll={syncScroll}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Your code"
            placeholder={prompt}
            // Transparent text over the highlighted layer; the caret and selection
            // stay native, which is what keeps typing feeling like a real editor.
            className="absolute inset-0 size-full resize-none overflow-auto whitespace-pre bg-transparent px-3 py-3 font-mono text-xs leading-5 text-transparent caret-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>
    </section>
  );
}
