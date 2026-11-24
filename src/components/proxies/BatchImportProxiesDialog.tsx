import React from 'react';
import {
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    Textarea,
} from '@fluentui/react-components';
import type { BatchImportProxiesResult } from '../../types';
import { useI18n } from '../../i18n';

export interface BatchImportProxiesDialogProps {
    open: boolean;
    busy: string;
    batchText: string;
    onBatchTextChange: (value: string) => void;
    batchPrefix: string;
    onBatchPrefixChange: (value: string) => void;
    batchSkipDuplicates: boolean;
    onBatchSkipDuplicatesChange: (value: boolean) => void;
    batchResult: BatchImportProxiesResult | null;
    onClose: () => void;
    onSubmit: () => void;
}

const BatchImportProxiesDialog: React.FC<BatchImportProxiesDialogProps> = ({
    open,
    busy,
    batchText,
    onBatchTextChange,
    batchPrefix,
    onBatchPrefixChange,
    batchSkipDuplicates,
    onBatchSkipDuplicatesChange,
    batchResult,
    onClose,
    onSubmit,
}) => {
    const { isEn, t } = useI18n();

    return (
        <Dialog
            open={open}
            onOpenChange={(_, data) => {
                if (!data.open && !busy) onClose();
            }}
        >
            <DialogSurface style={{ maxWidth: '580px', width: '92vw' }}>
                <DialogBody>
                    <DialogTitle>
                        {t('批量导入代理', 'Batch Import Proxies')}
                    </DialogTitle>
                    <DialogContent
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                        }}
                    >
                        <Field
                            label={t(
                                '代理列表（每行一条）',
                                'Proxy List (one per line)',
                            )}
                            hint={t(
                                '支持 http/https/socks5、主机:端口(:账号:密码)，以及 vless://、vmess://、trojan://、ss://、hy2://、tuic:// 分享链接；支持“自定义名称 | 代理地址”或链接末尾 #备注 自动命名，以 # 或 // 开头的注释行会自动忽略。',
                                'Supports http/https/socks5, host:port(:user:pass), and vless://, vmess://, trojan://, ss://, hy2://, tuic:// share URIs; supports "Custom Name | address" or #remark naming. Lines starting with # or // are ignored.',
                            )}
                        >
                            <Textarea
                                rows={7}
                                resize="vertical"
                                placeholder={
                                    'US-Res-1 | socks5://user:pass@198.51.100.1:1080\nhttp://user:pass@198.51.100.2:8080\nvless://00000000-0000-4000-8000-000000000001@example.com:443?security=tls#US-VLESS'
                                }
                                value={batchText}
                                onChange={(_, data) =>
                                    onBatchTextChange(data.value)
                                }
                            />
                        </Field>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'flex-end',
                                gap: '12px',
                                flexWrap: 'wrap',
                            }}
                        >
                            <Field
                                label={t(
                                    '默认命名前缀',
                                    'Default Name Prefix',
                                )}
                                style={{ flex: 1, minWidth: '180px' }}
                            >
                                <Input
                                    value={batchPrefix}
                                    onChange={(_, data) =>
                                        onBatchPrefixChange(data.value)
                                    }
                                    placeholder={t(
                                        '留空则使用 主机:端口',
                                        'Leave blank to use host:port',
                                    )}
                                />
                            </Field>
                            <Checkbox
                                checked={batchSkipDuplicates}
                                onChange={(_, data) =>
                                    onBatchSkipDuplicatesChange(
                                        Boolean(data.checked),
                                    )
                                }
                                label={t('自动跳过重复代理', 'Skip duplicates')}
                            />
                        </div>
                        {batchResult && (
                            <MessageBar
                                intent={
                                    batchResult.errors.length > 0
                                        ? 'warning'
                                        : 'success'
                                }
                                layout="multiline"
                            >
                                <MessageBarBody>
                                    <div>
                                        {isEn ? (
                                            <>
                                                Result: Imported{' '}
                                                <strong>
                                                    {
                                                        batchResult.imported
                                                            .length
                                                    }
                                                </strong>
                                                , skipped{' '}
                                                <strong>
                                                    {
                                                        batchResult
                                                            .skippedDuplicates
                                                            .length
                                                    }
                                                </strong>{' '}
                                                duplicate(s), failed{' '}
                                                <strong>
                                                    {batchResult.errors.length}
                                                </strong>
                                                .
                                            </>
                                        ) : (
                                            <>
                                                导入结果：成功{' '}
                                                <strong>
                                                    {
                                                        batchResult.imported
                                                            .length
                                                    }
                                                </strong>{' '}
                                                条，跳过重复{' '}
                                                <strong>
                                                    {
                                                        batchResult
                                                            .skippedDuplicates
                                                            .length
                                                    }
                                                </strong>{' '}
                                                条，失败{' '}
                                                <strong>
                                                    {batchResult.errors.length}
                                                </strong>{' '}
                                                条。
                                            </>
                                        )}
                                    </div>
                                    {batchResult.errors.length > 0 && (
                                        <div
                                            style={{
                                                marginTop: '6px',
                                                fontSize: '12px',
                                                maxHeight: '100px',
                                                overflowY: 'auto',
                                            }}
                                        >
                                            {batchResult.errors.map((item) => (
                                                <div
                                                    key={`${item.lineNumber}-${item.raw}`}
                                                >
                                                    {isEn
                                                        ? `Line ${item.lineNumber}: ${item.error} (${item.raw})`
                                                        : `第 ${item.lineNumber} 行：${item.error}（${item.raw}）`}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </MessageBarBody>
                            </MessageBar>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="secondary"
                            disabled={!!busy}
                            onClick={onClose}
                        >
                            {t('关闭', 'Close')}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={!!busy || !batchText.trim()}
                            onClick={onSubmit}
                        >
                            {busy === 'batch-import'
                                ? t('校验并导入中…', 'Importing…')
                                : t('开始导入', 'Import')}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export default BatchImportProxiesDialog;
