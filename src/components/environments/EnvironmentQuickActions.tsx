import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { PlayFilled, StopFilled, TargetRegular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n';
import { tableActionButton } from '../../theme/workspaceStyles';

const useStyles = makeStyles({
    action: {
        ...tableActionButton,
        width: '80px',
        minWidth: '80px',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        paddingInline: '6px',
    },
    launch: { '&:not(:disabled) svg': { color: tokens.colorBrandForeground1 } },
    stop: { '&:not(:disabled) svg': { color: tokens.colorPaletteRedForeground1 } },
});

interface Props {
    name: string;
    running: boolean;
    busy: boolean;
    disabled?: boolean;
    onRunToggle: () => void;
    onLocate: () => void;
}

export default function EnvironmentQuickActions({ name, running, busy, disabled, onRunToggle, onLocate }: Props) {
    const styles = useStyles();
    const { t } = useI18n();
    return (
        <>
            <Button size="small" appearance="secondary"
                className={mergeClasses(styles.action, running ? styles.stop : styles.launch)}
                icon={busy ? undefined : running ? <StopFilled /> : <PlayFilled />}
                disabled={busy || disabled} onClick={onRunToggle}>
                {busy ? t('处理中', 'Working') : running ? t('停止', 'Stop') : t('启动', 'Launch')}
            </Button>
            {running && (
                <Button size="small" appearance="secondary" className={styles.action}
                    icon={<TargetRegular />} disabled={busy}
                    aria-label={t(`定位窗口 ${name}`, `Locate window ${name}`)}
                    title={t(`将 ${name} 的浏览器窗口置于前台`, `Bring the browser window for ${name} to the front`)}
                    onClick={onLocate}>
                    {t('定位', 'Locate')}
                </Button>
            )}
        </>
    );
}
