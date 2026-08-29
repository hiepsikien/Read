import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type LayoutChangeEvent,
} from "react-native";
import { packBlocksIntoPages, pageIndexForParagraph, type ReaderPage } from "../lib/reader-pages";

type Props = {
  blockCount: number;
  renderBlock: (index: number) => ReactNode;
  /** Shown only on page 0 (title / chapter meta). */
  firstPageHeader?: ReactNode;
  pageHeight: number;
  pageWidth: number;
  mutedColor: string;
  followParagraphIndex: number | null;
  /** When true (TTS speaking), always advance pages to the spoken paragraph. */
  followEnabled?: boolean;
  initialParagraphIndex?: number;
  onPageChange: (pageIndex: number, page: ReaderPage, pageCount: number) => void;
  /** Call consume() from a note/paragraph press so edge-tap does not turn the page. */
  edgeTapGuardRef?: MutableRefObject<{ consume: () => void } | null>;
  /** Space reserved under page content for the footer row. */
  bottomReserve?: number;
  renderFooter?: (pageIndex: number, pageCount: number, isLast: boolean) => ReactNode;
};

export function ReaderPagesView({
  blockCount,
  renderBlock,
  firstPageHeader,
  pageHeight,
  pageWidth,
  mutedColor,
  followParagraphIndex,
  initialParagraphIndex = 0,
  onPageChange,
  followEnabled = false,
  edgeTapGuardRef,
  bottomReserve = 36,
  renderFooter,
}: Props) {
  const [heights, setHeights] = useState<(number | null)[]>(() =>
    Array.from({ length: blockCount }, () => null)
  );
  const [headerHeight, setHeaderHeight] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const pageIndexRef = useRef(0);
  const programmaticRef = useRef(false);
  const didInitialScrollRef = useRef(false);
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const wrapPageXRef = useRef(0);
  const ignoreEdgeTapRef = useRef(false);
  const pendingEdgeTapRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const consumeEdgeTap = useCallback(() => {
    ignoreEdgeTapRef.current = true;
    if (pendingEdgeTapRef.current) {
      clearTimeout(pendingEdgeTapRef.current);
      pendingEdgeTapRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!edgeTapGuardRef) return;
    edgeTapGuardRef.current = { consume: consumeEdgeTap };
    return () => {
      if (edgeTapGuardRef.current?.consume === consumeEdgeTap) {
        edgeTapGuardRef.current = null;
      }
    };
  }, [consumeEdgeTap, edgeTapGuardRef]);

  useEffect(() => {
    setHeights(Array.from({ length: blockCount }, () => null));
    didInitialScrollRef.current = false;
    setPageIndex(0);
    pageIndexRef.current = 0;
  }, [blockCount, pageWidth, contentHeight]);

  const contentHeight = Math.max(80, pageHeight - Math.max(0, bottomReserve));

  const allMeasured =
    blockCount === 0 ||
    (heights.length === blockCount && heights.every((h) => typeof h === "number" && h > 0));

  const pages = useMemo(() => {
    if (!allMeasured) return [{ startIndex: 0, endIndex: Math.max(blockCount, 0) }];
    const packed = packBlocksIntoPages(heights as number[], contentHeight);
    if (!firstPageHeader || headerHeight <= 0 || packed.length === 0) return packed;

    const firstPageBudget = Math.max(80, contentHeight - headerHeight);
    let used = 0;
    let cut = 0;
    for (let i = 0; i < (heights as number[]).length; i += 1) {
      const h = Math.max(1, (heights as number[])[i] || 1);
      const next = used === 0 ? h : used + 18 + h;
      if (used > 0 && next > firstPageBudget) break;
      used = next;
      cut = i + 1;
    }
    if (cut === 0 && (heights as number[]).length > 0) cut = 1;
    const rest = packBlocksIntoPages((heights as number[]).slice(cut), contentHeight);
    return [
      { startIndex: 0, endIndex: cut },
      ...rest.map((page) => ({
        startIndex: page.startIndex + cut,
        endIndex: page.endIndex + cut,
      })),
    ];
  }, [allMeasured, heights, contentHeight, blockCount, firstPageHeader, headerHeight]);

  const scrollToPage = useCallback(
    (index: number, animated: boolean) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, index));
      programmaticRef.current = true;
      pageIndexRef.current = clamped;
      setPageIndex(clamped);
      scrollRef.current?.scrollTo({ x: clamped * pageWidth, y: 0, animated });
      const page = pages[clamped];
      if (page) onPageChangeRef.current(clamped, page, pages.length);
      // Clear flag after animation / settle window.
      setTimeout(() => {
        programmaticRef.current = false;
      }, animated ? 350 : 50);
    },
    [pageWidth, pages]
  );

  // Initial jump once pages are ready.
  useEffect(() => {
    if (!allMeasured || pages.length === 0 || didInitialScrollRef.current) return;
    didInitialScrollRef.current = true;
    const startPage = pageIndexForParagraph(pages, initialParagraphIndex);
    scrollToPage(startPage, false);
  }, [allMeasured, pages, initialParagraphIndex, scrollToPage]);

  // TTS / follow: always jump while followEnabled, ignore prior user swipes.
  useEffect(() => {
    if (!followEnabled || followParagraphIndex == null || !allMeasured || pages.length === 0) {
      return;
    }
    const target = pageIndexForParagraph(pages, followParagraphIndex);
    if (target !== pageIndexRef.current) {
      scrollToPage(target, true);
    }
  }, [followEnabled, followParagraphIndex, allMeasured, pages, scrollToPage]);

  const emitFromOffset = useCallback(
    (x: number) => {
      const idx = Math.round(x / Math.max(1, pageWidth));
      const clamped = Math.max(0, Math.min(pages.length - 1, idx));
      pageIndexRef.current = clamped;
      setPageIndex(clamped);
      const page = pages[clamped];
      if (page) onPageChangeRef.current(clamped, page, pages.length);
    },
    [pageWidth, pages]
  );

  const onMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (programmaticRef.current) return;
      emitFromOffset(event.nativeEvent.contentOffset.x);
    },
    [emitFromOffset]
  );

  const onWrapLayout = useCallback((event: LayoutChangeEvent) => {
    wrapPageXRef.current = event.nativeEvent.layout.x;
  }, []);

  const onTouchStart = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    touchStartRef.current = {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
    };
  }, []);

  const onTouchEnd = useCallback(
    (event: { nativeEvent: { pageX: number; pageY: number } }) => {
      const start = touchStartRef.current;
      touchStartRef.current = null;
      if (!start || pages.length === 0) return;
      const dx = Math.abs(event.nativeEvent.pageX - start.x);
      const dy = Math.abs(event.nativeEvent.pageY - start.y);
      // Treat as tap only when movement is tiny (swipe goes to ScrollView paging).
      if (dx > 14 || dy > 14) return;
      const localX = event.nativeEvent.pageX - wrapPageXRef.current;
      const goPrev = localX < pageWidth * 0.28;
      const goNext = localX > pageWidth * 0.72;
      if (!goPrev && !goNext) return;
      if (pendingEdgeTapRef.current) clearTimeout(pendingEdgeTapRef.current);
      pendingEdgeTapRef.current = setTimeout(() => {
        pendingEdgeTapRef.current = null;
        if (ignoreEdgeTapRef.current) {
          ignoreEdgeTapRef.current = false;
          return;
        }
        scrollToPage(pageIndexRef.current + (goPrev ? -1 : 1), true);
      }, 70);
    },
    [pageWidth, pages.length, scrollToPage]
  );

  return (
    <View style={[styles.wrap, { width: pageWidth, height: pageHeight }]} onLayout={onWrapLayout}>
      {/* Offscreen measure pass */}
      <View style={styles.measure} pointerEvents="none">
        {firstPageHeader ? (
          <View
            onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
            style={{ width: pageWidth - 40 }}
          >
            {firstPageHeader}
          </View>
        ) : null}
        {Array.from({ length: blockCount }, (_, index) => (
          <View
            key={`m-${blockCount}-${index}`}
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              setHeights((prev) => {
                if (prev[index] === h) return prev;
                const next = [...prev];
                next[index] = h;
                return next;
              });
            }}
            style={{ width: pageWidth - 40 }}
          >
            {renderBlock(index)}
          </View>
        ))}
      </View>

      {allMeasured ? (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            bounces={false}
            disableIntervalMomentum
            scrollEventThrottle={16}
            onMomentumScrollEnd={onMomentumEnd}
            onScrollBeginDrag={() => {
              // User-driven swipe: leave TTS follow until the next spoken paragraph effect.
              programmaticRef.current = false;
            }}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            style={{ width: pageWidth, height: contentHeight }}
          >
            {pages.map((item, index) => (
              <View
                key={`page-${index}-${item.startIndex}-${item.endIndex}`}
                style={{
                  width: pageWidth,
                  height: contentHeight,
                  paddingHorizontal: 20,
                  overflow: "hidden",
                }}
              >
                <View style={{ gap: 18 }}>
                  {index === 0 && firstPageHeader ? firstPageHeader : null}
                  {Array.from(
                    { length: Math.max(0, item.endIndex - item.startIndex) },
                    (_, offset) => renderBlock(item.startIndex + offset)
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
          <View style={[styles.reserve, { height: Math.max(0, bottomReserve) }]}>
            {renderFooter ? (
              renderFooter(pageIndex, pages.length, pageIndex >= pages.length - 1)
            ) : (
              <Text style={[styles.indicator, { color: mutedColor }]} pointerEvents="none">
                {pageIndex + 1} / {pages.length}
              </Text>
            )}
          </View>
        </>
      ) : (
        <View style={styles.loading}>
          <Text style={{ color: mutedColor }}>Preparing pages…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative", overflow: "hidden" },
  measure: {
    position: "absolute",
    left: 0,
    top: 0,
    opacity: 0,
    zIndex: -1,
  },
  reserve: {
    justifyContent: "flex-start",
  },
  indicator: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
