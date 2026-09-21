/**
 * Terminal input for `abs chat` — shared paste handling.
 *
 * Terminals in bracketed-paste mode (enabled with ESC[?2004h) wrap pasted
 * text in ESC[200~ … ESC[201~ instead of feeding it line by line. Two layers
 * make pasted text arrive as ONE message, sent only when the user presses
 * Enter:
 *
 * 1. RawChatInput — a raw-mode keypress editor. Node's readline swallows the
 *    paste markers as unbound CSI sequences, so a raw editor is required:
 *    emitKeypressEvents decodes them into "paste-start" / "paste-end" events
 *    and the editor merges everything between them into the line buffer,
 *    keeping embedded newlines as content.
 * 2. PasteAwareInput — a pure state machine that normalizes lines that still
 *    carry raw paste markers (non-TTY input, or readline implementations that
 *    leak them). Unit-tested; the Python package mirrors it.
 *
 * Keep in sync with python/src/abslang/paste_input.py.
 */

import * as readline from "readline";

export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

export function enableBracketedPaste(): void {
  try {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      process.stdout.write("\x1b[?2004h");
    }
  } catch {
    // exotic streams: no-op
  }
}

export function disableBracketedPaste(): void {
  try {
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[?2004l");
    }
  } catch {
    // exotic streams: no-op
  }
}

// ── PasteAwareInput ──
// Turns raw input lines into whole chat messages.

export class PasteAwareInput {
  private buffer: string | null = null;
  private inPaste = false;
  private waitingEnter = false;
  private firstSegment = true;

  /**
   * Feed one raw input line (no trailing newline).
   * Returns the next complete message, or null when more lines are needed.
   */
  feed(rawLine: string): string | null {
    // Clipboards may carry CR/CRLF line endings: normalize so pasted
    // lines never overwrite each other on the terminal or in the message.
    let line = rawLine.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");

    if (this.waitingEnter) {
      this.waitingEnter = false;
      if (line === "") {
        const message = this.buffer ?? "";
        this.buffer = null;
        return message;
      }
      if (line.includes(PASTE_START)) {
        // Another paste arrived before the Enter: keep collecting.
        this.buffer = (this.buffer ?? "") + "\n";
      } else {
        // Text typed after the paste, submitted with Enter.
        const message = (this.buffer ?? "") + "\n" + line;
        this.buffer = null;
        return message;
      }
    }

    while (true) {
      if (this.inPaste) {
        const end = line.indexOf(PASTE_END);
        if (end === -1) {
          // A physical line break inside the paste: new content line.
          this.buffer = (this.buffer ?? "") + (this.firstSegment ? "" : "\n") + line;
          this.firstSegment = false;
          return null;
        }
        const content = line.slice(0, end);
        const rest = line.slice(end + PASTE_END.length);
        if (end === 0 && rest === "") {
          // The paste ended with a trailing newline: the line break that
          // delivered this event belongs to the paste, not the user. Wait
          // for the Enter before submitting.
          this.waitingEnter = true;
          return null;
        }
        this.buffer = (this.buffer ?? "") + (this.firstSegment ? "" : "\n") + content;
        this.firstSegment = false;
        this.inPaste = false;
        line = rest;
        continue;
      }
      const start = line.indexOf(PASTE_START);
      if (start !== -1) {
        if (this.buffer === null) this.buffer = "";
        this.buffer += line.slice(0, start);
        this.inPaste = true;
        this.firstSegment = true;
        line = line.slice(start + PASTE_START.length);
        continue;
      }
      break;
    }

    if (this.buffer === null) return line;
    this.buffer += line;
    const message = this.buffer;
    this.buffer = null;
    return message;
  }
}

// ── RawChatInput ──
// Raw-mode line editor for TTYs: type, backspace, Ctrl+U, bracketed paste,
// Enter to submit, Ctrl+C / Ctrl+D to quit. Arrow keys are intentionally not
// supported in raw mode; they are ignored instead of leaking into the input.

export class RawChatInput {
  private buffer = "";
  private pending: string[] = [];
  private inPaste = false;
  private resolveFn: ((line: string | null) => void) | null = null;
  private rawOn = false;
  private onCancel: (() => void) | null = null;

  constructor() {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.on("keypress", (seq: string, key: readline.Key) => this.handleKey(seq, key));
    process.stdin.resume();
  }

  /** Enter raw mode for the chat session. Idempotent. */
  start(): void {
    if (!process.stdin.isTTY) return;
    if (this.rawOn) return;
    process.stdin.setRawMode(true);
    this.rawOn = true;
  }

  /** Restore the terminal. Idempotent; call before exiting. */
  stop(): void {
    if (!this.rawOn) return;
    process.stdin.setRawMode(false);
    this.rawOn = false;
  }

  /**
   * Render the prompt and resolve with the next submitted line, or null on
   * Ctrl+C / Ctrl+D-on-empty. Anything typed while no line is being read
   * (e.g. while the assistant is answering) is kept and echoed on the next
   * call; a submitted line queued in that state resolves immediately.
   */
  requestLine(prompt: string, onCancel: () => void): Promise<string | null> {
    this.onCancel = onCancel;
    return new Promise((resolve) => {
      if (this.pending.length > 0) {
        // A line was submitted while the assistant was answering.
        process.stdout.write(prompt + "\n");
        resolve(this.pending.shift()!);
        return;
      }
      process.stdout.write(prompt + this.buffer);
      this.resolveFn = resolve;
    });
  }

  private handleKey(seq: string, key: readline.Key): void {
    const active = this.resolveFn !== null;

    if (this.inPaste) {
      if (key.name === "paste-end") {
        this.inPaste = false;
        return;
      }
      if (seq) {
        // Clipboards may carry CR/CRLF line endings: normalize so pasted
        // lines never overwrite each other on the terminal or in the buffer.
        const normalized = seq.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        this.buffer += normalized;
        if (active) process.stdout.write(normalized);
      }
      return;
    }
    if (key.name === "paste-start") {
      this.inPaste = true;
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      if (active) process.stdout.write("\n");
      if (active) {
        const line = this.buffer;
        this.buffer = "";
        const resolve = this.resolveFn;
        this.resolveFn = null;
        this.onCancel = null;
        resolve!(line);
      } else {
        // Submitted while the assistant is answering: queue it.
        this.pending.push(this.buffer);
        this.buffer = "";
      }
      return;
    }
    if (key.ctrl && key.name === "c") {
      if (active) {
        process.stdout.write("^C\n");
        this.buffer = "";
        const resolve = this.resolveFn;
        this.resolveFn = null;
        this.onCancel = null;
        resolve!(null);
        return;
      }
      // Ctrl+C while the assistant is answering: quit the session.
      this.stop();
      this.onCancel?.();
      return;
    }
    if (key.ctrl && key.name === "d") {
      if (this.buffer === "") {
        if (active) {
          process.stdout.write("\n");
          const resolve = this.resolveFn;
          this.resolveFn = null;
          this.onCancel = null;
          resolve!(null);
        } else {
          this.stop();
          this.onCancel?.();
        }
      }
      return;
    }
    if (key.name === "backspace") {
      if (this.buffer.length > 0) {
        const last = this.buffer[this.buffer.length - 1];
        this.buffer = this.buffer.slice(0, -1);
        if (active) process.stdout.write(last === "\n" ? "\x1b[1A\x1b[K" : "\b \b");
      }
      return;
    }
    if (key.ctrl && key.name === "u") {
      while (this.buffer.length > 0) {
        const last = this.buffer[this.buffer.length - 1];
        this.buffer = this.buffer.slice(0, -1);
        if (active) process.stdout.write(last === "\n" ? "\x1b[1A\x1b[K" : "\b \b");
      }
      return;
    }
    // Editing keys are not supported in raw mode; ignore them (and any other
    // control sequence) so they never land in the message.
    if (
      key.name === "up" ||
      key.name === "down" ||
      key.name === "left" ||
      key.name === "right" ||
      key.name === "home" ||
      key.name === "end" ||
      key.name === "delete" ||
      key.name === "tab" ||
      key.ctrl ||
      key.meta
    ) {
      return;
    }
    if (!seq) return;
    const normalized = seq.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    this.buffer += normalized;
    if (active) process.stdout.write(normalized);
  }
}
