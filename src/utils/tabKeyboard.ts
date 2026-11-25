import type { KeyboardEvent } from 'react';

export function moveTabFocus(event: KeyboardEvent<HTMLElement>) {
    const tabs = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="tab"], [role="radio"]',
        ),
    );
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
}
