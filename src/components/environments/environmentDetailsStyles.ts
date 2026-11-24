import { makeStyles, tokens } from '@fluentui/react-components';

export const ENV_DETAILS_WIDTH = 348;

export const useEnvironmentDetailsStyles = makeStyles({
    backdrop: {
        position: 'absolute',
        inset: 0,
        backgroundColor: `color-mix(in srgb, ${tokens.colorBackgroundOverlay} 55%, transparent)`,
        zIndex: 20,
        display: 'flex',
        justifyContent: 'flex-end',
    },
    panel: {
        width: `${ENV_DETAILS_WIDTH}px`,
        minWidth: `${ENV_DETAILS_WIDTH}px`,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--glass-drawer)',
        backdropFilter: 'var(--glass-drawer-filter)',
        borderLeft: '1px solid var(--glass-border)',
        outline: 'none',
        overflow: 'hidden',
        flexShrink: 0,
    },
    panelOverlay: {
        width: 'min(400px, 100%)',
        minWidth: 0,
        boxShadow: tokens.shadow28,
    },
    header: {
        padding: '16px 18px 6px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '8px',
        flexShrink: 0,
    },
    titleWrap: {
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
    title: {
        fontSize: tokens.fontSizeBase500,
        lineHeight: tokens.lineHeightBase500,
        fontWeight: tokens.fontWeightSemibold,
        color: tokens.colorNeutralForeground1,
        margin: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    statusRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
    groupName: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    dot: {
        width: '6px',
        height: '6px',
        borderRadius: '999px',
        flexShrink: 0,
    },
    dotRunning: {
        backgroundColor: tokens.colorPaletteGreenForeground1,
    },
    dotStopped: {
        backgroundColor: tokens.colorNeutralForeground4,
    },
    quickActions: {
        padding: '6px 18px 12px',
        borderBottom: '1px solid var(--glass-border)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
        flexWrap: 'wrap',
    },
    body: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        '& > *': {
            flexShrink: 0,
        },
    },
    identityFields: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)',
        gap: '12px',
        '& .fui-Field': { minWidth: 0, gridTemplateColumns: 'minmax(0, 1fr)' },
        '& .fui-Input': { minWidth: 0, width: '100%' },
        '& input': { minWidth: 0 },
    },
    sectionLabel: {
        fontSize: '12px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground3,
        marginTop: '4px',
    },
    inlineCopyRow: {
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
    },
    metaBox: {
        padding: '10px 12px',
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: 'var(--glass-card-inner)',
        border: '1px solid var(--glass-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        fontSize: '12px',
    },
    metaRow: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    metaKey: {
        color: tokens.colorNeutralForeground3,
    },
    metaVal: {
        color: tokens.colorNeutralForeground1,
        fontFamily: tokens.fontFamilyMonospace,
        wordBreak: 'break-all',
    },
    footer: {
        padding: '10px 18px',
        borderTop: '1px solid var(--glass-border)',
        backgroundColor: 'var(--glass-card-inner)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        flexShrink: 0,
    },
    dirtyHint: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
});

export type EnvironmentDetailsStyles = ReturnType<
    typeof useEnvironmentDetailsStyles
>;
