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
}

const DEFAULT_ROW_HEIGHT = 48;
const DEFAULT_OVERSCAN = 8;
const DEFAULT_THRESHOLD = 80;
const FALLBACK_VIEWPORT_HEIGHT = 600;

export function useVirtualRows<T, El extends HTMLElement = HTMLDivElement>(
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

    return useMemo(() => {
        if (!isVirtualized) {
            return {
                containerRef,
                visibleItems: items,
                startIndex: 0,
                topSpacerHeight: 0,
                bottomSpacerHeight: 0,
                isVirtualized: false,
            };
        }

        const totalCount = items.length;
        const visibleCount =
            Math.ceil(viewportHeight / rowHeight) + overscan * 2;
        const maxStart = Math.max(0, totalCount - visibleCount);
        const rawStart = Math.floor(scrollTop / rowHeight) - overscan;
        const startIndex = Math.max(0, Math.min(maxStart, rawStart));
        const endIndex = Math.min(totalCount, startIndex + visibleCount);

        return {
            containerRef,
            visibleItems: items.slice(startIndex, endIndex),
            startIndex,
            topSpacerHeight: startIndex * rowHeight,
            bottomSpacerHeight: Math.max(
                0,
                (totalCount - endIndex) * rowHeight,
            ),
            isVirtualized: true,
        };
    }, [isVirtualized, items, overscan, rowHeight, scrollTop, viewportHeight]);
}
