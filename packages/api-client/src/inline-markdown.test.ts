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

console.log("ok");
