import { makeStyles, tokens } from '@fluentui/react-components';
import { GlobeRegular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n';
import type { ChromeEnvironment, ManagedProxy } from '../../types';
import EnvironmentQuickActions from './EnvironmentQuickActions';
import PrivacyBadge from './PrivacyBadge';
import FavoriteButton from './FavoriteButton';

const useStyles = makeStyles({
    section: { margin: '10px var(--mc-workspace-inset) 0', flexShrink: 0 },
    heading: { margin: '0 0 6px', fontSize: '14px', fontWeight: 600 },
    grid: {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(205px, 100%), 1fr))',
        gap: '8px', maxHeight: '29vh', overflowY: 'auto', padding: '2px',
    },
    card: {
        boxSizing: 'border-box', minWidth: 0, borderRadius: '10px',
        backgroundColor: 'var(--glass-card)', border: '1px solid var(--glass-border)', padding: '10px 12px',
    },
    line: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
    identity: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '5px' },
    name: {
        minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        padding: 0, border: 0, backgroundColor: 'transparent', color: tokens.colorNeutralForeground1,
        fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 600, cursor: 'pointer',
        ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '-2px' },
    },
    metadata: { display: 'flex', alignItems: 'center', gap: '6px', margin: '5px 0 10px' },
    proxy: { flex: 1, minWidth: 0, color: tokens.colorNeutralForeground3,
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: '12px' },
    status: { display: 'flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap', color: tokens.colorNeutralForeground2 },
    dot: { display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', backgroundColor: 'currentColor' },
    listTitle: { margin: '10px 0 0', fontSize: '14px', fontWeight: 600 },
});

export default function FavoriteCards({ environments, proxies, busyId, onToggle, onSelect, onRunToggle, onLocate }: {
    environments: ChromeEnvironment[];
    proxies: ReadonlyMap<string, ManagedProxy>;
    busyId: string | null;
    onToggle: (id: string) => void;
    onSelect: (id: string) => void;
    onRunToggle: (env: ChromeEnvironment) => void;
    onLocate: (id: string) => void;
}) {
    const styles = useStyles();
    const { t } = useI18n();
    return (
        <div className={styles.section}>
            <h2 className={styles.heading}>{t('常用环境', 'Favorites')}</h2>
            <div className={styles.grid} role="group" aria-label={t('常用环境卡片', 'Favorite environment cards')}>
                {environments.map(env => {
                    const proxy = env.proxyId ? proxies.get(env.proxyId) : undefined;
                    const label = env.proxyId ? proxy?.name ?? t('代理已失效', 'Proxy missing')
                        : env.proxyLabel || (env.proxy ? t('手动代理', 'Manual proxy') : t('全局默认', 'Global default'));
                    return (
                        <article className={styles.card} key={env.id}>
                            <div className={styles.line}>
                                <GlobeRegular aria-hidden="true" />
                                <div className={styles.identity}>
                                    <button type="button" className={styles.name} title={env.name}
                                        onClick={() => onSelect(env.id)}>{env.name}</button>
                                    <PrivacyBadge engine={env.browserEngine} />
                                </div>
                                <FavoriteButton name={env.name} checked onToggle={() => onToggle(env.id)} />
                            </div>
                            <div className={styles.metadata}>
                                <span className={styles.proxy} title={label}>
                                    {label}{proxy?.status === 'error' && t(' · 启动异常', ' · Start error')}
                                </span>
                                <span className={styles.status}>
                                    <i className={styles.dot} style={{ color: env.isRunning ? tokens.colorPaletteGreenForeground1 : tokens.colorNeutralForeground3 }} />
                                    {env.isRunning ? t('运行中', 'Running') : t('未运行', 'Stopped')}
                                </span>
                            </div>
                            <div className={styles.line}>
                                <EnvironmentQuickActions name={env.name} running={Boolean(env.isRunning)}
                                    busy={busyId === env.id} disabled={Boolean(busyId)}
                                    onRunToggle={() => onRunToggle(env)} onLocate={() => onLocate(env.id)} />
                            </div>
                        </article>
                    );
                })}
            </div>
            <h2 className={styles.listTitle}>{t('环境列表', 'Environment list')}</h2>
        </div>
    );
}
