import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

export interface UseVirtualRowsOptions {
    rowHeight?: number;
    overscan?: number;
    threshold?: number;
}

export interface UseVirtualRowsResult<
    T,
    El extends HTMLElement = HTMLDivElement,
> {
    containerRef: RefObject<El>;
    visibleItems: T[];
    startIndex: number;
    topSpacerHeight: number;
    bottomSpacerHeight: number;
    isVirtualized: boolean;
    scrollToIndex: (index: number) => void;
}

const DEFAULT_ROW_HEIGHT = 48;
const DEFAULT_OVERSCAN = 8;
const DEFAULT_THRESHOLD = 80;
const FALLBACK_VIEWPORT_HEIGHT = 600;

export function useVirtualRows<T extends { id: string }, El extends HTMLElement = HTMLDivElement>(
    items: T[],
    options: UseVirtualRowsOptions = {},
): UseVirtualRowsResult<T, El> {
    const rowHeight = Math.max(1, options.rowHeight ?? DEFAULT_ROW_HEIGHT);
    const overscan = Math.max(0, options.overscan ?? DEFAULT_OVERSCAN);
    const threshold = Math.max(0, options.threshold ?? DEFAULT_THRESHOLD);

    const containerRef = useRef<El>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(
        FALLBACK_VIEWPORT_HEIGHT,
    );

    const isVirtualized = items.length > threshold;

    useEffect(() => {
        if (!isVirtualized) {
            setScrollTop(0);
            return;
        }
        const container = containerRef.current;
        if (!container) return;

        let rafId: number | null = null;
        const syncMetrics = () => {
            setScrollTop(container.scrollTop);
            if (container.clientHeight > 0) {
                setViewportHeight(container.clientHeight);
            }
        };

        const handleScroll = () => {
            if (rafId !== null) return;
            rafId = window.requestAnimationFrame(() => {
                rafId = null;
                setScrollTop(container.scrollTop);
            });
        };

        syncMetrics();
        container.addEventListener('scroll', handleScroll, { passive: true });

        let observer: ResizeObserver | null = null;
        const handleResize = () => {
            if (container.clientHeight > 0) {
                setViewportHeight(container.clientHeight);
            }
        };

        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(handleResize);
            observer.observe(container);
        } else {
            window.addEventListener('resize', handleResize);
        }

        return () => {
            if (rafId !== null) {
                window.cancelAnimationFrame(rafId);
            }
            container.removeEventListener('scroll', handleScroll);
            if (observer) {
                observer.disconnect();
            } else {
                window.removeEventListener('resize', handleResize);
            }
        };
    }, [isVirtualized, items.length]);

    const [heights, setHeights] = useState(() => new Map<string, number>());
    const offsets = useMemo(() => {
        const result = [0];
        if (isVirtualized) for (const item of items) {
            result.push(result[result.length - 1] + (heights.get(item.id) || rowHeight));
        }
        return result;
    }, [items, isVirtualized, rowHeight, heights]);

    useEffect(() => {
        const container = containerRef.current;
        if (!isVirtualized || !container || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(entries => {
            const sizes = entries.map(entry => {
                const row = entry.target as HTMLElement;
                return [row.dataset.virtualId, row.getBoundingClientRect().height] as const;
            });
            setHeights(previous => {
                let next = previous;
                for (const [key, height] of sizes) {
                    if (key && height > 0 && previous.get(key) !== height) {
                        if (next === previous) next = new Map(previous);
                        next.set(key, height);
                    }
                }
                return next;
            });
        });
        const observe = () => {
            observer.disconnect();
            container.querySelectorAll('[data-virtual-id]').forEach(row => observer.observe(row));
        };
        observe();
        const mutations = new MutationObserver(observe);
        mutations.observe(container, { childList: true, subtree: true });
        return () => { mutations.disconnect(); observer.disconnect(); };
    }, [isVirtualized]);

    return useMemo(() => {
        const scrollToIndex = (index: number) => {
            if (isVirtualized && containerRef.current) {
                containerRef.current.scrollTop = offsets[index] || 0;
                setScrollTop(containerRef.current.scrollTop);
            }
        };
        if (!isVirtualized) {
            return {
                containerRef,
                scrollToIndex,
                visibleItems: items,
                startIndex: 0,
                topSpacerHeight: 0,
                bottomSpacerHeight: 0,
                isVirtualized: false,
            };
        }

        const totalCount = items.length;
        const indexAt = (position: number) => {
            let lo = 0, hi = totalCount;
            while (lo < hi) {
                const mid = Math.floor((lo + hi) / 2);
                if (offsets[mid + 1] <= position) lo = mid + 1;
                else hi = mid;
            }
            return lo;
        };
        const startIndex = Math.max(0, indexAt(scrollTop) - overscan);
        const endIndex = Math.min(totalCount, indexAt(scrollTop + viewportHeight) + 1 + overscan);

        return {
            containerRef,
            scrollToIndex,
            visibleItems: items.slice(startIndex, endIndex),
            startIndex,
            topSpacerHeight: offsets[startIndex],
            bottomSpacerHeight: offsets[totalCount] - offsets[endIndex],
            isVirtualized: true,
        };
    }, [isVirtualized, items, offsets, overscan, scrollTop, viewportHeight]);
}
