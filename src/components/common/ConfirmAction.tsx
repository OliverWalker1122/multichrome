import React from 'react';
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import { useI18n } from '../../i18n';

export function ConfirmAction({ title, children, action, onCancel, onConfirm }: {
    title: string; children: React.ReactNode; action: string; onCancel: () => void; onConfirm: () => void;
}) {
    const { t } = useI18n();
    return (
        <Dialog open modalType="alert" onOpenChange={(_, data) => { if (!data.open) onCancel(); }}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogContent>{children}</DialogContent>
                    <DialogActions>
                        <Button onClick={onCancel}>{t('取消', 'Cancel')}</Button>
                        <Button appearance="primary" onClick={onConfirm}>{action}</Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
