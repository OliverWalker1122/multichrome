import React, { useEffect, useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    MessageBar,
    MessageBarBody,
    Select,
    Textarea,
    makeStyles,
} from '@fluentui/react-components';
import { CopyRegular } from '@fluentui/react-icons';
import type { ChromeEnvironment } from '../../types';
import { environmentApi } from '../../services';
import { useNotification } from '../../contexts/NotificationContext';
import { useI18n } from '../../i18n';

export interface CookieTransferDialogProps {
    env: ChromeEnvironment | null;
    mode: 'import' | 'export' | null;
    onClose: () => void;
}

const useStyles = makeStyles({
    stack: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        paddingTop: '4px',
    },
    mono: {
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: '12px',
    },
});

const CookieTransferDialog: React.FC<CookieTransferDialogProps> = ({
    env,
    mode,
    onClose,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const { showNotification } = useNotification();
    const [format, setFormat] = useState<'json' | 'netscape'>('json');
    const [content, setContent] = useState('');
    const [cookieCount, setCookieCount] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!env || !mode) {
            setContent('');
            setCookieCount(0);
            setError('');
            return;
        }
        if (mode !== 'export') {
            setContent('');
            setError('');
            return;
        }
        let cancelled = false;
        const load = async () => {
            try {
                setBusy(true);
                setError('');
                const res = await environmentApi.exportCookies(env.id, format);
                if (!cancelled) {
                    setContent(res.content);
                    setCookieCount(res.count);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : t('导出 Cookie 失败', 'Failed to export cookies'),
                    );
                }
            } finally {
                if (!cancelled) setBusy(false);
            }
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [env, mode, format, t]);

    const handleCopy = async () => {
        if (!content) return;
        try {
            await navigator.clipboard.writeText(content);
            showNotification(
                'success',
                t('已复制 Cookie 数据', 'Copied cookies to clipboard'),
            );
        } catch {
            showNotification(
                'error',
                t('无法访问剪贴板', 'Clipboard unavailable'),
            );
        }
    };

    const handleImport = async () => {
        if (!env || !content.trim() || busy) return;
        try {
            setBusy(true);
            setError('');
            const res = await environmentApi.importCookies(env.id, content);
            showNotification(
                'success',
                isEn
                    ? `Imported ${res.importedCount} cookie(s) natively`
                    : `已原生写入 ${res.importedCount} 条 Cookie（零扩展注入）`,
            );
            onClose();
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : t('导入 Cookie 失败', 'Failed to import cookies'),
            );
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            open={Boolean(env && mode)}
            onOpenChange={(_, data) => {
                if (!data.open && !busy) onClose();
            }}
        >
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>
                        {mode === 'export'
                            ? isEn
                                ? `Export Cookies · ${env?.name || ''}`
                                : `导出 Cookie · ${env?.name || ''}`
                            : isEn
                              ? `Import Cookies · ${env?.name || ''}`
                              : `导入 Cookie · ${env?.name || ''}`}
                    </DialogTitle>
                    <DialogContent>
                        <div className={styles.stack}>
                            {error && (
                                <MessageBar intent="error" layout="multiline">
                                    <MessageBarBody>{error}</MessageBarBody>
                                </MessageBar>
                            )}

                            {mode === 'export' && (
                                <Field
                                    label={
                                        isEn
                                            ? `Format (${cookieCount} cookies)`
                                            : `导出格式（共 ${cookieCount} 条）`
                                    }
                                >
                                    <Select
                                        value={format}
                                        disabled={busy}
                                        onChange={(_, data) =>
                                            setFormat(
                                                data.value === 'netscape'
                                                    ? 'netscape'
                                                    : 'json',
                                            )
                                        }
                                    >
                                        <option value="json">JSON</option>
                                        <option value="netscape">
                                            Netscape
                                        </option>
                                    </Select>
                                </Field>
                            )}

                            <Field
                                label={
                                    mode === 'export'
                                        ? t('Cookie 内容', 'Cookie Payload')
                                        : t(
                                              '粘贴 JSON 或 Netscape 格式 Cookie',
                                              'Paste JSON or Netscape cookies',
                                          )
                                }
                            >
                                <Textarea
                                    rows={11}
                                    resize="vertical"
                                    readOnly={mode === 'export'}
                                    textarea={{
                                        className: styles.mono,
                                        spellCheck: false,
                                    }}
                                    value={content}
                                    placeholder={
                                        mode === 'import'
                                            ? '[{"name":"session","value":"...","domain":".example.com"}]'
                                            : undefined
                                    }
                                    onChange={(_, data) => {
                                        if (mode === 'import') {
                                            setContent(data.value);
                                            setError('');
                                        }
                                    }}
                                />
                            </Field>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="secondary"
                            disabled={busy}
                            onClick={onClose}
                        >
                            {t('关闭', 'Close')}
                        </Button>
                        {mode === 'export' ? (
                            <Button
                                appearance="primary"
                                icon={<CopyRegular />}
                                disabled={busy || !content}
                                onClick={() => void handleCopy()}
                            >
                                {t('复制全部', 'Copy All')}
                            </Button>
                        ) : (
                            <Button
                                appearance="primary"
                                disabled={busy || !content.trim()}
                                onClick={() => void handleImport()}
                            >
                                {busy
                                    ? t('写入中…', 'Importing…')
                                    : t('导入并写入', 'Import')}
                            </Button>
                        )}
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export default CookieTransferDialog;
