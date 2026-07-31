import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Speech from "expo-speech";
import { detectSpeechLanguage, normalizeForSpeech } from "./speech-text";

type PlaybackState = "idle" | "speaking" | "paused";

const SPEECH_RATES = [0.8, 1, 1.2] as const;

export function useIosSpeech(paragraphs: string[]) {
  const entries = useMemo(
    () =>
      paragraphs
        .map((text, paragraphIndex) => ({
          paragraphIndex,
          text: normalizeForSpeech(text),
        }))
        .filter((entry) => entry.text.length > 0),
    [paragraphs]
  );
  const language = useMemo(
    () => detectSpeechLanguage(entries.map((entry) => entry.text).join(" ")),
    [entries]
  );

  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [currentParagraph, setCurrentParagraph] = useState<number | null>(null);
  const [rate, setRate] = useState<(typeof SPEECH_RATES)[number]>(1);
  const [voice, setVoice] = useState<string | undefined>();
  const [error, setError] = useState("");
  const generationRef = useRef(0);
  const currentQueueIndexRef = useRef(0);
  const rateRef = useRef<(typeof SPEECH_RATES)[number]>(1);

  useEffect(() => {
    if (Platform.OS !== "ios" || !language) {
      setVoice(undefined);
      return;
    }

    let cancelled = false;
    void Speech.getAvailableVoicesAsync().then((voices) => {
      if (cancelled) return;
      const matching = voices.filter((candidate) =>
        candidate.language.toLowerCase().startsWith(language.slice(0, 2).toLowerCase())
      );
      const preferred =
        matching.find((candidate) => candidate.quality === Speech.VoiceQuality.Enhanced) ??
        matching[0];
      setVoice(preferred?.identifier);
    });

    return () => {
      cancelled = true;
    };
  }, [language]);

  const speakAt = useCallback(
    function speakQueueEntry(queueIndex: number, generation: number) {
      if (generation !== generationRef.current) return;
      const entry = entries[queueIndex];
      if (!entry) {
        setPlaybackState("idle");
        setCurrentParagraph(null);
        return;
      }

      currentQueueIndexRef.current = queueIndex;
      setCurrentParagraph(entry.paragraphIndex);
      setPlaybackState("speaking");
      Speech.speak(entry.text, {
        language,
        voice,
        rate: rateRef.current,
        useApplicationAudioSession: false,
        onDone: () => speakQueueEntry(queueIndex + 1, generation),
        onError: (speechError) => {
          if (generation !== generationRef.current) return;
          setPlaybackState("idle");
          setError(speechError.message || "Unable to read this chapter aloud.");
        },
      });
    },
    [entries, language, voice]
  );

  const stop = useCallback(async () => {
    generationRef.current += 1;
    await Speech.stop();
    setPlaybackState("idle");
    setCurrentParagraph(null);
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    void Speech.stop();
    setPlaybackState("idle");
    setCurrentParagraph(null);
  }, [entries]);

  const togglePlayback = useCallback(
    async (options?: { fromParagraphIndex?: number }) => {
      setError("");
      if (playbackState === "speaking") {
        await Speech.pause();
        setPlaybackState("paused");
        return;
      }
      if (playbackState === "paused") {
        await Speech.resume();
        setPlaybackState("speaking");
        return;
      }
      if (entries.length === 0) return;

      const fromParagraphIndex = Math.max(0, options?.fromParagraphIndex ?? 0);
      let queueIndex = entries.findIndex(
        (entry) => entry.paragraphIndex >= fromParagraphIndex
      );
      if (queueIndex < 0) {
        // Past the last speakable paragraph — start at the last entry.
        queueIndex = Math.max(0, entries.length - 1);
      }

      const generation = ++generationRef.current;
      await Speech.stop();
      speakAt(queueIndex, generation);
    },
    [entries, playbackState, speakAt]
  );

  const cycleRate = useCallback(async () => {
    const nextRate = SPEECH_RATES[(SPEECH_RATES.indexOf(rateRef.current) + 1) % SPEECH_RATES.length];
    rateRef.current = nextRate;
    setRate(nextRate);

    if (playbackState === "idle") return;
    const queueIndex = currentQueueIndexRef.current;
    const generation = ++generationRef.current;
    await Speech.stop();
    speakAt(queueIndex, generation);
  }, [playbackState, speakAt]);

  useEffect(() => {
    return () => {
      generationRef.current += 1;
      void Speech.stop();
    };
  }, []);

  return {
    supported: Platform.OS === "ios",
    playbackState,
    currentParagraph,
    rate,
    error,
    togglePlayback,
    cycleRate,
    stop,
  };
}
