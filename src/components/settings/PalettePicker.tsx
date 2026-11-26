import { makeStyles, tokens } from '@fluentui/react-components';
import { CheckmarkRegular } from '@fluentui/react-icons';
import { useSettings } from '../../contexts/SettingsContext';
import { useI18n } from '../../i18n';
import { getWindowTheme, paletteNames } from '../../theme/win11Theme';
import type { ThemePalette } from '../../types';

const useStyles = makeStyles({
    field: { border: 0, padding: 0, margin: '14px 0 0', minWidth: 0 },
    options: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' },
    option: {
        cursor: 'pointer', position: 'relative', width: '120px', padding: '7px',
        border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: '8px',
        ':has(input:checked)': { border: `1px solid ${tokens.colorBrandForeground1}` },
        ':focus-within': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '2px' },
    },
    radio: { position: 'absolute', opacity: 0, width: '1px', height: '1px' },
    preview: {
        display: 'flex', height: '34px', borderRadius: '4px', overflow: 'hidden',
        border: `1px solid ${tokens.colorNeutralStroke2}`, alignItems: 'stretch',
    },
    rail: { width: '29%', padding: '8px 3px', display: 'flex', alignItems: 'flex-start' },
    selectedRow: { height: '4px', width: '100%', borderRadius: '2px' },
    action: { margin: '7px 6px 0 auto', width: '18px', height: '6px', borderRadius: '2px' },
    label: { marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
});

export default function PalettePicker() {
    const styles = useStyles();
    const { settings, isDark, actions } = useSettings();
    const { t } = useI18n();
    return (
        <fieldset className={styles.field}>
            <legend>{t('主题配色', 'Color palette')}</legend>
            <div className={styles.options}>
                {(Object.keys(paletteNames) as ThemePalette[]).map(palette => {
                    const preview = getWindowTheme(palette, isDark);
                    const checked = palette === (settings.palette ?? 'neutral');
                    return (
                        <label className={styles.option} key={palette}>
                            <input className={styles.radio} type="radio" name="theme-palette" value={palette}
                                checked={checked} onChange={() => void actions.setPalette(palette)} />
                            <span aria-hidden="true" className={styles.preview} style={{ background: preview.colorNeutralBackground1 }}>
                                <span className={styles.rail} style={{ background: preview.colorSubtleBackgroundSelected }}>
                                    <i className={styles.selectedRow} style={{ background: preview.colorBrandForeground2 }} />
                                </span>
                                <i className={styles.action} style={{ background: preview.colorBrandBackground }} />
                            </span>
                            <span className={styles.label}>
                                {t(paletteNames[palette][0], paletteNames[palette][1])}
                                {checked && <CheckmarkRegular aria-hidden="true" />}
                            </span>
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}
