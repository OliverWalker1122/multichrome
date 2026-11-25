import { useState } from 'react';

function matches<T>(left: T, right: T): boolean {
    return Object.is(left, right) || (
        typeof left === 'object' && typeof right === 'object' &&
        JSON.stringify(left) === JSON.stringify(right)
    );
}

/** Merge refreshed records one field at a time, retaining local edits. */
export function useDraftField<T>(source: T, recordId = '') {
    const [baseline, setBaseline] = useState({ source, recordId });
    const [draft, setDraft] = useState<T>(source);
    if (baseline.recordId !== recordId || !matches(baseline.source, source)) {
        setBaseline({ source, recordId });
        if (baseline.recordId !== recordId || matches(draft, baseline.source)) {
            setDraft(source);
        }
    }
    return [draft, setDraft] as const;
}
