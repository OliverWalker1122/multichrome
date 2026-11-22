import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export function useSavedTableValue<T>(
    key: string,
    fallback: T,
    valid: (value: unknown) => value is T,
) {
    const [value, setValue] = useState<T>(() => {
        try {
            const stored: unknown = JSON.parse(
                window.localStorage.getItem(key) || 'null',
            );
            return valid(stored) ? stored : fallback;
        } catch {
            return fallback;
        }
    });
    useEffect(() => {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Preferences remain usable when local storage is unavailable.
        }
    }, [key, value]);
    return [value, setValue] as const;
}

export function useTableSelection<T extends { id: string }>(
    items: T[],
    selectedId: string | null,
    onSelect: (id: string | null) => void,
    onOpen: () => void,
) {
    const rows = useRef(new Map<string, HTMLTableRowElement>());
    const selected =
        items.find((item) => item.id === selectedId) || items[0] || null;
    const actualId = selected?.id || null;

    useLayoutEffect(() => {
        if (selectedId !== actualId) onSelect(actualId);
    }, [actualId, selectedId, onSelect]);

    const onKeyDown = (
        event: KeyboardEvent<HTMLTableRowElement>,
        index: number,
    ) => {
        // Buttons and menus in a row keep their own keyboard behavior.
        if (
            event.target !== event.currentTarget ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
        )
            return;
        let next = index;
        if (event.key === 'ArrowDown')
            next = Math.min(items.length - 1, index + 1);
        else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else if (event.key === 'Enter') {
            event.preventDefault();
            onSelect(items[index].id);
            onOpen();
            return;
        } else return;
        event.preventDefault();
        const item = items[next];
        if (!item) return;
        onSelect(item.id);
        const row = rows.current.get(item.id);
        row?.focus({ preventScroll: true });
        row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    const rowProps = (item: T, index: number) => ({
        ref: (element: HTMLTableRowElement | null) => {
            if (element) rows.current.set(item.id, element);
            else rows.current.delete(item.id);
        },
        tabIndex: item.id === actualId ? 0 : -1,
        onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) =>
            onKeyDown(event, index),
        onFocus: (event: React.FocusEvent<HTMLTableRowElement>) => {
            if (event.target === event.currentTarget) onSelect(item.id);
        },
    });

    return { selected, rowProps };
}
