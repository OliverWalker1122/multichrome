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
    Radio,
    RadioGroup,
    Select,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import { DeleteGroupOptions } from '../../types';
import { tr, useI18n } from '../../i18n';

interface DeleteGroupDialogProps {
    groupName: string | null;
    environmentCount: number;
    runningCount: number;
    availableTargetGroups: string[];
    onCancel: () => void;
    onConfirm: (options: DeleteGroupOptions) => Promise<void>;
}

const useStyles = makeStyles({
    content: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        paddingTop: '4px',
    },
    summary: {
        margin: 0,
        fontSize: '13.5px',
        color: tokens.colorNeutralForeground1,
        lineHeight: '20px',
    },
    radioGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    },
    optionDesc: {
        margin: '2px 0 0 28px',
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        lineHeight: '18px',
    },
    targetField: {
        marginLeft: '28px',
        marginTop: '6px',
    },
});

function cleanError(error: unknown): string {
    if (error instanceof Error) {
        return error.message.replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            '',
        );
    }
    return tr('删除分组失败，请稍后重试。', 'Failed to delete group. Please try again.');
}

const DeleteGroupDialog: React.FC<DeleteGroupDialogProps> = ({
    groupName,
    environmentCount,
    runningCount,
    availableTargetGroups,
    onCancel,
    onConfirm,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const canMove = availableTargetGroups.length > 0;
    const [action, setAction] = useState<'move' | 'trash'>(
        canMove ? 'move' : 'trash',
    );
    const [targetGroup, setTargetGroup] = useState(
        availableTargetGroups[0] || '',
    );
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (groupName !== null) {
            const nextCanMove = availableTargetGroups.length > 0;
            setAction(nextCanMove ? 'move' : 'trash');
            setTargetGroup(availableTargetGroups[0] || '');
            setError('');
        }
    }, [groupName, availableTargetGroups]);

    const handleClose = () => {
        if (submitting) return;
        setError('');
        onCancel();
    };

    const handleSubmit = async () => {
        if (!groupName) return;
        try {
            setSubmitting(true);
            setError('');
            if (environmentCount === 0) {
                await onConfirm({ action: 'trash' });
                return;
            }
            if (action === 'move') {
                await onConfirm({
                    action: 'move',
                    targetGroup: targetGroup || availableTargetGroups[0],
                });
            } else {
                await onConfirm({ action: 'trash' });
            }
        } catch (err) {
            setError(cleanError(err));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog
            open={groupName !== null}
            onOpenChange={(_, data) => {
                if (!data.open) handleClose();
            }}
        >
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{t('删除分组', 'Delete Group')}</DialogTitle>
                    <DialogContent>
                        <div className={styles.content}>
                            {error && (
                                <MessageBar intent="error" layout="multiline">
                                    <MessageBarBody>{error}</MessageBarBody>
                                </MessageBar>
                            )}

                            {environmentCount === 0 ? (
                                <p className={styles.summary}>
                                    {isEn
                                        ? `Delete empty group "${groupName}"? No environment data will be affected.`
                                        : `确定要删除空分组“${groupName}”吗？此操作不会影响任何环境数据。`}
                                </p>
                            ) : (
                                <>
                                    <p className={styles.summary}>
                                        {isEn ? (
                                            <>
                                                Group &ldquo;{groupName}&rdquo; contains{' '}
                                                <strong>{environmentCount}</strong>{' '}
                                                environment{environmentCount > 1 ? 's' : ''}
                                                {runningCount > 0
                                                    ? ` (${runningCount} running)`
                                                    : ''}
                                                . Choose what to do with them:
                                            </>
                                        ) : (
                                            <>
                                                分组“{groupName}”下共有{' '}
                                                <strong>{environmentCount}</strong>{' '}
                                                个环境
                                                {runningCount > 0
                                                    ? `（其中 ${runningCount} 个正在运行）`
                                                    : ''}
                                                ，请选择组内环境的处理方式：
                                            </>
                                        )}
                                    </p>

                                    <RadioGroup
                                        className={styles.radioGroup}
                                        value={action}
                                        onChange={(_, data) =>
                                            setAction(
                                                data.value as 'move' | 'trash',
                                            )
                                        }
                                    >
                                        <div>
                                            <Radio
                                                value="move"
                                                disabled={!canMove || submitting}
                                                label={t(
                                                    '移至其他分组（保留全部环境）',
                                                    'Move to another group (keep all environments)',
                                                )}
                                            />
                                            {canMove ? (
                                                action === 'move' && (
                                                    <div
                                                        className={
                                                            styles.targetField
                                                        }
                                                    >
                                                        <Field
                                                            label={t(
                                                                '目标分组',
                                                                'Target Group',
                                                            )}
                                                        >
                                                            <Select
                                                                disabled={
                                                                    submitting
                                                                }
                                                                value={
                                                                    targetGroup
                                                                }
                                                                onChange={(
                                                                    _,
                                                                    data,
                                                                ) =>
                                                                    setTargetGroup(
                                                                        data.value,
                                                                    )
                                                                }
                                                            >
                                                                {availableTargetGroups.map(
                                                                    (group) => (
                                                                        <option
                                                                            key={
                                                                                group
                                                                            }
                                                                            value={
                                                                                group
                                                                            }
                                                                        >
                                                                            {
                                                                                group
                                                                            }
                                                                        </option>
                                                                    ),
                                                                )}
                                                            </Select>
                                                        </Field>
                                                    </div>
                                                )
                                            ) : (
                                                <p className={styles.optionDesc}>
                                                    {t(
                                                        '当前没有其他可用分组，无法直接迁移。',
                                                        'No other groups available to move into.',
                                                    )}
                                                </p>
                                            )}
                                        </div>

                                        <div>
                                            <Radio
                                                value="trash"
                                                disabled={submitting}
                                                label={t(
                                                    '将组内环境一并移入回收站',
                                                    'Move environments in this group to Trash',
                                                )}
                                            />
                                            <p className={styles.optionDesc}>
                                                {t(
                                                    '环境将移入回收站并保留 30 天，不会立即删除本地 profile 目录，可随时恢复。',
                                                    'Environments will be kept in Trash for 30 days and can be restored anytime.',
                                                )}
                                                {runningCount > 0
                                                    ? t(
                                                          '运行中的浏览器将先自动关闭。',
                                                          ' Running browsers will be closed automatically.',
                                                      )
                                                    : ''}
                                            </p>
                                        </div>
                                    </RadioGroup>
                                </>
                            )}
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="secondary"
                            disabled={submitting}
                            onClick={handleClose}
                        >
                            {t('取消', 'Cancel')}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={submitting}
                            onClick={() => void handleSubmit()}
                        >
                            {submitting
                                ? t('删除中…', 'Deleting…')
                                : t('确认删除', 'Delete')}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export default DeleteGroupDialog;
