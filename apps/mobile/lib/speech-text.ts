/**
 * Prepare reader content for speech without removing punctuation that the
 * synthesizer needs for natural pauses.
 */
export function normalizeForSpeech(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\[(?:\d+(?:\s*[,–-]\s*\d+)*)\]/g, "")
    .replace(/\((?:\d+(?:\s*[,–-]\s*\d+)*)\)/g, "")
    .replace(/^\s*(?:[-*+•]|\d+[.)]|[a-zA-Z][.)])\s+/gm, "")
    .replace(/^\s*\d+\s*$/gm, "")
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, "$2")
    .replace(/[`#>~]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:!?])\1+/g, "$1")
    .replace(/\.{4,}/g, "...")
    .trim();
}

export function detectSpeechLanguage(value: string): "vi-VN" | undefined {
  return /[ăâđêôơưĂÂĐÊÔƠƯ]|[àáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(value)
    ? "vi-VN"
    : undefined;
}
