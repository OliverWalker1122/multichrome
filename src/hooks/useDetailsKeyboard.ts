import { useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

/** Keep the compact details pane usable without leaving the keyboard. */
export function useDetailsKeyboard(overlay: boolean, onClose: () => void) {
    const ref = useRef<HTMLElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null);
    const focusable = () =>
        Array.from(
            ref.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
            ) || [],
        ).filter((element) => element.offsetParent !== null);

    useLayoutEffect(() => {
        if (!previousFocus.current?.isConnected) {
            previousFocus.current =
                document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
        }
        const previous = previousFocus.current;
        const panel = ref.current;
        panel?.focus({ preventScroll: true });
        return () => {
            // Selecting another item remounts its pane. Only restore focus when
            // details actually close, not while a new item's pane is mounting.
            requestAnimationFrame(() => {
                if (
                    !document.querySelector('[data-details-panel]') &&
                    previous?.isConnected
                ) {
                    previous.focus({ preventScroll: true });
                }
            });
        };
    }, []);

    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        // Portalled menus and dialogs retain their own Escape behaviour.
        if (
            event.defaultPrevented ||
            !ref.current?.contains(event.target as Node)
        )
            return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        }
        if (!overlay || event.key !== 'Tab') return;
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!first) {
            event.preventDefault();
            ref.current?.focus();
        } else if (
            event.shiftKey &&
            (document.activeElement === first ||
                document.activeElement === ref.current)
        ) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };

    return {
        ref,
        onKeyDownCapture: onKeyDown,
        tabIndex: -1,
        'data-details-panel': true,
    } as const;
}
