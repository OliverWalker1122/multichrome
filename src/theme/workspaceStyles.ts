import { tokens } from '@fluentui/react-components';

export const workspaceTitle = {
    margin: 0,
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightHero700,
    color: tokens.colorNeutralForeground1,
} as const;

export const tableViewport = {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'auto',
    borderTop: '1px solid var(--glass-border)',
    backgroundColor: 'var(--glass-card)',
} as const;

export const stickyTableHeader = {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    backgroundColor: tokens.colorNeutralBackground2,
    boxShadow: 'inset 0 -1px 0 var(--glass-border)',
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
