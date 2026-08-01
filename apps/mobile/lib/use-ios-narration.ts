import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  type AudioSource,
} from "expo-audio";
import type { ApiClient, ChapterAudioManifest } from "@read/api-client";
import { getToken } from "./api";
import { useIosSpeech } from "./use-ios-speech";

type PlaybackState = "idle" | "preparing" | "speaking" | "paused";
type PlaybackRate = 0.8 | 1 | 1.2;

const PLAYBACK_RATES: PlaybackRate[] = [0.8, 1, 1.2];

type UseIosNarrationOptions = {
  api: ApiClient;
  bookId?: string;
  chapterId?: string;
  paragraphs: string[];
  onChapterComplete?: () => void;
};

export function useIosNarration({
  api,
  bookId,
  chapterId,
  paragraphs,
  onChapterComplete,
}: UseIosNarrationOptions) {
  const onChapterCompleteRef = useRef(onChapterComplete);
  onChapterCompleteRef.current = onChapterComplete;

  const nativeSpeech = useIosSpeech({
    paragraphs,
    onChapterComplete: () => onChapterCompleteRef.current?.(),
  });
  const player = useAudioPlayer(null, {
    updateInterval: 250,
    keepAudioSessionActive: true,
  });
  const playerStatus = useAudioPlayerStatus(player);
  const [manifest, setManifest] = useState<ChapterAudioManifest | null>(null);
  const [provider, setProvider] = useState<"cloud" | "native">("cloud");
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [currentSegment, setCurrentSegment] = useState<number | null>(null);
  const [rate, setRate] = useState<PlaybackRate>(1);
  const [error, setError] = useState("");
  const authorizationRef = useRef<Record<string, string>>({});
  const requestGenerationRef = useRef(0);
  const didHandleFinishRef = useRef(false);
  // Only honor didJustFinish after the player has actually been playing this clip,
  // so a sticky true from the previous segment cannot skip/finish instantly —
  // and so we do not suppress the real end-of-chapter edge.
  const armFinishDetectionRef = useRef(false);

  const playerReleasedRef = useRef(false);
  const manifestRef = useRef(manifest);
  const currentSegmentRef = useRef(currentSegment);
  const playbackStateRef = useRef(playbackState);
  const providerRef = useRef(provider);
  manifestRef.current = manifest;
  currentSegmentRef.current = currentSegment;
  playbackStateRef.current = playbackState;
  providerRef.current = provider;

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    });
  }, []);

  useEffect(() => {
    playerReleasedRef.current = false;
    return () => {
      playerReleasedRef.current = true;
    };
  }, [player]);

  // Navigation cleanup can outlive the player, which releases its native
  // object on unmount and throws on any later call.
  const runOnPlayer = useCallback(
    <T,>(action: (instance: typeof player) => T): T | undefined => {
      if (playerReleasedRef.current) return undefined;
      try {
        return action(player);
      } catch {
        playerReleasedRef.current = true;
        return undefined;
      }
    },
    [player]
  );

  const sourceFor = useCallback(
    (audioManifest: ChapterAudioManifest, index: number): AudioSource => ({
      uri: audioManifest.segments[index].url,
      headers: authorizationRef.current,
    }),
    []
  );

  const playSegment = useCallback(
    (audioManifest: ChapterAudioManifest, index: number) => {
      const segment = audioManifest.segments[index];
      if (!segment) {
        setPlaybackState("idle");
        setCurrentSegment(null);
        return;
      }
      // New clip must see a fresh finish edge — clear latch so a sticky
      // didJustFinish from the prior clip cannot be ignored forever (which
      // blocked onChapterComplete / banner / auto-advance).
      didHandleFinishRef.current = false;
      armFinishDetectionRef.current = false;
      runOnPlayer((instance) => {
        instance.replace(sourceFor(audioManifest, index));
        instance.setPlaybackRate(rate, "high");
        instance.play();
      });
      setCurrentSegment(index);
      setPlaybackState("speaking");
    },
    [rate, runOnPlayer, sourceFor]
  );

  const playSegmentRef = useRef(playSegment);
  playSegmentRef.current = playSegment;

  const startCloudPlayback = useCallback(
    async (fromParagraphIndex = 0) => {
      if (!bookId || !chapterId) return;
      const generation = ++requestGenerationRef.current;
      setPlaybackState("preparing");
      setError("");

      try {
        // Prefer ref so a stale callback cannot reuse the previous chapter's manifest.
        const cached = manifestRef.current;
        const [audioManifest, token] = await Promise.all([
          cached ?? api.prepareChapterAudio(bookId, chapterId),
          getToken(),
        ]);
        if (generation !== requestGenerationRef.current) return;
        if (audioManifest.segments.length === 0) {
          throw new Error("No narration segments were generated.");
        }

        authorizationRef.current = token ? { Authorization: `Bearer ${token}` } : {};
        manifestRef.current = audioManifest;
        setManifest(audioManifest);

        let startIndex = 0;
        for (let i = 0; i < audioManifest.segments.length; i += 1) {
          const paragraphIndex = audioManifest.segments[i].paragraph_index;
          if (paragraphIndex <= fromParagraphIndex) startIndex = i;
          if (paragraphIndex >= fromParagraphIndex) {
            startIndex = i;
            break;
          }
        }
        playSegment(audioManifest, startIndex);
      } catch {
        if (generation !== requestGenerationRef.current) return;
        setProvider("native");
        setPlaybackState("idle");
        setError("Cloud voice unavailable. Using the offline device voice.");
        await nativeSpeech.togglePlayback({ fromParagraphIndex });
      }
    },
    [api, bookId, chapterId, nativeSpeech, playSegment]
  );

  const togglePlayback = useCallback(
    async (options?: { fromParagraphIndex?: number }) => {
      if (provider === "native") {
        await nativeSpeech.togglePlayback(options);
        return;
      }
      if (playbackState === "preparing") return;
      if (playbackState === "speaking") {
        runOnPlayer((instance) => instance.pause());
        setPlaybackState("paused");
        return;
      }
      if (playbackState === "paused") {
        runOnPlayer((instance) => instance.play());
        setPlaybackState("speaking");
        return;
      }
      await startCloudPlayback(Math.max(0, options?.fromParagraphIndex ?? 0));
    },
    [nativeSpeech, playbackState, provider, runOnPlayer, startCloudPlayback]
  );

  /** Always begin playback (never pause/resume). Used for chapter auto-advance. */
  const startPlayback = useCallback(
    async (fromParagraphIndex = 0) => {
      if (provider === "native") {
        await nativeSpeech.stop();
        await nativeSpeech.togglePlayback({ fromParagraphIndex });
        return;
      }
      if (playbackState === "preparing") return;
      await startCloudPlayback(Math.max(0, fromParagraphIndex));
    },
    [nativeSpeech, playbackState, provider, startCloudPlayback]
  );

  const stop = useCallback(async () => {
    requestGenerationRef.current += 1;
    runOnPlayer((instance) => instance.pause());
    await runOnPlayer((instance) => instance.seekTo(0))?.catch(() => undefined);
    setPlaybackState("idle");
    setCurrentSegment(null);
    await nativeSpeech.stop();
  }, [nativeSpeech.stop, runOnPlayer]);

  const pause = useCallback(async () => {
    if (provider === "native") {
      if (nativeSpeech.playbackState === "speaking") await nativeSpeech.togglePlayback();
      return;
    }
    if (playbackState !== "speaking") return;
    runOnPlayer((instance) => instance.pause());
    setPlaybackState("paused");
  }, [nativeSpeech, playbackState, provider, runOnPlayer]);

  const cycleRate = useCallback(async () => {
    if (provider === "native") {
      await nativeSpeech.cycleRate();
      return;
    }
    const nextRate = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate) + 1) % PLAYBACK_RATES.length];
    setRate(nextRate);
    runOnPlayer((instance) => instance.setPlaybackRate(nextRate, "high"));
  }, [nativeSpeech, provider, rate, runOnPlayer]);

  // Advance from refs so background JS throttling / stale closures do not skip
  // segments. `didJustFinish` stays true until the next status tick, so latch.
  useEffect(() => {
    if (playerStatus.playing && playbackStateRef.current === "speaking") {
      armFinishDetectionRef.current = true;
    }

    if (!playerStatus.didJustFinish) {
      didHandleFinishRef.current = false;
      return;
    }
    if (!armFinishDetectionRef.current) return;
    if (didHandleFinishRef.current) return;
    if (providerRef.current !== "cloud") return;
    if (playbackStateRef.current !== "speaking") return;

    const audioManifest = manifestRef.current;
    const segment = currentSegmentRef.current;
    if (!audioManifest || segment === null) return;

    didHandleFinishRef.current = true;
    armFinishDetectionRef.current = false;
    const nextSegment = segment + 1;
    if (nextSegment >= audioManifest.segments.length) {
      setPlaybackState("idle");
      setCurrentSegment(null);
      onChapterCompleteRef.current?.();
      return;
    }
    playSegmentRef.current(audioManifest, nextSegment);
  }, [playerStatus.didJustFinish, playerStatus.playing]);

  // Discards the cached manifest so the next play refetches it. Needed after the
  // server voice changes, because segment URLs are keyed by voice.
  const reset = useCallback(() => {
    requestGenerationRef.current += 1;
    runOnPlayer((instance) => instance.pause());
    manifestRef.current = null;
    setManifest(null);
    setProvider("cloud");
    setPlaybackState("idle");
    setCurrentSegment(null);
    setError("");
  }, [runOnPlayer]);

  useEffect(() => {
    // Only when the chapter identity changes — not when `reset` callback identity churns,
    // which previously aborted in-flight prepareChapterAudio and killed autoplay.
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: bookId/chapterId only
  }, [bookId, chapterId]);

  /**
   * Swaps to the voice the server now returns without losing the listener's
   * place. Segment indices are voice-independent — only the cache key behind
   * each URL changes — so the old index still points at the same text.
   */
  const reloadVoice = useCallback(async () => {
    if (!bookId || !chapterId) return;

    // Nothing is queued up, so the next Play already fetches the new voice.
    if (provider !== "cloud" || playbackState === "idle" || currentSegment === null) {
      await nativeSpeech.stop();
      reset();
      return;
    }

    const resumeIndex = currentSegment;
    const shouldResume = playbackState === "speaking";
    const generation = ++requestGenerationRef.current;

    runOnPlayer((instance) => instance.pause());
    setPlaybackState("preparing");
    setError("");

    try {
      const [audioManifest, token] = await Promise.all([
        api.prepareChapterAudio(bookId, chapterId),
        getToken(),
      ]);
      if (generation !== requestGenerationRef.current) return;
      if (audioManifest.segments.length === 0) {
        throw new Error("No narration segments were generated.");
      }

      authorizationRef.current = token ? { Authorization: `Bearer ${token}` } : {};
      setManifest(audioManifest);

      const index = Math.min(resumeIndex, audioManifest.segments.length - 1);
      if (shouldResume) {
        playSegment(audioManifest, index);
        return;
      }

      // Stage the segment so Resume continues here instead of restarting.
      runOnPlayer((instance) => {
        instance.replace({
          uri: audioManifest.segments[index].url,
          headers: authorizationRef.current,
        });
        instance.setPlaybackRate(rate, "high");
      });
      setCurrentSegment(index);
      setPlaybackState("paused");
    } catch {
      if (generation !== requestGenerationRef.current) return;
      setManifest(null);
      setCurrentSegment(null);
      setPlaybackState("idle");
      setError("Could not switch to the new voice.");
    }
  }, [
    api,
    bookId,
    chapterId,
    currentSegment,
    nativeSpeech,
    playSegment,
    playbackState,
    provider,
    rate,
    reset,
    runOnPlayer,
  ]);

  const cloudParagraph =
    manifest && currentSegment !== null
      ? manifest.segments[currentSegment]?.paragraph_index ?? null
      : null;

  return {
    supported: Platform.OS === "ios",
    playbackState:
      provider === "native" ? nativeSpeech.playbackState : playbackState,
    currentParagraph:
      provider === "native" ? nativeSpeech.currentParagraph : cloudParagraph,
    rate: provider === "native" ? nativeSpeech.rate : rate,
    error: error || nativeSpeech.error,
    provider,
    manifest,
    togglePlayback,
    startPlayback,
    cycleRate,
    stop,
    pause,
    reset,
    reloadVoice,
  };
}
