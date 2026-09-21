"""Terminal input for ``abs chat`` — shared paste handling.

Terminals in bracketed-paste mode (enabled with ``ESC[?2004h``) wrap pasted
text in ``ESC[200~`` … ``ESC[201~`` instead of feeding it line by line.

GNU readline (imported by the chat command) handles bracketed paste natively:
the whole paste comes back from ``input()`` as one string once the user
presses Enter, with the markers stripped. When readline is unavailable or
does not support it, the markers leak through and ``PasteAwareInput``
normalizes them into a single message — the pasted block is submitted only
once the user presses Enter.

Keep in sync with typescript/src/paste-input.ts.
"""

import sys

PASTE_START = "\x1b[200~"
PASTE_END = "\x1b[201~"


def enable_bracketed_paste() -> None:
    """Ask the terminal to wrap pasted text in ESC[200~ / ESC[201~ (xterm)."""
    try:
        if sys.stdin.isatty() and sys.stdout.isatty():
            sys.stdout.write("\x1b[?2004h")
            sys.stdout.flush()
    except Exception:
        pass  # exotic streams: no-op


def disable_bracketed_paste() -> None:
    """Restore the terminal's default paste mode."""
    try:
        if sys.stdout.isatty():
            sys.stdout.write("\x1b[?2004l")
            sys.stdout.flush()
    except Exception:
        pass  # exotic streams: no-op


class PasteAwareInput:
    """State machine that turns raw input lines into whole chat messages.

    ``feed()`` receives one raw input line (no trailing newline) and returns
    the next complete message, or ``None`` when more lines are needed.
    """

    def __init__(self) -> None:
        self._buffer: str | None = None
        self._in_paste = False
        self._waiting_enter = False
        self._first_segment = True

    def feed(self, raw_line: str) -> str | None:
        line = raw_line.rstrip("\r")

        if self._waiting_enter:
            self._waiting_enter = False
            if line == "":
                message = self._buffer or ""
                self._buffer = None
                return message
            if PASTE_START in line:
                # Another paste arrived before the Enter: keep collecting.
                self._buffer = (self._buffer or "") + "\n"
            else:
                # Text typed after the paste, submitted with Enter.
                message = (self._buffer or "") + "\n" + line
                self._buffer = None
                return message

        while True:
            if self._in_paste:
                end = line.find(PASTE_END)
                if end == -1:
                    # A physical line break inside the paste: new content line.
                    self._buffer = (self._buffer or "") + ("" if self._first_segment else "\n") + line
                    self._first_segment = False
                    return None
                content = line[:end]
                rest = line[end + len(PASTE_END) :]
                if end == 0 and rest == "":
                    # The paste ended with a trailing newline: the line break
                    # that delivered this event belongs to the paste, not the
                    # user. Wait for the Enter before submitting.
                    self._waiting_enter = True
                    return None
                self._buffer = (self._buffer or "") + ("" if self._first_segment else "\n") + content
                self._first_segment = False
                self._in_paste = False
                line = rest
                continue
            start = line.find(PASTE_START)
            if start != -1:
                if self._buffer is None:
                    self._buffer = ""
                self._buffer += line[:start]
                self._in_paste = True
                self._first_segment = True
                line = line[start + len(PASTE_START) :]
                continue
            break

        if self._buffer is None:
            return line
        self._buffer += line
        message = self._buffer
        self._buffer = None
        return message
