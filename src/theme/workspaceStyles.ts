import { tokens } from '@fluentui/react-components';

export const workspaceTitle = {
    margin: 0,
    fontFamily: 'var(--mc-font-display)',
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
    color: tokens.colorNeutralForeground1,
} as const;

export const tableViewport = {
    flex: '0 1 auto',
    minHeight: 0,
    margin: '8px var(--mc-workspace-inset) 20px',
    overflowY: 'auto',
    overflowX: 'auto',
    border: '1px solid var(--glass-border)',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: 'var(--glass-card)',
    boxShadow: 'var(--glass-shadow)',
    scrollbarWidth: 'thin',
} as const;

export const stickyTableHeader = {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: 'inset 0 -1px 0 var(--glass-border)',
} as const;

export const tableActionButton = {
    minWidth: '64px',
    height: '28px',
    minHeight: '28px',
    paddingInline: '10px',
    borderRadius: '6px',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightMedium,
    '& svg': { width: '14px', height: '14px' },
} as const;

export const stoppedStatus = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    color: tokens.colorNeutralForeground3,
    '&::before': {
        content: '""',
        width: '7px',
        height: '7px',
        borderRadius: tokens.borderRadiusCircular,
        border: '1.5px solid currentColor',
        flexShrink: 0,
    },
} as const;

export const selectedTableRow = {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    '&:hover': {
        backgroundColor: tokens.colorNeutralBackground1Selected,
    },
    '& > td:first-child': {
        position: 'relative',
        '&::before': {
            content: '""',
            position: 'absolute',
            insetInlineStart: 0,
            top: 'calc(50% - 10px)',
            height: '20px',
            width: '3px',
            borderRadius: tokens.borderRadiusCircular,
            backgroundColor: tokens.colorBrandBackground,
        },
    },
} as const;
