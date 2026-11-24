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
    Input,
    MessageBar,
    MessageBarBody,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import { tr, useI18n } from '../../i18n';

interface RenameGroupDialogProps {
    groupName: string | null;
    existingGroups: string[];
    onCancel: () => void;
    onConfirm: (oldName: string, newName: string) => Promise<void>;
}

const useStyles = makeStyles({
    content: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        paddingTop: '4px',
    },
    hint: {
        margin: 0,
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
});

function cleanError(error: unknown): string {
    if (error instanceof Error) {
        return error.message.replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            '',
        );
    }
    return tr('重命名分组失败，请重试。', 'Failed to rename group. Please retry.');
}

const RenameGroupDialog: React.FC<RenameGroupDialogProps> = ({
    groupName,
    existingGroups,
    onCancel,
    onConfirm,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const [nextName, setNextName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (groupName !== null) {
            setNextName(groupName);
            setError('');
        }
    }, [groupName]);

    const trimmed = nextName.trim();
    const willMerge =
        Boolean(groupName) &&
        Boolean(trimmed) &&
        trimmed !== groupName &&
        existingGroups.includes(trimmed);

    const handleClose = () => {
        if (submitting) return;
        setError('');
        onCancel();
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!groupName) return;
        if (!trimmed) {
            setError(t('请输入新的分组名称', 'Please enter a new group name'));
            return;
        }
        if (trimmed === groupName) {
            setError(
                t(
                    '新分组名称不能与原名称相同',
                    'New group name must be different from the current name',
                ),
            );
            return;
        }
        try {
            setSubmitting(true);
            setError('');
            await onConfirm(groupName, trimmed);
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
                <form onSubmit={(event) => void handleSubmit(event)}>
                    <DialogBody>
                        <DialogTitle>{t('重命名分组', 'Rename Group')}</DialogTitle>
                        <DialogContent>
                            <div className={styles.content}>
                                {error && (
                                    <MessageBar
                                        intent="error"
                                        layout="multiline"
                                    >
                                        <MessageBarBody>{error}</MessageBarBody>
                                    </MessageBar>
                                )}
                                <Field
                                    label={t('新分组名称', 'New Group Name')}
                                    required
                                >
                                    <Input
                                        autoFocus
                                        disabled={submitting}
                                        value={nextName}
                                        onChange={(_, data) =>
                                            setNextName(data.value)
                                        }
                                        placeholder={t(
                                            '输入新的分组名称',
                                            'Enter new group name',
                                        )}
                                    />
                                </Field>
                                {willMerge && (
                                    <p className={styles.hint}>
                                        {isEn
                                            ? `Group "${trimmed}" already exists. Confirming will merge environments from "${groupName}" into "${trimmed}".`
                                            : `分组“${trimmed}”已存在，确认后会将“${groupName}”下的环境合并至“${trimmed}”。`}
                                    </p>
                                )}
                            </div>
                        </DialogContent>
                        <DialogActions>
                            <Button
                                type="button"
                                appearance="secondary"
                                disabled={submitting}
                                onClick={handleClose}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                type="submit"
                                appearance="primary"
                                disabled={submitting}
                            >
                                {submitting
                                    ? t('保存中…', 'Saving…')
                                    : t('确认重命名', 'Rename')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </form>
            </DialogSurface>
        </Dialog>
    );
};

export default RenameGroupDialog;
