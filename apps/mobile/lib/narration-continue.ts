/**
 * Cross-mount flags for continuous listening across chapter navigations.
 * Kept module-level so expo-router replace remounts still see them.
 */

export type ChapterTransition = {
  position: number;
  title: string;
};

let continueActive = false;
let pendingAutoPlay = false;

export function requestNarrationContinue(_transition?: ChapterTransition) {
  continueActive = true;
  pendingAutoPlay = true;
}

/** Peek — do not clear. Used so focus cleanup cannot kill a mid-continue play. */
export function isNarrationContinueActive() {
  return continueActive;
}

/** Peek — stay true until playback is confirmed speaking (allows retries). */
export function isNarrationAutoPlayPending() {
  return pendingAutoPlay;
}

/** Clear after playback has actually started, or when leaving the reader. */
export function clearNarrationContinue() {
  continueActive = false;
  pendingAutoPlay = false;
}
