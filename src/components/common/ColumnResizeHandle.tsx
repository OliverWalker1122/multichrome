import { useRef } from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { useI18n } from '../../i18n';

const useStyles = makeStyles({
    handle: {
        position: 'absolute',
        top: '5px',
        right: 0,
        bottom: '5px',
        width: '8px',
        cursor: 'col-resize',
        touchAction: 'none',
        borderRadius: '3px',
        '&::after': {
            content: '""',
            position: 'absolute',
            width: '1px',
            top: '4px',
            bottom: '4px',
            left: '4px',
            backgroundColor: tokens.colorNeutralStroke1,
        },
        '&:hover': { backgroundColor: tokens.colorBrandBackground2 },
        '&:focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}` },
    },
});

export default function ColumnResizeHandle({
    label,
    width,
    min = 120,
    max = 480,
    onChange,
}: {
    label: string;
    width: number;
    min?: number;
    max?: number;
    onChange: (width: number) => void;
}) {
    const styles = useStyles();
    const { isEn } = useI18n();
    const drag = useRef<{ x: number; width: number } | null>(null);
    const resize = (value: number) =>
        onChange(Math.round(Math.min(max, Math.max(min, value))));
    return (
        <span
            className={styles.handle}
            role="separator"
            aria-orientation="vertical"
            aria-label={isEn ? `Resize ${label} column` : `调整${label}列宽`}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={width}
            title={
                isEn
                    ? 'Drag to resize column; use Left/Right arrows when focused'
                    : '拖动调整列宽；聚焦后用左右方向键调整'
            }
            tabIndex={0}
            onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                drag.current = {
                    x: event.clientX,
                    width:
                        event.currentTarget.parentElement?.getBoundingClientRect()
                            .width || width,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
                if (drag.current)
                    resize(drag.current.width + event.clientX - drag.current.x);
            }}
            onPointerUp={(event) => {
                drag.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
                drag.current = null;
            }}
            onLostPointerCapture={() => {
                drag.current = null;
            }}
            onKeyDown={(event) => {
                if (
                    !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                        event.key,
                    )
                )
                    return;
                event.preventDefault();
                event.stopPropagation();
                resize(
                    event.key === 'Home'
                        ? min
                        : event.key === 'End'
                          ? max
                          : width + (event.key === 'ArrowRight' ? 16 : -16),
                );
            }}
        />
    );
}
