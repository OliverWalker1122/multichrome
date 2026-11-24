export const VALID_WINDOW_ARRANGE_MODES = new Set([
    'grid',
    'split-grid',
    'stack',
    'cascade',
    'minimize',
    'restore',
    'reset-app-window',
]);

export function normalizeWindowArrangeMode(mode) {
    if (typeof mode === 'string' && VALID_WINDOW_ARRANGE_MODES.has(mode)) {
        return mode;
    }
    return 'grid';
}

/**
 * Single source of truth for MultiChrome's default main window size & centered bounds,
 * shared by initial BrowserWindow creation and "Reset App Window".
 * Sized generously (up to 1340×820) so the full 8-column table (including optional
 * Timezone column and running-row Launch/Stop + Locate + More buttons) renders with
 * zero right-edge clipping while gracefully adapting to smaller laptop displays.
 */
export function computeDefaultMainWindowBounds(workArea) {
    const areaW = Math.max(740, Math.round(Number(workArea?.width) || 1280));
    const areaH = Math.max(540, Math.round(Number(workArea?.height) || 800));
    const originX = Number.isFinite(workArea?.x) ? Math.round(workArea.x) : 0;
    const originY = Number.isFinite(workArea?.y) ? Math.round(workArea.y) : 0;

    const width = Math.min(
        areaW,
        Math.min(1340, Math.max(1000, areaW - 80)),
    );
    const height = Math.min(
        areaH,
        Math.min(820, Math.max(660, areaH - 80)),
    );
    const x = Math.round(originX + (areaW - width) / 2);
    const y = Math.round(originY + (areaH - height) / 2);
    return { x, y, width, height };
}

/**
 * Windows 10/11 standard resizable top-level windows (`WS_THICKFRAME`) include an
 * invisible ~7px DWM resize shadow border on left, right, and bottom (`GetWindowRect`
 * vs `DWMWA_EXTENDED_FRAME_BOUNDS`). Compensating outward makes visible window edges
 * align pixel-for-pixel with zero visible gap, matching native Windows Snap Assist.
 */
export function resolvePlatformFrameCompensation(platform = 'other') {
    if (platform === 'win32') {
        return { left: 7, top: 0, right: 7, bottom: 7 };
    }
    return { left: 0, top: 0, right: 0, bottom: 0 };
}

export function applyFrameCompensation(visualBounds, frameComp) {
    const comp = frameComp || { left: 0, top: 0, right: 0, bottom: 0 };
    return {
        left: Math.round(visualBounds.left - comp.left),
        top: Math.round(visualBounds.top - comp.top),
        width: Math.round(visualBounds.width + comp.left + comp.right),
        height: Math.round(visualBounds.height + comp.top + comp.bottom),
    };
}

function validateCountAndWorkArea(count, workArea) {
    if (!Number.isInteger(count) || count < 1) {
        throw new Error('窗口数量必须为正整数');
    }
    if (
        !workArea ||
        !Number.isFinite(workArea.width) ||
        !Number.isFinite(workArea.height) ||
        workArea.width <= 0 ||
        workArea.height <= 0
    ) {
        throw new Error('无效的屏幕工作区尺寸');
    }
    return {
        originX: Number.isFinite(workArea.x) ? Math.round(workArea.x) : 0,
        originY: Number.isFinite(workArea.y) ? Math.round(workArea.y) : 0,
        areaW: Math.round(workArea.width),
        areaH: Math.round(workArea.height),
    };
}

/**
 * Split display workArea into a docked left console column for MultiChrome
 * and a right workspace for browser windows with zero wasted gap.
 */
export function computeConsoleSplitWorkArea(
    workArea,
    {
        consoleWidthRatio = 0.26,
        minConsoleWidth = 440,
        maxConsoleWidth = 540,
    } = {},
) {
    const { originX, originY, areaW, areaH } = validateCountAndWorkArea(
        1,
        workArea,
    );
    if (areaW < 1040) {
        return {
            consoleBounds: null,
            browserWorkArea: {
                x: originX,
                y: originY,
                width: areaW,
                height: areaH,
            },
        };
    }

    const rawConsoleW = Math.round(areaW * consoleWidthRatio);
    const consoleW = Math.min(
        maxConsoleWidth,
        Math.max(minConsoleWidth, rawConsoleW),
        areaW - 520,
    );

    return {
        consoleBounds: {
            x: originX,
            y: originY,
            width: consoleW,
            height: areaH,
        },
        browserWorkArea: {
            x: originX + consoleW,
            y: originY,
            width: areaW - consoleW,
            height: areaH,
        },
    };
}

/**
 * Seamless zero-gap window grid calculation (`gap = 0` by default).
 * Uses cumulative integer edge partitioning so non-divisible widths/heights
 * never leave 1-2px seams between adjacent columns or rows.
 */
export function computeWindowGridBounds(
    count,
    workArea,
    {
        gap = 0,
        minWidth = 320,
        minHeight = 240,
        platform = 'other',
        fillSingle = false,
    } = {},
) {
    const { originX, originY, areaW, areaH } = validateCountAndWorkArea(
        count,
        workArea,
    );
    const safeGap = Math.max(0, Math.round(gap));
    const frameComp = resolvePlatformFrameCompensation(platform);

    if (count === 1 && !fillSingle) {
        const width = Math.max(
            Math.min(minWidth, areaW),
            Math.min(1280, areaW - safeGap * 2),
        );
        const height = Math.max(
            Math.min(minHeight, areaH),
            Math.min(860, areaH - safeGap * 2),
        );
        const left = originX + Math.round((areaW - width) / 2);
        const top = originY + Math.round((areaH - height) / 2);
        return [applyFrameCompensation({ left, top, width, height }, frameComp)];
    }

    const cols =
        count === 1
            ? 1
            : count <= 4
              ? 2
              : count <= 6
                ? 3
                : Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    const usableW = Math.max(cols * 80, areaW - safeGap * (cols + 1));
    const usableH = Math.max(rows * 80, areaH - safeGap * (rows + 1));

    const boundsList = [];
    for (let index = 0; index < count; index += 1) {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const colStart = Math.round((col * usableW) / cols);
        const colEnd = Math.round(((col + 1) * usableW) / cols);
        const rowStart = Math.round((row * usableH) / rows);
        const rowEnd = Math.round(((row + 1) * usableH) / rows);

        const visLeft = originX + safeGap * (col + 1) + colStart;
        const visTop = originY + safeGap * (row + 1) + rowStart;
        const visWidth = Math.max(80, colEnd - colStart);
        const visHeight = Math.max(80, rowEnd - rowStart);

        boundsList.push(
            applyFrameCompensation(
                {
                    left: visLeft,
                    top: visTop,
                    width: visWidth,
                    height: visHeight,
                },
                frameComp,
            ),
        );
    }

    return boundsList;
}

/**
 * Uniform-size identical-position window stack: normalizes all running browser
 * windows to the exact same dimensions and coordinates so clicking any profile
 * brings its window cleanly to the top like switching tabs.
 */
export function computeWindowUniformStackBounds(
    count,
    workArea,
    {
        platform = 'other',
        seamlessFill = false,
        widthRatio = 0.82,
        heightRatio = 0.88,
        maxWidth = 1480,
        maxHeight = 980,
    } = {},
) {
    const { originX, originY, areaW, areaH } = validateCountAndWorkArea(
        count,
        workArea,
    );
    const frameComp = resolvePlatformFrameCompensation(platform);

    let visBounds;
    if (seamlessFill) {
        visBounds = {
            left: originX,
            top: originY,
            width: areaW,
            height: areaH,
        };
    } else {
        const width = Math.min(
            areaW,
            Math.max(480, Math.min(maxWidth, Math.round(areaW * widthRatio))),
        );
        const height = Math.min(
            areaH,
            Math.max(360, Math.min(maxHeight, Math.round(areaH * heightRatio))),
        );
        visBounds = {
            left: originX + Math.round((areaW - width) / 2),
            top: originY + Math.round((areaH - height) / 2),
            width,
            height,
        };
    }

    const compensated = applyFrameCompensation(visBounds, frameComp);
    return Array.from({ length: count }, () => ({ ...compensated }));
}

/**
 * Uniform-size diagonal cascade: normalizes all windows to identical dimensions
 * and offsets each by `(stepX, stepY)` so every window's titlebar stays visible.
 */
export function computeWindowCascadeBounds(
    count,
    workArea,
    { platform = 'other', stepX = 30, stepY = 28 } = {},
) {
    const { originX, originY, areaW, areaH } = validateCountAndWorkArea(
        count,
        workArea,
    );
    const frameComp = resolvePlatformFrameCompensation(platform);

    const winW = Math.min(
        areaW,
        Math.max(480, Math.min(1360, Math.round(areaW * 0.72))),
    );
    const winH = Math.min(
        areaH,
        Math.max(360, Math.min(880, Math.round(areaH * 0.78))),
    );

    const maxStepsX = Math.max(1, Math.floor((areaW - winW) / Math.max(1, stepX)) + 1);
    const maxStepsY = Math.max(1, Math.floor((areaH - winH) / Math.max(1, stepY)) + 1);
    const cycle = Math.max(1, Math.min(maxStepsX, maxStepsY));

    const boundsList = [];
    for (let i = 0; i < count; i += 1) {
        const slot = i % cycle;
        const batch = Math.floor(i / cycle);
        const batchShift = (batch * 18) % Math.max(1, areaW - winW + 1);
        const visLeft = Math.min(
            originX + areaW - winW,
            originX + slot * stepX + batchShift,
        );
        const visTop = Math.min(
            originY + areaH - winH,
            originY + slot * stepY,
        );
        boundsList.push(
            applyFrameCompensation(
                {
                    left: visLeft,
                    top: visTop,
                    width: winW,
                    height: winH,
                },
                frameComp,
            ),
        );
    }
    return boundsList;
}

/**
 * Unified multi-window layout planner.
 * Returns `{ mode, consoleBounds, boundsList }`.
 */
export function computeWindowArrangement(
    rawMode,
    count,
    workArea,
    { platform = 'other', dockConsoleInStack = false } = {},
) {
    const mode = normalizeWindowArrangeMode(rawMode);
    validateCountAndWorkArea(count, workArea);

    if (mode === 'split-grid') {
        const { consoleBounds, browserWorkArea } =
            computeConsoleSplitWorkArea(workArea);
        return {
            mode,
            consoleBounds,
            boundsList: computeWindowGridBounds(count, browserWorkArea, {
                gap: 0,
                platform,
                fillSingle: true,
            }),
        };
    }

    if (mode === 'stack') {
        if (dockConsoleInStack && workArea.width >= 1040) {
            const { consoleBounds, browserWorkArea } =
                computeConsoleSplitWorkArea(workArea);
            return {
                mode,
                consoleBounds,
                boundsList: computeWindowUniformStackBounds(
                    count,
                    browserWorkArea,
                    {
                        platform,
                        seamlessFill: true,
                    },
                ),
            };
        }
        return {
            mode,
            consoleBounds: null,
            boundsList: computeWindowUniformStackBounds(count, workArea, {
                platform,
                seamlessFill: false,
            }),
        };
    }

    if (mode === 'cascade') {
        return {
            mode,
            consoleBounds: null,
            boundsList: computeWindowCascadeBounds(count, workArea, {
                platform,
            }),
        };
    }

    return {
        mode: 'grid',
        consoleBounds: null,
        boundsList: computeWindowGridBounds(count, workArea, {
            gap: 0,
            platform,
        }),
    };
}

/**
 * Sanitize an environment name for Chromium's native `--window-name` switch
 * (OS window & taskbar title only; zero web/DOM visibility).
 */
export function sanitizeWindowTitleTag(rawName) {
    if (typeof rawName !== 'string') return '';
    const cleaned = rawName
        .replace(/[\r\n\t\0"']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 48);
    return cleaned ? `[${cleaned}]` : '';
}

export function sanitizeHighlightLabel(rawName) {
    if (typeof rawName !== 'string') return '';
    return Array.from(rawName)
        .map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40);
}

/**
 * Convert outer Chromium window bounds (as reported by CDP `Browser.getWindowForTarget`,
 * which match Win32 `GetWindowRect` including the invisible 7px DWM resize shadow border)
 * into visible on-screen frame bounds so a translucent highlight overlay aligns
 * pixel-for-pixel with the visible browser edges.
 */
export function computeVisualHighlightBounds(windowBounds, platform = 'other') {
    if (
        !windowBounds ||
        !Number.isFinite(windowBounds.left) ||
        !Number.isFinite(windowBounds.top) ||
        !Number.isFinite(windowBounds.width) ||
        !Number.isFinite(windowBounds.height) ||
        windowBounds.width <= 0 ||
        windowBounds.height <= 0
    ) {
        return null;
    }
    const isMaximizedOrFullscreen =
        windowBounds.windowState === 'maximized' ||
        windowBounds.windowState === 'fullscreen';
    const comp = isMaximizedOrFullscreen
        ? { left: 0, top: 0, right: 0, bottom: 0 }
        : resolvePlatformFrameCompensation(platform);
    const width = Math.max(
        80,
        Math.round(windowBounds.width - comp.left - comp.right),
    );
    const height = Math.max(
        60,
        Math.round(windowBounds.height - comp.top - comp.bottom),
    );
    return {
        x: Math.round(windowBounds.left + comp.left),
        y: Math.round(windowBounds.top + comp.top),
        width,
        height,
    };
}
