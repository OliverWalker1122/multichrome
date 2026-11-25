'use strict';

// CDP evaluates this function in the page. Keep it self-contained and return only audit states.
function inspectPixelScan(document) {
    if (document.querySelector('#main-frame-error')) {
        return { error: 'Browser navigation error' };
    }

    const lines = (document.body?.innerText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const start = lines.findIndex(line => /^fingerprint scan$/i.test(line));
    const scan = lines.slice(Math.max(0, start));
    const end = scan.findIndex(line => /^(?:what websites see about you|frequently asked questions|faq)$/i.test(line));
    const summary = end < 0 ? scan : scan.slice(0, end);
    const challenge = /^(?:just a moment|(?:please )?verify (?:that )?you are (?:a )?human(?: by completing the action below)?|checking (?:your browser|if (?:the site connection is secure|you are human)))[.!…]*$/i;
    const challengeFrame = [
        'iframe[src^="https://challenges.cloudflare.com/"]',
        'iframe[src*="/recaptcha/"][src*="/bframe"]',
        'iframe[src*="/recaptcha/"][src*="/anchor"]:not([src*="size=invisible"])',
        'iframe[src*="hcaptcha.com/"][title*="challenge" i]',
    ].join(',');
    if (challenge.test(document.title.trim()) || summary.some(line => challenge.test(line)) ||
        Array.from(document.querySelectorAll(challengeFrame)).some(frame =>
            frame.clientWidth > 0 && frame.clientHeight > 0 &&
            frame.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
        )) {
        return { blocked: 'CAPTCHA/Challenge' };
    }

    if ([document.title, ...summary].some(line => /^(?:404(?:\s*[-:|]?\s*(?:page )?not found)?|page not found)$/i.test(line))) {
        return { error: 'Page not found' };
    }
    const verdicts = new Set();
    const headline = /^(?:(?:your|this|the)\s+)?(?:browser\s+)?fingerprint(?:\s+(?:is|looks|seems|appears)(?:\s+to be)?)?[\s:–—-]+(inconsistent|consistent)[.!]?$/i;
    for (let i = 0; i < summary.length; i++) {
        let line = summary[i];
        if (/^(?:inconsistent|consistent)[.!]?$/i.test(summary[i + 1])) {
            line += ' ' + summary[i + 1];
        }
        const match = headline.exec(line) || /^(inconsistent|consistent)\s+(?:browser\s+)?fingerprint[.!]?$/i.exec(line);
        if (match) verdicts.add(match[1].toLowerCase());
    }
    if (verdicts.size === 1) return { ready: true, verdict: [...verdicts][0] };
    return { ready: false };
}

module.exports = inspectPixelScan;
