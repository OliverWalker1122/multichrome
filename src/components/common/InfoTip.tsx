import React from 'react';
import { Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import { QuestionCircle16Regular } from '@fluentui/react-icons';

interface InfoTipProps {
    content: string;
}

const useStyles = makeStyles({
    trigger: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        padding: 0,
        border: 'none',
        borderRadius: '50%',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground3,
        cursor: 'help',
        verticalAlign: 'middle',
        flexShrink: 0,
        transitionProperty: 'color, background-color',
        transitionDuration: '120ms',
        ':hover': {
            color: tokens.colorNeutralForeground1,
            backgroundColor: tokens.colorSubtleBackgroundHover,
        },
        ':focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '1px',
        },
    },
});

const InfoTip: React.FC<InfoTipProps> = ({ content }) => {
    const styles = useStyles();
    if (!content) return null;
    return (
        <Tooltip content={content} relationship="description" withArrow>
            <button
                type="button"
                className={styles.trigger}
                data-infotip="true"
                aria-label={content}
                onClick={(event) => event.preventDefault()}
            >
                <QuestionCircle16Regular />
            </button>
        </Tooltip>
    );
};

export default InfoTip;
