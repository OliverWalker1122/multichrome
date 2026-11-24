#!/usr/bin/env node
/**
 * Generate a crisp, shields.io-compatible flat SVG badge with zero external dependencies.
 *
 * Usage:
 *   node scripts/generate-badge-svg.mjs --label="tests" --message="159/159 passed (100%)" --color="#16a34a" --out="tests.svg"
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
    const opts = { label: '', message: '', color: '#0969da', out: '' };
    for (const arg of argv) {
        if (arg.startsWith('--label=')) opts.label = arg.slice('--label='.length);
        else if (arg.startsWith('--message=')) opts.message = arg.slice('--message='.length);
        else if (arg.startsWith('--color=')) opts.color = arg.slice('--color='.length);
        else if (arg.startsWith('--out=')) opts.out = arg.slice('--out='.length);
    }
    return opts;
}

function escapeXml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function measureTextWidth(text) {
    // Approximate Verdana 11px glyph widths (px) with slight padding safety margin.
    let width = 0;
    for (const ch of String(text)) {
        if ('ilIjtfr1|!.,:;()[] '.includes(ch)) width += 4.2;
        else if ('mwMW@%'.includes(ch)) width += 9.8;
        else if (/[A-Z]/.test(ch)) width += 7.4;
        else if (/[0-9]/.test(ch)) width += 6.8;
        else width += 6.5;
    }
    return Math.ceil(width);
}

export function renderBadgeSvg({ label, message, color = '#0969da' }) {
    const hexColor = color.startsWith('#') ? color : `#${color}`;
    const labelWidth = measureTextWidth(label) + 12;
    const msgWidth = measureTextWidth(message) + 12;
    const totalWidth = labelWidth + msgWidth;

    const labelText = escapeXml(label);
    const msgText = escapeXml(message);
    const title = escapeXml(`${label}: ${message}`);
    const labelX = Math.round((labelWidth / 2) * 10);
    const msgX = Math.round((labelWidth + msgWidth / 2) * 10);
    const labelTextLen = (labelWidth - 10) * 10;
    const msgTextLen = (msgWidth - 10) * 10;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${title}">
  <title>${title}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${msgWidth}" height="20" fill="${escapeXml(hexColor)}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${labelTextLen}">${labelText}</text>
    <text x="${labelX}" y="140" transform="scale(.1)" fill="#fff" textLength="${labelTextLen}">${labelText}</text>
    <text aria-hidden="true" x="${msgX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${msgTextLen}">${msgText}</text>
    <text x="${msgX}" y="140" transform="scale(.1)" fill="#fff" textLength="${msgTextLen}">${msgText}</text>
  </g>
</svg>
`;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.out) {
    const svg = renderBadgeSvg(opts);
    fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    fs.writeFileSync(opts.out, svg, 'utf8');
}
