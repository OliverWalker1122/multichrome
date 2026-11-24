import { BrowserWindow } from 'electron';
import {
    computeVisualHighlightBounds,
    sanitizeHighlightLabel,
} from '../domain/windowTiling.js';

export interface HighlightWindowBounds {
    left: number;
    top: number;
    width: number;
    height: number;
    windowState?: string;
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildOverlayDataUrl(label: string, nonce: number): string {
    const safeLabel = escapeHtml(sanitizeHighlightLabel(label));
    const badgeMarkup = safeLabel
        ? `<div class="badge" data-n="${nonce}"><span class="dot"></span><span class="label">${safeLabel}</span></div>`
        : '';
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent;
    pointer-events: none;
    user-select: none;
    font-family: "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  .frame {
    position: fixed;
    inset: 2px;
    border-radius: 9px;
    border: 3px solid #1877F2;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.7),
      inset 0 0 22px rgba(24, 119, 242, 0.24),
      0 0 0 1px rgba(24, 119, 242, 0.45);
    animation: mcLocatePulse 1180ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  .badge {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: calc(100% - 32px);
    padding: 5px 13px;
    border-radius: 999px;
    background: rgba(24, 119, 242, 0.94);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    line-height: 18px;
    letter-spacing: 0.01em;
    box-shadow: 0 6px 20px rgba(15, 23, 42, 0.28);
    animation: mcBadgeFade 1180ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ffffff;
    flex-shrink: 0;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @keyframes mcLocatePulse {
    0% { opacity: 0; transform: scale(0.992); }
    12% { opacity: 1; transform: scale(1); }
    72% { opacity: 0.96; transform: scale(1); }
    100% { opacity: 0; transform: scale(1); }
  }
  @keyframes mcBadgeFade {
    0% { opacity: 0; transform: translate(-50%, -6px); }
    14% { opacity: 1; transform: translate(-50%, 0); }
    74% { opacity: 1; transform: translate(-50%, 0); }
    100% { opacity: 0; transform: translate(-50%, -4px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .frame { animation: none; opacity: 1; }
    .badge { animation: none; opacity: 1; }
  }
</style>
</head>
<body>
  <div class="frame"></div>
  ${badgeMarkup}
</body>
</html>`;
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/**
 * Reusable Click-Through Non-Focusable Highlight Beacon Overlay (Layer 3 Host Shell).
 *
 * Flashes a 1.2s Fluent Blue glowing frame + profile name pill over the exact visual
 * bounds of a located Chrome window at the OS level:
 * - Zero JS/CSS/DOM injection into the target browser page (100% undetectable by sites);
 * - `focusable: false` + `showInactive()` + `setIgnoreMouseEvents(true)` so it NEVER
 *   steals keyboard/mouse focus from the located Chrome window or from MultiChrome.
 */
export class WindowHighlightOverlay {
    private overlayWindow: BrowserWindow | null = null;
    private hideTimer: ReturnType<typeof setTimeout> | null = null;
    private flashSeq = 0;

    private ensureWindow(): BrowserWindow {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            return this.overlayWindow;
        }
        const win = new BrowserWindow({
            width: 300,
            height: 200,
            minWidth: 80,
            minHeight: 60,
            frame: false,
            transparent: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            closable: false,
            focusable: false,
            skipTaskbar: true,
            hasShadow: false,
            show: false,
            alwaysOnTop: true,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                javascript: false,
            },
        });
        win.setIgnoreMouseEvents(true, { forward: false });
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        win.on('closed', () => {
            if (this.overlayWindow === win) {
                this.overlayWindow = null;
            }
        });
        this.overlayWindow = win;
        return win;
    }

    public flash(
        windowBounds: HighlightWindowBounds | null | undefined,
        label = '',
        durationMs = 1220,
    ): boolean {
        const visualBounds = computeVisualHighlightBounds(
            windowBounds,
            process.platform,
        );
        if (!visualBounds) return false;

        try {
            const win = this.ensureWindow();
            const seq = ++this.flashSeq;
            if (this.hideTimer) {
                clearTimeout(this.hideTimer);
                this.hideTimer = null;
            }

            win.setBounds(visualBounds, false);
            win.setIgnoreMouseEvents(true, { forward: false });
            win.setAlwaysOnTop(true, 'screen-saver');

            const dataUrl = buildOverlayDataUrl(label, seq);
            void win.loadURL(dataUrl).then(() => {
                if (seq !== this.flashSeq || win.isDestroyed()) return;
                win.setBounds(visualBounds, false);
                win.showInactive();
                this.hideTimer = setTimeout(() => {
                    if (seq !== this.flashSeq || win.isDestroyed()) return;
                    win.hide();
                    this.hideTimer = null;
                }, durationMs);
            }).catch(() => {});

            return true;
        } catch {
            return false;
        }
    }

    public destroy(): void {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        this.flashSeq += 1;
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            this.overlayWindow.destroy();
        }
        this.overlayWindow = null;
    }
}
