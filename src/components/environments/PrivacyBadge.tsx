import { Badge } from '@fluentui/react-components';
import { useI18n } from '../../i18n';
import type { ChromeEnvironment } from '../../types';

export default function PrivacyBadge({ engine }: { engine: ChromeEnvironment['browserEngine'] }) {
    const { t } = useI18n();
    if (engine !== 'fingerprint-chromium') return null;
    return (
        <Badge size="small" appearance="outline" color="brand" style={{ flexShrink: 0 }}>
            {t('防关联', 'Privacy')}
        </Badge>
    );
}
