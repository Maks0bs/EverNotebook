import pytest

from rag import CHUNK_SIZE, chunk_text

MULTI_PARAGRAPH = "\n\n".join(
    f"Paragraph {i}. " + ("Lorem ipsum dolor sit amet, consectetur. " * 6)
    for i in range(12)
)

UNICODE_TEXT = "\n\n".join(
    [
        "héllo wörld — this paragraph has accénted charactërs and an emoji 😀.",
        "第二段は日本語です。漢字とひらがなとカタカナが混ざっています。" * 8,
        "Third paragraph, plain ascii again, but with a trailing emoji 🎉🎉🎉.",
        "Emoji-only paragraph: 🚀🔥✨💥🌟" * 40,
    ]
)

INCONSISTENT_SEPARATORS = (
    "Line one with no blank line after it.\n"
    "Line two, still single-newline separated.\n"
    "Line three, same deal, no blank lines anywhere in this fixture.\n"
    + ("Padding line to force an oversized paragraph that must hard-split. " * 20)
    + "\nLine four after the padding.\n"
    "Line five.   \n"
    "   \n"
    "Paragraph after a whitespace-only blank line, with trailing spaces.   \n\n"
    "Final paragraph."
)

FIXTURES = {
    "multi_paragraph": MULTI_PARAGRAPH,
    "unicode": UNICODE_TEXT,
    "inconsistent_separators": INCONSISTENT_SEPARATORS,
}


@pytest.mark.parametrize("content", FIXTURES.values(), ids=FIXTURES.keys())
def test_offset_round_trip(content):
    chunks = chunk_text(content)

    assert chunks, "expected at least one chunk"

    for chunk in chunks:
        assert 0 <= chunk["start_char"] < chunk["end_char"] <= len(content)
        # The non-negotiable invariant: chunk content is always a literal
        # slice of the source string, never rebuilt/joined/normalised text.
        assert content[chunk["start_char"] : chunk["end_char"]] == chunk["content"]

    # Chunks are produced in order and make forward progress.
    starts = [c["start_char"] for c in chunks]
    assert starts == sorted(starts)
    assert len(set((c["start_char"], c["end_char"]) for c in chunks)) == len(chunks)

    # Overlap/packing sanity: no chunk is wildly larger than the target size.
    # A chunk may exceed CHUNK_SIZE by a handful of characters when it starts
    # with a paragraph separator carried over from continuing exactly where
    # the previous chunk ended (avoiding a gap takes priority over the exact
    # size target, since "~1000 chars" is approximate but leaving source text
    # un-chunked would not be).
    for chunk in chunks:
        assert chunk["end_char"] - chunk["start_char"] <= CHUNK_SIZE + 20

    # Full content is covered: the last chunk reaches the end of the string,
    # and consecutive chunks never leave a gap of un-chunked text.
    assert chunks[-1]["end_char"] == len(content)
    for prev, nxt in zip(chunks, chunks[1:]):
        assert nxt["start_char"] <= prev["end_char"]
