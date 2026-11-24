import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useI18n } from '../../i18n';
import type { RunStatus } from '../../types';

export type { RunStatus };

interface RunStatusFilterProps {
    value: RunStatus;
    onChange: (value: RunStatus) => void;
    total: number;
    runningCount: number;
    runningLabel: string;
    stoppedLabel: string;
}

const useStyles = makeStyles({
    statusFilterGroup: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '20px',
        flexShrink: 0,
    },
    statusFilterBtn: {
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        minHeight: '42px',
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '14px',
        fontFamily: 'inherit',
        padding: '0 1px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        '&:hover': {
            color: tokens.colorNeutralForeground1,
        },
        '&:focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '-2px',
        },
    },
    statusFilterBtnActive: {
        color: tokens.colorNeutralForeground1,
        fontWeight: 600,
        '&::after': {
            content: '""',
            position: 'absolute',
            height: '3px',
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: tokens.borderRadiusCircular,
            backgroundColor: tokens.colorBrandBackground,
        },
    },
    filterCount: {
        fontSize: '12px',
        fontWeight: tokens.fontWeightRegular,
        fontVariantNumeric: 'tabular-nums',
        color: tokens.colorNeutralForeground3,
    },
});

export default function RunStatusFilter({
    value, onChange, total, runningCount, runningLabel, stoppedLabel,
}: RunStatusFilterProps) {
    const styles = useStyles();
    const { t } = useI18n();
    const options = [
        ['all', t('全部', 'All'), total],
        ['running', runningLabel, runningCount],
        ['stopped', stoppedLabel, total - runningCount],
    ] as const;

    return (
        <div className={styles.statusFilterGroup} role="group" aria-label={t('按运行状态筛选', 'Filter by status')}>
            {options.map(([key, label, count]) => (
                <button
                    key={key}
                    type="button"
                    className={mergeClasses(styles.statusFilterBtn, value === key && styles.statusFilterBtnActive)}
                    aria-pressed={value === key}
                    aria-label={`${label} (${count})`}
                    onClick={() => onChange(key)}
                >
                    {label}
                    <span className={styles.filterCount}>{count}</span>
                </button>
            ))}
        </div>
    );
}
