import type { CSSProperties } from 'react';
import './semanticColors.css';

export type AccentTone =
    'green' | 'teal' | 'blue' | 'violet' | 'amber' | 'rose';
const groupTones: AccentTone[] = [
    'teal',
    'violet',
    'blue',
    'amber',
    'rose',
    'green',
];

/** Stable category colours keep groups recognisable across pages and sessions. */
export function getGroupTone(name: string): AccentTone {
    let hash = 0;
    for (const character of name)
        hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
    return groupTones[hash % groupTones.length];
}

export function getToneStyle(tone: AccentTone): CSSProperties {
    return {
        color: `var(--tone-${tone}-foreground)`,
        backgroundColor: `var(--tone-${tone}-background)`,
    };
}

export function getGroupStyle(name: string): CSSProperties {
    return getToneStyle(getGroupTone(name));
}

export function getTagTone(tag: string): AccentTone {
    const normalized = tag.trim().toLowerCase();
    let hash = 7;
    for (const character of normalized)
        hash = (hash * 37 + character.codePointAt(0)!) >>> 0;
    return groupTones[hash % groupTones.length];
}

export function getTagStyle(tag: string): CSSProperties {
    return getToneStyle(getTagTone(tag));
}

export function getProtocolStyle(protocol: string): CSSProperties {
    const tones: Record<string, AccentTone> = {
        http: 'blue',
        https: 'blue',
        socks: 'teal',
        socks5: 'teal',
        vless: 'violet',
        vmess: 'violet',
        shadowsocks: 'amber',
        trojan: 'rose',
        tuic: 'green',
        hysteria2: 'green',
    };
    return getToneStyle(tones[protocol.toLowerCase()] || 'teal');
}
