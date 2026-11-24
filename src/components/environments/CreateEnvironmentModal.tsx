import React, { useState, useEffect, useMemo } from 'react';
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
    Select,
    Textarea,
    makeStyles,
} from '@fluentui/react-components';
import {
    BatchCreateEnvironmentsInput,
    BrowserEngineType,
    ChromeEnvironment,
    ManagedProxy,
} from '../../types';
import {
    ChevronDownRegular,
    ChevronUpRegular,
} from '@fluentui/react-icons';
import { getGroupStyle } from '../../theme/semanticColors';
import { useI18n } from '../../i18n';
import TagEditor from '../common/TagEditor';
import InfoTip from '../common/InfoTip';
import { collectTagStats } from '../../utils/environmentTags';

interface CreateEnvironmentModalProps {
    open: boolean;
    onOk: (
        name: string,
        groupName: string,
        notes: string,
        options?: {
            browserEngine?: BrowserEngineType;
            proxyId?: string;
            tags?: string[];
        },
    ) => Promise<void>;
    onBatchCreate?: (payload: BatchCreateEnvironmentsInput) => Promise<void>;
    onCancel: () => void;
    groups: string[];
    defaultGroup?: string;
    defaultEngine?: BrowserEngineType;
    hasFingerprintKernel?: boolean;
    managedProxies?: ManagedProxy[];
    allEnvironments?: ChromeEnvironment[];
}

const useStyles = makeStyles({
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        paddingTop: '4px',
    },
    chips: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        marginTop: '6px',
    },
    labelRow: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
    },
    twoCol: {
        display: 'grid',
        gridTemplateColumns: '1fr 112px',
        gap: '10px',
    },
    moreToggle: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        marginTop: '2px',
    },
});

const CreateEnvironmentModal: React.FC<CreateEnvironmentModalProps> = ({
    open,
    onOk,
    onBatchCreate,
    onCancel,
    groups,
    defaultGroup,
    defaultEngine = 'system-chrome',
    hasFingerprintKernel = false,
    managedProxies = [],
    allEnvironments = [],
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const [loading, setLoading] = useState(false);
    const [name, setName] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [groupName, setGroupName] = useState('');
    const [notes, setNotes] = useState('');
    const [proxyId, setProxyId] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [showMore, setShowMore] = useState(false);
    const [browserEngine, setBrowserEngine] =
        useState<BrowserEngineType>('system-chrome');
    const existingTagSuggestions = useMemo(
        () => collectTagStats(allEnvironments).map((item) => item.tag),
        [allEnvironments],
    );
    const [fieldErrors, setFieldErrors] = useState<{
        name?: string;
        groupName?: string;
    }>({});
    const [submitError, setSubmitError] = useState('');

    useEffect(() => {
        if (open) {
            setGroupName(
                (prev) =>
                    prev ||
                    (defaultGroup && defaultGroup !== '用户分组'
                        ? defaultGroup
                        : groups[0] || '默认分组'),
            );
            setBrowserEngine(
                defaultEngine === 'fingerprint-chromium' && hasFingerprintKernel
                    ? 'fingerprint-chromium'
                    : 'system-chrome',
            );
            setSubmitError('');
            setFieldErrors({});
        }
    }, [open, defaultGroup, groups, defaultEngine, hasFingerprintKernel]);

    const resetAndClose = () => {
        if (loading) return;
        setName('');
        setQuantity('1');
        setGroupName('');
        setNotes('');
        setProxyId('');
        setTags([]);
        setShowMore(false);
        setFieldErrors({});
        setSubmitError('');
        onCancel();
    };

    const parsedQuantity = Math.max(
        1,
        Math.min(50, Math.floor(Number(quantity) || 1)),
    );
    const isBulkMode = parsedQuantity > 1 && Boolean(onBatchCreate);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const nextErrors: { name?: string; groupName?: string } = {};
        if (!name.trim())
            nextErrors.name = isBulkMode
                ? t('请输入名称前缀', 'Please enter a name prefix')
                : t('请输入环境名称', 'Please enter an environment name');
        if (!groupName.trim())
            nextErrors.groupName = t(
                '请选择或输入分组名称',
                'Please select or enter a group name',
            );
        setFieldErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;

        try {
            setLoading(true);
            setSubmitError('');
            if (isBulkMode && onBatchCreate) {
                const isSequential = proxyId === '__sequential__';
                await onBatchCreate({
                    namePrefix: name.trim(),
                    groupName: groupName.trim(),
                    count: parsedQuantity,
                    notes: notes.trim(),
                    browserEngine,
                    proxyMode: isSequential
                        ? 'sequential'
                        : proxyId
                          ? 'single'
                          : 'none',
                    proxyIds: isSequential
                        ? managedProxies.map((p) => p.id)
                        : proxyId
                          ? [proxyId]
                          : [],
                    tags,
                });
            } else {
                await onOk(
                    name.trim(),
                    groupName.trim(),
                    notes.trim(),
                    {
                        browserEngine,
                        ...(proxyId && proxyId !== '__sequential__'
                            ? { proxyId }
                            : {}),
                        ...(tags.length > 0 ? { tags } : {}),
                    },
                );
            }
            setName('');
            setQuantity('1');
            setGroupName('');
            setNotes('');
            setProxyId('');
            setTags([]);
            setFieldErrors({});
        } catch (error) {
            setSubmitError(
                error instanceof Error
                    ? error.message
                    : t(
                          '创建环境失败，请检查名称或数据目录权限后重试。',
                          'Failed to create environment. Check the name or data directory permissions and try again.',
                      ),
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(_, data) => {
                if (!data.open) resetAndClose();
            }}
        >
            <DialogSurface>
                <form onSubmit={(event) => void handleSubmit(event)}>
                    <DialogBody>
                        <DialogTitle>
                            {t('新建浏览器环境', 'New Browser Environment')}
                        </DialogTitle>
                        <DialogContent>
                            <div className={styles.form}>
                                {submitError && (
                                    <MessageBar
                                        intent="error"
                                        layout="multiline"
                                    >
                                        <MessageBarBody>
                                            {submitError}
                                        </MessageBarBody>
                                    </MessageBar>
                                )}

                                <div className={onBatchCreate ? styles.twoCol : undefined}>
                                    <Field
                                        label={
                                            isBulkMode
                                                ? t('名称前缀', 'Name Prefix')
                                                : t('环境名称', 'Environment Name')
                                        }
                                        required
                                        validationState={
                                            fieldErrors.name ? 'error' : 'none'
                                        }
                                        validationMessage={fieldErrors.name}
                                    >
                                        <Input
                                            autoFocus
                                            placeholder={
                                                isBulkMode
                                                    ? t(
                                                          '例如：美国商店',
                                                          'e.g., US Storefront',
                                                      )
                                                    : t(
                                                          '例如：美国账号 01、AI 工作区',
                                                          'e.g., US Account 01, AI Workspace',
                                                      )
                                            }
                                            value={name}
                                            onChange={(_, data) =>
                                                setName(data.value)
                                            }
                                        />
                                    </Field>
                                    {onBatchCreate && (
                                        <Field label={t('创建数量', 'Quantity')}>
                                            <Input
                                                type="number"
                                                min={1}
                                                max={50}
                                                step={1}
                                                value={quantity}
                                                onChange={(_, data) => {
                                                    const val = data.value;
                                                    setQuantity(val);
                                                    if (
                                                        (Number(val) || 1) <= 1 &&
                                                        proxyId ===
                                                            '__sequential__'
                                                    ) {
                                                        setProxyId('');
                                                    }
                                                }}
                                            />
                                        </Field>
                                    )}
                                </div>

                                <Field
                                    label={
                                        <span className={styles.labelRow}>
                                            {t('浏览器', 'Browser')}
                                            <InfoTip
                                                content={
                                                    browserEngine ===
                                                    'fingerprint-chromium'
                                                        ? hasFingerprintKernel
                                                            ? t(
                                                                  '防关联浏览器会为每个环境自动分配独立设备特征，适合多账号防关联',
                                                                  'Automatically generates unique device signatures for anti-correlation.',
                                                              )
                                                            : t(
                                                                  '尚未安装防关联浏览器，请先在「设置 → 组件」中安装',
                                                                  'Privacy Browser not installed yet. Install it in Settings → Components.',
                                                              )
                                                        : t(
                                                              '系统自带的标准 Google Chrome，适合重要主号',
                                                              'Standard Google Chrome, ideal for primary accounts.',
                                                          )
                                                }
                                            />
                                        </span>
                                    }
                                >
                                    <Select
                                        value={browserEngine}
                                        onChange={(_, data) =>
                                            setBrowserEngine(
                                                data.value as BrowserEngineType,
                                            )
                                        }
                                    >
                                        <option value="system-chrome">
                                            {t('标准 Chrome', 'Standard Chrome')}
                                        </option>
                                        <option value="fingerprint-chromium">
                                            {isEn
                                                ? `Privacy Browser${hasFingerprintKernel ? '' : ' (Not Installed)'}`
                                                : `防关联浏览器${hasFingerprintKernel ? '' : '（未安装）'}`}
                                        </option>
                                    </Select>
                                </Field>

                                <Field
                                    label={
                                        <span className={styles.labelRow}>
                                            {t('代理', 'Proxy')}
                                            <InfoTip
                                                content={t(
                                                    '不指定时将使用全局备用代理或直连',
                                                    'Uses fallback proxy or direct connection when unspecified.',
                                                )}
                                            />
                                        </span>
                                    }
                                >
                                    <Select
                                        value={proxyId}
                                        onChange={(_, data) =>
                                            setProxyId(data.value)
                                        }
                                    >
                                        <option value="">
                                            {t('全局默认', 'Global Default')}
                                        </option>
                                        {isBulkMode &&
                                            managedProxies.length > 0 && (
                                                <option value="__sequential__">
                                                    {t(
                                                        '按顺序轮询分配代理',
                                                        'Sequential Proxy Assignment',
                                                    )}
                                                </option>
                                            )}
                                        {managedProxies.map((item) => (
                                            <option
                                                key={item.id}
                                                value={item.id}
                                            >
                                                {item.name} (
                                                {item.protocol.toUpperCase()})
                                            </option>
                                        ))}
                                    </Select>
                                </Field>

                                {proxyId &&
                                    proxyId !== '__sequential__' &&
                                    (() => {
                                        const sharedWith =
                                            allEnvironments.filter(
                                                (item) =>
                                                    item.proxyId === proxyId,
                                            );
                                        if (sharedWith.length === 0)
                                            return null;
                                        const names = sharedWith
                                            .slice(0, 3)
                                            .map((item) => item.name)
                                            .join(isEn ? ', ' : '、');
                                        return (
                                            <MessageBar
                                                intent="warning"
                                                layout="multiline"
                                            >
                                                <MessageBarBody>
                                                    {isEn
                                                        ? `Already used by ${sharedWith.length} profile(s) (${names}${sharedWith.length > 3 ? '…' : ''})`
                                                        : `此代理已被 ${sharedWith.length} 个环境使用（${names}${sharedWith.length > 3 ? ' 等' : ''}），共用 IP 存在关联风险`}
                                                </MessageBarBody>
                                            </MessageBar>
                                        );
                                    })()}

                                <Field
                                    label={
                                        <span className={styles.labelRow}>
                                            {t('分组', 'Group')}
                                            <InfoTip
                                                content={t(
                                                    '输入新名称会自动创建分组',
                                                    'Typing a new name automatically creates a group.',
                                                )}
                                            />
                                        </span>
                                    }
                                    required
                                    validationState={
                                        fieldErrors.groupName ? 'error' : 'none'
                                    }
                                    validationMessage={fieldErrors.groupName}
                                >
                                    <Input
                                        placeholder={t(
                                            '选择或输入分组名称',
                                            'Select or enter group name',
                                        )}
                                        value={groupName}
                                        onChange={(_, data) =>
                                            setGroupName(data.value)
                                        }
                                    />
                                    {groups.length > 0 && (
                                        <div className={styles.chips}>
                                            {groups.slice(0, 6).map((group) => (
                                                <Button
                                                    key={group}
                                                    type="button"
                                                    size="small"
                                                    appearance={
                                                        groupName === group
                                                            ? 'primary'
                                                            : 'subtle'
                                                    }
                                                    style={
                                                        groupName === group
                                                            ? undefined
                                                            : getGroupStyle(
                                                                  group,
                                                              )
                                                    }
                                                    aria-pressed={
                                                        groupName === group
                                                    }
                                                    onClick={() =>
                                                        setGroupName(group)
                                                    }
                                                >
                                                    {group}
                                                </Button>
                                            ))}
                                        </div>
                                    )}
                                </Field>

                                <div className={styles.moreToggle}>
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="subtle"
                                        icon={
                                            showMore ? (
                                                <ChevronUpRegular />
                                            ) : (
                                                <ChevronDownRegular />
                                            )
                                        }
                                        iconPosition="after"
                                        onClick={() =>
                                            setShowMore((prev) => !prev)
                                        }
                                    >
                                        {showMore
                                            ? t('收起更多选项', 'Hide More Options')
                                            : t('标签与备注（可选）', 'Tags & Notes (Optional)')}
                                    </Button>
                                </div>

                                {showMore && (
                                    <>
                                        <Field label={t('标签', 'Tags')}>
                                            <TagEditor
                                                value={tags}
                                                onChange={setTags}
                                                suggestions={
                                                    existingTagSuggestions
                                                }
                                                disabled={loading}
                                            />
                                        </Field>

                                        <Field label={t('备注', 'Notes')}>
                                            <Textarea
                                                rows={2}
                                                placeholder={t(
                                                    '用途说明或账号备注',
                                                    'Purpose or account notes',
                                                )}
                                                value={notes}
                                                onChange={(_, data) =>
                                                    setNotes(data.value)
                                                }
                                            />
                                        </Field>
                                    </>
                                )}
                            </div>
                        </DialogContent>
                        <DialogActions>
                            <Button
                                type="button"
                                appearance="secondary"
                                disabled={loading}
                                onClick={resetAndClose}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                type="submit"
                                appearance="primary"
                                disabled={loading}
                            >
                                {loading
                                    ? t('创建中…', 'Creating…')
                                    : t('创建环境', 'Create')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </form>
            </DialogSurface>
        </Dialog>
    );
};

export default CreateEnvironmentModal;
