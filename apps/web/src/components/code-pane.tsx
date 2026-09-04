"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { Check, ChevronRight, CloudUpload, FileCode2, Lightbulb, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { codingHintsForQuestion, cursorPosition, indentSelection, languageLabel, lineNumbers, tokenize, type TokenKind } from "@/lib/code-highlight";
import { readSessionCode, saveSessionCode } from "@/lib/api";
import { cn } from "@/lib/utils";

const SYNC_DEBOUNCE_MS = 900;

const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: "text-[var(--code-comment)] italic",
  string: "text-[var(--code-string)]",
  number: "text-[var(--code-number)]",
  keyword: "text-[var(--code-keyword)] font-medium",
  plain: "",
};

const EXTENSIONS: Record<string, string> = {
  bash: "sh",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  go: "go",
  java: "java",
  javascript: "js",
  matlab: "m",
  python: "py",
  r: "r",
  rust: "rs",
  scala: "scala",
  sql: "sql",
  systemverilog: "sv",
  typescript: "ts",
  verilog: "v",
  vhdl: "vhd",
  yaml: "yaml",
};

type SyncState = "idle" | "loading" | "saving" | "saved" | "error";
type EditorSnapshot = { language: string; content: string };
type RestoreState = "ready" | "loading" | "failed";

type RestoreResult =
  | { status: "ready"; snapshot: EditorSnapshot; hasSavedVersion: boolean }
  | { status: "failed" };

const RESTORE_ERROR_MESSAGE = "Saved code could not be restored. Editing is paused to protect any code already saved.";

type CodePaneProps = {
  sessionId?: string;
  languages: string[];
  defaultLanguage: string;
  prompt: string;
  question?: string;
  hints?: string[];
  className?: string;
};

export type CodePaneHandle = {
  flush: () => Promise<void>;
};

function sameSnapshot(left: EditorSnapshot | null, right: EditorSnapshot) {
  return left?.language === right.language && left.content === right.content;
}

export async function restoreSessionCodeForEditor(
  sessionId: string,
  supportedLanguages: readonly string[],
  defaultLanguage: string,
): Promise<RestoreResult> {
  try {
    const buffer = await readSessionCode(sessionId);
    return {
      status: "ready",
      snapshot: {
        language: supportedLanguages.includes(buffer.language) ? buffer.language : defaultLanguage,
        content: buffer.content ?? "",
      },
      hasSavedVersion: Boolean(buffer.updated_at),
    };
  } catch {
    return { status: "failed" };
  }
}

function Highlighted({ source, language }: { source: string; language: string }) {
  const tokens = useMemo(() => tokenize(source, language), [source, language]);
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} className={TOKEN_CLASS[token.kind]}>{token.text}</span>
      ))}
      {"\n"}
    </>
  );
}

/** What the human interviewer sees: the candidate's editor, without a caret in it. */
export function CodeView({ source, language, className }: { source: string; language: string; className?: string }) {
  const lines = useMemo(() => lineNumbers(source), [source]);
  return (
    <div className={cn("flex min-h-0 overflow-auto rounded-xl border bg-[var(--code-surface)]", className)} aria-label={`Candidate's ${languageLabel(language)} code`}>
      {source ? (
        <>
          <div aria-hidden className="select-none border-r px-2 py-3 text-right font-mono text-xs leading-5 text-[var(--code-gutter)]">
            {lines.map((line) => <div key={line}>{line}</div>)}
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

export const CodePane = forwardRef<CodePaneHandle, CodePaneProps>(function CodePane(
  { sessionId, languages, defaultLanguage, prompt, question, hints, className },
  ref,
) {
  const [language, setLanguage] = useState(defaultLanguage);
  const [source, setSource] = useState("");
  const [sync, setSync] = useState<SyncState>(sessionId ? "loading" : "idle");
  const [restoreState, setRestoreState] = useState<RestoreState>(sessionId ? "loading" : "ready");
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [hintProgress, setHintProgress] = useState({ task: "", count: 0 });
  const [dirty, setDirty] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const hydratedRef = useRef(!sessionId);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(true);
  const snapshotRef = useRef<EditorSnapshot>({ language: defaultLanguage, content: "" });
  const savedRef = useRef<EditorSnapshot | null>(null);
  const queuedRef = useRef<EditorSnapshot | null>(null);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const lines = useMemo(() => lineNumbers(source), [source]);
  const languageKey = languages.join("|");
  const task = question?.trim() || prompt.trim() || "Solve the coding problem described by the interviewer.";
  const availableHints = useMemo(() => hints?.filter(Boolean) ?? codingHintsForQuestion(task, language), [hints, language, task]);

  useEffect(() => {
    snapshotRef.current = { language, content: source };
  }, [language, source]);

  useEffect(() => {
    let cancelled = false;
    dirtyRef.current = false;
    hydratedRef.current = !sessionId;
    queuedRef.current = null;
    savedRef.current = null;
    if (!sessionId) return;
    void restoreSessionCodeForEditor(sessionId, languageKey.split("|"), defaultLanguage)
      .then((result) => {
        if (cancelled) return;
        if (result.status === "failed") {
          hydratedRef.current = false;
          setDirty(false);
          setLoadError(RESTORE_ERROR_MESSAGE);
          setRestoreState("failed");
          setSync("error");
          return;
        }
        const restored = result.snapshot;
        savedRef.current = restored;
        queuedRef.current = null;
        snapshotRef.current = restored;
        setLanguage(restored.language);
        setSource(restored.content);
        setLoadError("");
        setDirty(false);
        setRestoreState("ready");
        setSync(result.hasSavedVersion ? "saved" : "idle");
        hydratedRef.current = true;
      });
    return () => { cancelled = true; };
    // languageKey changes only when the role pack's actual options change.
  }, [defaultLanguage, languageKey, restoreAttempt, sessionId]);

  const enqueueSave = useCallback((snapshot: EditorSnapshot) => {
    if (!sessionId) return Promise.resolve();
    queuedRef.current = snapshot;
    if (mountedRef.current) setSync("saving");
    const request = saveChainRef.current
      .catch(() => undefined)
      .then(() => saveSessionCode(sessionId, snapshot.language, snapshot.content));
    saveChainRef.current = request;
    void request
      .then(() => {
        savedRef.current = snapshot;
        if (queuedRef.current === snapshot) queuedRef.current = null;
        if (sameSnapshot(snapshotRef.current, snapshot) && queuedRef.current === null) {
          dirtyRef.current = false;
          if (mountedRef.current) {
            setDirty(false);
            setSync("saved");
          }
        }
      })
      .catch(() => {
        if (queuedRef.current === snapshot) queuedRef.current = null;
        if (!mountedRef.current) return;
        if (sameSnapshot(savedRef.current, snapshotRef.current) && queuedRef.current === null) {
          dirtyRef.current = false;
          setDirty(false);
          setSync("saved");
        } else if (sameSnapshot(snapshotRef.current, snapshot)) {
          setSync("error");
        }
      });
    return request;
  }, [sessionId]);

  const saveNow = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const snapshot = snapshotRef.current;
    if (!sessionId || !hydratedRef.current || !dirtyRef.current) return;
    if (sameSnapshot(queuedRef.current, snapshot)) return;
    if (sameSnapshot(savedRef.current, snapshot) && queuedRef.current === null) return;
    void enqueueSave(snapshot);
  }, [enqueueSave, sessionId]);

  const flush = useCallback(async () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const snapshot = snapshotRef.current;
    if (
      sessionId
      && hydratedRef.current
      && dirtyRef.current
      && !sameSnapshot(queuedRef.current, snapshot)
      && !(sameSnapshot(savedRef.current, snapshot) && queuedRef.current === null)
    ) {
      await enqueueSave(snapshot);
      return;
    }
    await saveChainRef.current;
  }, [enqueueSave, sessionId]);

  useImperativeHandle(ref, () => ({ flush }), [flush]);

  useEffect(() => {
    if (!sessionId || !hydratedRef.current || !dirtyRef.current) return;
    const snapshot = { language, content: source };
    if (sameSnapshot(queuedRef.current, snapshot)) return;
    if (sameSnapshot(savedRef.current, snapshot) && queuedRef.current === null) {
      dirtyRef.current = false;
      setDirty(false);
      setSync("saved");
      return;
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void enqueueSave(snapshot);
    }, SYNC_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [enqueueSave, language, sessionId, source]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const snapshot = snapshotRef.current;
      if (!sessionId || !hydratedRef.current || !dirtyRef.current || sameSnapshot(queuedRef.current, snapshot)) return;
      if (sameSnapshot(savedRef.current, snapshot) && queuedRef.current === null) return;
      queuedRef.current = snapshot;
      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(() => saveSessionCode(sessionId, snapshot.language, snapshot.content));
    };
  }, [sessionId]);

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
  }, []);

  const updateCursor = useCallback((event: SyntheticEvent<HTMLTextAreaElement>) => {
    setCursor(cursorPosition(event.currentTarget.value, event.currentTarget.selectionStart));
  }, []);

  const markChanged = useCallback((snapshot: EditorSnapshot) => {
    snapshotRef.current = snapshot;
    const changed = !sameSnapshot(savedRef.current, snapshot) || queuedRef.current !== null;
    dirtyRef.current = changed;
    setDirty(changed);
    setSync(changed
      ? sameSnapshot(queuedRef.current, snapshot) ? "saving" : "idle"
      : "saved");
    setLoadError("");
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const next = indentSelection(textarea.value, textarea.selectionStart, textarea.selectionEnd, event.shiftKey);
    markChanged({ language, content: next.value });
    setSource(next.value);
    setCursor(cursorPosition(next.value, next.selectionStart));
    window.requestAnimationFrame(() => textarea.setSelectionRange(next.selectionStart, next.selectionEnd));
  }, [language, markChanged]);

  const extension = EXTENSIONS[language] ?? language;
  const revealedHints = hintProgress.task === task ? hintProgress.count : 0;
  const shownHints = availableHints.slice(0, revealedHints);

  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-[var(--code-surface)] shadow-[var(--panel-shadow)]", className)} aria-label="Shared code editor">
      <header className="flex min-h-11 flex-wrap items-center gap-2 border-b bg-background/70 px-3 py-1.5">
        <FileCode2 className="size-4 text-primary" aria-hidden="true" />
        <span className="font-mono text-xs font-medium">solution.{extension}</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">Shared with the interview panel</span>
        <label className="sr-only" htmlFor="code-language">Language</label>
        <select
          id="code-language"
          value={language}
          disabled={restoreState !== "ready"}
          onChange={(event) => {
            markChanged({ language: event.target.value, content: source });
            setLanguage(event.target.value);
          }}
          className="ms-auto h-8 rounded-md border bg-background px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {languages.map((value) => <option key={value} value={value}>{languageLabel(value)}</option>)}
        </select>
        <span className={cn("flex items-center gap-1.5 text-xs", sync === "error" ? "text-destructive" : "text-muted-foreground")} role="status" aria-live="polite">
          {sync === "loading" ? <><Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Restoring</> : null}
          {sync === "saving" ? <><CloudUpload className="size-3.5" aria-hidden="true" /> Saving</> : null}
          {sync === "saved" ? <><Check className="size-3.5" aria-hidden="true" /> Saved</> : null}
          {sync === "idle" && dirty ? "Unsaved" : null}
          {sync === "error" ? <><TriangleAlert className="size-3.5" aria-hidden="true" /> {restoreState === "failed" ? "Restore failed" : "Not saved"}</> : null}
        </span>
        {sync === "error" && dirty && restoreState === "ready" ? (
          <button type="button" onClick={saveNow} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Retry saving code">
            <RotateCcw className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-destructive/8 px-3 py-2 text-xs text-destructive" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => {
              setLoadError("");
              setRestoreState("loading");
              setSync("loading");
              setRestoreAttempt((attempt) => attempt + 1);
            }}
            className="min-h-8 rounded-md border border-destructive/30 px-2 font-medium hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry restore
          </button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(16rem,1fr)] lg:grid-cols-[minmax(15rem,0.34fr)_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="max-h-44 overflow-y-auto border-b bg-background/45 p-4 lg:max-h-none lg:border-b-0 lg:border-e" aria-labelledby="coding-task-title">
          <p className="text-xs font-medium text-primary">Current coding task</p>
          <h2 id="coding-task-title" className="mt-2 text-sm font-semibold leading-6 text-pretty">{task}</h2>
          {prompt.trim() && prompt.trim() !== task ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{prompt}</p> : null}

          <div className="mt-4 border-t pt-3">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs font-medium"><Lightbulb className="size-3.5 text-primary" aria-hidden="true" /> Hints</p>
              {revealedHints < availableHints.length ? (
                <button type="button" onClick={() => setHintProgress({ task, count: revealedHints + 1 })} className="flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Show hint {revealedHints + 1}<ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {shownHints.length ? (
              <ol className="mt-2 space-y-2">
                {shownHints.map((hint, index) => (
                  <li key={`${index}-${hint}`} className="flex gap-2 text-xs leading-5 text-muted-foreground">
                    <span className="font-mono text-primary" aria-hidden="true">{index + 1}</span>
                    <span>{hint}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-2 text-xs text-muted-foreground">Reveal a hint only when you need one.</p>}
          </div>
        </aside>

        <div className="relative flex min-h-0 bg-[var(--code-surface)]">
          <div ref={gutterRef} aria-hidden className="select-none overflow-hidden border-r px-2.5 py-3 text-right font-mono text-[13px] leading-6 text-[var(--code-gutter)]">
            {lines.map((line) => <div key={line}>{line}</div>)}
          </div>
          <div className="relative min-h-0 flex-1">
            <pre ref={highlightRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre px-3 py-3 font-mono text-[13px] leading-6">
              <Highlighted source={source} language={language} />
            </pre>
            <textarea
              ref={textareaRef}
              value={source}
              onChange={(event) => {
                markChanged({ language, content: event.target.value });
                setSource(event.target.value);
                updateCursor(event);
              }}
              onSelect={updateCursor}
              onScroll={syncScroll}
              onKeyDown={onKeyDown}
              onBlur={saveNow}
              disabled={restoreState !== "ready"}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Your solution"
              aria-describedby="coding-task-title"
              placeholder="Start coding here…"
              className="absolute inset-0 size-full resize-none overflow-auto whitespace-pre bg-transparent px-3 py-3 font-mono text-[13px] leading-6 text-transparent caret-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait"
            />
          </div>
        </div>
      </div>

      <footer className="flex min-h-8 items-center gap-3 border-t bg-background/70 px-3 font-mono text-[10px] text-muted-foreground">
        <span>Ln {cursor.line}, Col {cursor.column}</span>
        <span>{lines.length} {lines.length === 1 ? "line" : "lines"}</span>
        <span className="ms-auto hidden sm:inline">Tab inserts 2 spaces</span>
        <span>{languageLabel(language)}</span>
      </footer>
    </section>
  );
});

CodePane.displayName = "CodePane";
