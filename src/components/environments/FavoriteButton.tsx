import { Button, tokens } from '@fluentui/react-components';
import { StarFilled, StarRegular } from '@fluentui/react-icons';
import { useI18n } from '../../i18n';

export default function FavoriteButton({ name, checked, onToggle }: {
    name: string;
    checked: boolean;
    onToggle: () => void;
}) {
    const { t } = useI18n();
    const label = t(`星标环境 ${name}`, `Favorite ${name}`);
    return (
        <Button size="small" appearance="subtle" aria-label={label} aria-pressed={checked}
            title={checked ? t('移出常用环境', 'Remove from favorites') : t('加入常用环境', 'Add to favorites')}
            style={{ flexShrink: 0, minWidth: 24, padding: 2 }}
            icon={checked ? <StarFilled style={{ color: tokens.colorPaletteMarigoldForeground2 }} /> : <StarRegular />}
            onDoubleClick={event => event.stopPropagation()}
            onClick={event => { event.stopPropagation(); onToggle(); }} />
    );
}
