export function computeWindowGridBounds(
    count,
    workArea,
    { gap = 8, minWidth = 480, minHeight = 360 } = {},
) {
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

    const originX = Number.isFinite(workArea.x) ? Math.round(workArea.x) : 0;
    const originY = Number.isFinite(workArea.y) ? Math.round(workArea.y) : 0;
    const areaW = Math.round(workArea.width);
    const areaH = Math.round(workArea.height);
    const safeGap = Math.max(0, Math.round(gap));

    if (count === 1) {
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
        return [{ left, top, width, height }];
    }

    const cols =
        count === 2
            ? 2
            : count <= 4
              ? 2
              : count <= 6
                ? 3
                : Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);

    const usableW = Math.max(100, areaW - safeGap * (cols + 1));
    const usableH = Math.max(100, areaH - safeGap * (rows + 1));
    const cellW = Math.max(Math.min(minWidth, Math.floor(areaW / cols)), Math.floor(usableW / cols));
    const cellH = Math.max(Math.min(minHeight, Math.floor(areaH / rows)), Math.floor(usableH / rows));

    const boundsList = [];
    for (let index = 0; index < count; index += 1) {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const left = originX + safeGap + col * (cellW + safeGap);
        const top = originY + safeGap + row * (cellH + safeGap);
        boundsList.push({
            left: Math.round(left),
            top: Math.round(top),
            width: Math.round(cellW),
            height: Math.round(cellH),
        });
    }

    return boundsList;
}
