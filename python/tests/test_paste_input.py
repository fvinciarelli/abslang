"""PasteAwareInput must mirror typescript/src/__tests__/paste-input.test.ts."""

from abslang.paste_input import PASTE_END, PASTE_START, PasteAwareInput


def feed_lines(lines):
    """Feed a list of raw lines into a fresh collector, return the outputs."""
    collector = PasteAwareInput()
    return [collector.feed(line) for line in lines]


def test_typed_lines_pass_through():
    collector = PasteAwareInput()
    assert collector.feed("hola") == "hola"
    assert collector.feed("") == ""
    assert collector.feed("otra línea") == "otra línea"


def test_cr_crlf_normalized_to_newlines():
    # Mirrors the CR normalization in PasteAwareInput (TS) and the raw editor.
    assert feed_lines(["a\rb"]) == ["a\nb"]
    assert feed_lines(["a\r\nb"]) == ["a\nb"]
    assert feed_lines(["línea\r"]) == ["línea"]


def test_single_line_paste():
    assert feed_lines([f"{PASTE_START}hola{PASTE_END}"]) == ["hola"]


def test_multiline_paste_without_trailing_newline():
    assert feed_lines([f"{PASTE_START}a", "b", f"c{PASTE_END}"]) == [None, None, "a\nb\nc"]


def test_multiline_paste_with_trailing_newline_waits_for_enter():
    assert feed_lines([f"{PASTE_START}a", "b", PASTE_END, ""]) == [None, None, None, "a\nb"]


def test_typed_text_around_paste():
    assert feed_lines([f"pre{PASTE_START}a{PASTE_END}"]) == ["prea"]
    assert feed_lines([f"{PASTE_START}a{PASTE_END}post"]) == ["apost"]
    assert feed_lines([f"pre{PASTE_START}a", f"b{PASTE_END}post"]) == [None, "prea\nbpost"]


def test_paste_with_trailing_newline_then_typed_text():
    assert feed_lines([f"{PASTE_START}a", f"{PASTE_END}x"]) == [None, "a\nx"]


def test_empty_paste():
    assert feed_lines([f"{PASTE_START}{PASTE_END}"]) == [None]
    # the Enter that follows submits an empty message (ignored by the loop)
    assert feed_lines([f"{PASTE_START}{PASTE_END}", ""]) == [None, ""]


def test_two_pastes_one_enter():
    assert feed_lines([f"{PASTE_START}a{PASTE_END} {PASTE_START}b{PASTE_END}"]) == ["a b"]


def test_paste_then_paste_before_enter():
    assert feed_lines([f"{PASTE_START}a", f"{PASTE_END}{PASTE_START}b{PASTE_END}"]) == [None, "a\nb"]


def test_crlf_lines_are_normalized():
    assert feed_lines([f"{PASTE_START}a\r", f"b{PASTE_END}\r"]) == [None, "a\nb"]


def test_after_submit_the_collector_resets():
    collector = PasteAwareInput()
    assert collector.feed(f"{PASTE_START}hola{PASTE_END}") == "hola"
    assert collector.feed("segunda línea") == "segunda línea"
