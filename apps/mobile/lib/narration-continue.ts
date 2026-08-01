/**
 * Cross-mount flags for continuous listening across chapter navigations.
 * Kept module-level so expo-router replace remounts still see them.
 */

let suppressStopOnBlur = false;
let pendingAutoPlay = false;

export function requestNarrationContinue() {
  suppressStopOnBlur = true;
  pendingAutoPlay = true;
}

export function consumeSuppressNarrationStopOnBlur() {
  if (!suppressStopOnBlur) return false;
  suppressStopOnBlur = false;
  return true;
}

export function consumeNarrationAutoPlay() {
  if (!pendingAutoPlay) return false;
  pendingAutoPlay = false;
  // Param-only replaces may not blur; clear suppress so a later leave still stops.
  suppressStopOnBlur = false;
  return true;
}
