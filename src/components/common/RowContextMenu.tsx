import React, { useEffect, useLayoutEffect, useRef } from 'react';

interface Props {
    x: number;
    y: number;
    label: string;
    className: string;
    onClose: () => void;
    children: React.ReactNode;
}

export default function RowContextMenu({
    x,
    y,
    label,
    className,
    onClose,
    children,
}: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLElement | null>(null);

    useLayoutEffect(() => {
        const menu = ref.current;
        if (!menu) return;
        if (!menu.contains(document.activeElement)) {
            trigger.current =
                document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
        }
        const bounds = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
        menu.querySelector<HTMLButtonElement>('button:enabled')?.focus({
            preventScroll: true,
        });
    }, [x, y]);

    useEffect(() => {
        const closeOutside = (event: Event) => {
            if (
                !(event.target instanceof Node) ||
                !ref.current?.contains(event.target)
            )
                onClose();
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('click', closeOutside, true);
        window.addEventListener('scroll', closeOutside, true);
        window.addEventListener('keydown', closeOnEscape);
        window.addEventListener('resize', onClose);
        return () => {
            window.removeEventListener('click', closeOutside, true);
            window.removeEventListener('scroll', closeOutside, true);
            window.removeEventListener('keydown', closeOnEscape);
            window.removeEventListener('resize', onClose);
        };
    }, [onClose]);

    return (
        <div
            ref={ref}
            role="menu"
            aria-label={label}
            className={className}
            style={{
                left: x,
                top: y,
                maxHeight: 'calc(100vh - 16px)',
                overflowY: 'auto',
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
                if (event.key === 'Escape' || event.key === 'Tab') {
                    if (event.key === 'Escape') event.preventDefault();
                    event.stopPropagation();
                    trigger.current?.focus({ preventScroll: true });
                    onClose();
                    return;
                }
                const items = Array.from(
                    event.currentTarget.querySelectorAll<HTMLButtonElement>(
                        'button:enabled',
                    ),
                );
                const index = items.indexOf(event.target as HTMLButtonElement);
                const next = {
                    ArrowDown: (index + 1) % items.length,
                    ArrowUp: (index + items.length - 1) % items.length,
                    Home: 0,
                    End: items.length - 1,
                }[event.key];
                if (next === undefined) return;
                event.preventDefault();
                items[next]?.focus();
            }}
        >
            {children}
        </div>
    );
}
