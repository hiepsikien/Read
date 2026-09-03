import assert from "node:assert/strict";
import {
  annotateInlineTokens,
  parseContentBlocks,
  parseInlineMarkdown,
  type ReaderNote,
} from "./index.ts";

function texts(value: string) {
  return parseInlineMarkdown(value).map((token) => ({
    text: token.text,
    bold: token.bold,
    italic: token.italic,
  }));
}

assert.deepEqual(texts("plain *italic* and **bold**"), [
  { text: "plain ", bold: false, italic: false },
  { text: "italic", bold: false, italic: true },
  { text: " and ", bold: false, italic: false },
  { text: "bold", bold: true, italic: false },
]);

assert.deepEqual(texts("it _floats on air_!"), [
  { text: "it ", bold: false, italic: false },
  { text: "floats on air", bold: false, italic: true },
  { text: "!", bold: false, italic: false },
]);

assert.deepEqual(texts("_Der mächtige Zauberer._ remains"), [
  { text: "Der mächtige Zauberer.", bold: false, italic: true },
  { text: " remains", bold: false, italic: false },
]);

assert.deepEqual(texts("_______________________"), [
  { text: "_______________________", bold: false, italic: false },
]);

assert.deepEqual(texts("keep foo_bar_baz intact"), [
  { text: "keep foo_bar_baz intact", bold: false, italic: false },
]);

assert.deepEqual(texts("open _italic never closes"), [
  { text: "open _italic never closes", bold: false, italic: false },
]);

assert.deepEqual(texts("escaped \\_not italic\\_"), [
  { text: "escaped _not italic_", bold: false, italic: false },
]);

const grotiusTitle = parseContentBlocks(
  [
    "_The Portuguese have no right by title of discovery to sovereignty",
    "",
    "over the East Indies to which the Dutch make voyages_",
    "",
    "The Portuguese are not sovereigns of those parts.",
  ].join("\n"),
);
assert.equal(grotiusTitle.length, 2);
assert.deepEqual(texts(grotiusTitle[0].type === "text" ? grotiusTitle[0].value : ""), [
  {
    text: "The Portuguese have no right by title of discovery to sovereignty over the East Indies to which the Dutch make voyages",
    bold: false,
    italic: true,
  },
]);
assert.equal(
  grotiusTitle[1].type === "text" ? grotiusTitle[1].value : "",
  "The Portuguese are not sovereigns of those parts.",
);

const verse = parseContentBlocks(
  [
    "“_What men, what monsters, what inhuman race,",
    "",
    "What laws, what barbarous customs of the place,",
    "",
    "And drive us to the cruel seas again._”[6]",
  ].join("\n"),
);
assert.equal(verse.length, 1);
assert.deepEqual(texts(verse[0].type === "text" ? verse[0].value : ""), [
  { text: "“", bold: false, italic: false },
  {
    text: "What men, what monsters, what inhuman race, What laws, what barbarous customs of the place, And drive us to the cruel seas again.",
    bold: false,
    italic: true,
  },
  { text: "”[6]", bold: false, italic: false },
]);

function note(id: string, name: string, aliases: string[] = []): ReaderNote {
  return {
    id,
    name,
    aliases,
    episode_key: "",
    episode_title: "",
    group_label: "Chú thích",
  };
}

// A glossary phrase inside an italic run must not break the `_…_` pair.
const thesis = "_Theo Luật các dân tộc, tự do hàng hải là quyền của mọi người_";
assert.deepEqual(
  annotateInlineTokens(thesis, [note("n1", "Luật các dân tộc")]).map((token) => ({
    text: token.text,
    italic: token.italic,
    noteId: token.noteId,
  })),
  [
    { text: "Theo ", italic: true, noteId: undefined },
    { text: "Luật các dân tộc", italic: true, noteId: "n1" },
    {
      text: ", tự do hàng hải là quyền của mọi người",
      italic: true,
      noteId: undefined,
    },
  ],
);

// Notes outside any marker keep working, and bold survives the same overlay.
assert.deepEqual(
  annotateInlineTokens("plain **Ulpian** tail", [note("n2", "Ulpian")]).map((token) => ({
    text: token.text,
    bold: token.bold,
    noteId: token.noteId,
  })),
  [
    { text: "plain ", bold: false, noteId: undefined },
    { text: "Ulpian", bold: true, noteId: "n2" },
    { text: " tail", bold: false, noteId: undefined },
  ],
);

// No matching note leaves the plain markdown result untouched.
assert.deepEqual(annotateInlineTokens(thesis, []), parseInlineMarkdown(thesis));

import {
  buildReaderBlocks,
  notesFromRefBlocks,
  normalizeExplainLanguage,
  tokensFromRefSpans,
  uniqueNotesFromTokens,
} from "./index.ts";

const arnoldNote: ReaderNote = {
  id: "note-1",
  name: "[1]",
  aliases: ["[1]"],
  episode_key: "ch-001",
  episode_title: "",
  group_label: "Chú thích",
  summary: "Arnold's phrase.",
};

assert.deepEqual(
  tokensFromRefSpans(
    "Poetry is the criticism of life.[1]",
    [
      { style: "em", start: 0, end: 6, text: "Poetry" },
      { style: "footnote", start: 32, end: 35, text: "[1]" },
    ],
    [arnoldNote]
  ).map((token) => ({
    text: token.text,
    italic: token.italic,
    noteId: token.noteId,
  })),
  [
    { text: "Poetry", italic: true, noteId: undefined },
    { text: " is the criticism of life.", italic: false, noteId: undefined },
    { text: "[1]", italic: false, noteId: "note-1" },
  ]
);

assert.deepEqual(
  tokensFromRefSpans("_italics_", [{ style: "em", start: 0, end: 9, text: "_italics_" }], []).map(
    (token) => ({ text: token.text, italic: token.italic })
  ),
  [{ text: "italics", italic: true }]
);

const rendered = buildReaderBlocks("fallback", {
  refBlocks: [
    {
      type: "paragraph",
      text: "Poetry is the criticism of life.[1]",
      spans: [{ style: "footnote", start: 32, end: 35, text: "[1]" }],
    },
    { type: "metadata", text: "skip me" },
    { type: "hr" },
  ],
  notes: [arnoldNote],
});
assert.equal(rendered.length, 2);
assert.equal(rendered[0]?.kind, "prose");
assert.equal(rendered[1]?.kind, "hr");
if (rendered[0]?.kind === "prose") {
  assert.ok(rendered[0].tokens.some((token) => token.noteId === "note-1"));
}

const spanOnlyBlocks = [
  {
    type: "paragraph",
    text: "Poetry is the criticism of life.[1]",
    spans: [
      {
        style: "footnote",
        start: 32,
        end: 35,
        text: "[1]",
        note: "Arnold's phrase from the page.",
      },
    ],
  },
];
const mergedSpanNotes = notesFromRefBlocks(spanOnlyBlocks, []);
assert.equal(mergedSpanNotes.length, 1);
assert.equal(mergedSpanNotes[0]?.id, "span-note:[1]");
assert.equal(mergedSpanNotes[0]?.summary, "Arnold's phrase from the page.");
const spanOnlyRendered = buildReaderBlocks("fallback", { refBlocks: spanOnlyBlocks, notes: [] });
if (spanOnlyRendered[0]?.kind === "prose") {
  const noteId = spanOnlyRendered[0].tokens.find((token) => token.noteId)?.noteId;
  assert.equal(noteId, "span-note:[1]");
  assert.equal(uniqueNotesFromTokens(spanOnlyRendered[0].tokens, []).length, 0);
  assert.equal(uniqueNotesFromTokens(spanOnlyRendered[0].tokens, mergedSpanNotes).length, 1);
}

const emptyCatalogNote: ReaderNote = {
  id: "note-empty",
  name: "[1]",
  aliases: ["[1]"],
  episode_key: "ch-001",
  episode_title: "",
  group_label: "Chú thích",
  summary: "",
};
assert.equal(
  notesFromRefBlocks(spanOnlyBlocks, [emptyCatalogNote])[0]?.summary,
  "Arnold's phrase from the page."
);

assert.deepEqual(
  tokensFromRefSpans("~Adlung~ wrote", [{ style: "strong", start: 0, end: 8, text: "~Adlung~" }], []).map(
    (token) => ({ text: token.text, bold: token.bold, italic: token.italic })
  ),
  [
    { text: "Adlung", bold: true, italic: false },
    { text: " wrote", bold: false, italic: false },
  ]
);

const hostedBlocks = [
  {
    type: "paragraph",
    block_id: "ch-001:paragraph:he-studied",
    text: "He studied with Adlung.[12]",
    spans: [
      {
        style: "footnote",
        start: 23,
        end: 27,
        text: "[12]",
        note: "Adlung of Erfurt.",
      },
    ],
  },
];
const hostedNotes = notesFromRefBlocks(hostedBlocks, []);
assert.equal(hostedNotes[0]?.host_block_id, "ch-001:paragraph:he-studied");
assert.equal(hostedNotes[0]?.host_text, "He studied with Adlung.[12]");

const layout = buildReaderBlocks("fallback", {
  chapterTitle: "CHAPTER III",
  refBlocks: [
    { type: "heading", level: 1, text: "CHAPTER III", suppress_in_reader: true },
    { type: "paragraph", role: "synopsis", text: "Birth — Eisenach — 1685." },
    { type: "paragraph", hidden: true, role: "aside", text: "[Sidenote: running header]" },
    {
      type: "paragraph",
      text: "He studied with ~Adlung~.",
      spans: [{ style: "strong", start: 16, end: 24, text: "~Adlung~" }],
    },
    { type: "paragraph", role: "figure", text: "Portrait of Bach" },
    { type: "heading", level: 1, text: "CHAPTER III" },
  ],
});
assert.equal(layout.length, 3);
assert.equal(layout[0]?.kind, "prose");
if (layout[0]?.kind === "prose") {
  assert.equal(layout[0].role, "synopsis");
  assert.equal(layout[0].value, "Birth — Eisenach — 1685.");
}
assert.equal(layout[1]?.kind, "prose");
if (layout[1]?.kind === "prose") {
  assert.ok(layout[1].tokens.some((token) => token.bold && token.text === "Adlung"));
}
assert.equal(layout[2]?.kind, "figure");
if (layout[2]?.kind === "figure") {
  assert.equal(layout[2].caption, "Portrait of Bach");
  assert.equal(layout[2].src, "");
}

assert.equal(normalizeExplainLanguage("VI"), "vi");
assert.equal(normalizeExplainLanguage("en-GB"), "en");
assert.equal(normalizeExplainLanguage("de", "vi"), "vi");

console.log("ok");
