import React, { useMemo, useState } from 'react';
import {
    Button,
    Input,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import { AddRegular, Dismiss12Regular } from '@fluentui/react-icons';
import { getTagStyle } from '../theme/semanticColors';
import {
    MAX_TAG_LENGTH,
    MAX_TAGS_PER_ENV,
    normalizeEnvironmentTags,
    parseTagInput,
} from '../utils/environmentTags';
import { useI18n } from '../i18n';

interface TagEditorProps {
    value: string[];
    onChange: (nextTags: string[]) => void;
    suggestions?: string[];
    disabled?: boolean;
    placeholder?: string;
}

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
    },
    inputRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
    },
    input: {
        flex: 1,
        minWidth: 0,
    },
    tagsWrap: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
    },
    tagChip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '12px',
        fontWeight: 500,
        lineHeight: '18px',
        maxWidth: '100%',
    },
    tagText: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: '160px',
    },
    removeBtn: {
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        padding: '0',
        width: '14px',
        height: '14px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        opacity: 0.78,
        ':hover': {
            opacity: 1,
            backgroundColor: 'rgba(127, 127, 127, 0.18)',
        },
        ':disabled': {
            cursor: 'not-allowed',
            opacity: 0.4,
        },
    },
    suggestionsWrap: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '5px',
    },
    suggestionsLabel: {
        fontSize: '11px',
        color: tokens.colorNeutralForeground3,
    },
    suggestionBtn: {
        border: `1px dashed ${tokens.colorNeutralStroke1}`,
        borderRadius: '999px',
        padding: '1px 8px',
        fontSize: '11px',
        lineHeight: '18px',
        cursor: 'pointer',
        opacity: 0.88,
        ':hover': {
            opacity: 1,
        },
        ':disabled': {
            cursor: 'not-allowed',
            opacity: 0.45,
        },
    },
    hint: {
        fontSize: '11px',
        color: tokens.colorNeutralForeground3,
    },
});

const TagEditor: React.FC<TagEditorProps> = ({
    value,
    onChange,
    suggestions = [],
    disabled = false,
    placeholder,
}) => {
    const styles = useStyles();
    const { t } = useI18n();
    const [draft, setDraft] = useState('');

    const normalizedValue = useMemo(
        () => normalizeEnvironmentTags(value),
        [value],
    );
    const selectedKeys = useMemo(
        () => new Set(normalizedValue.map((tag) => tag.toLowerCase())),
        [normalizedValue],
    );
    const reachedLimit = normalizedValue.length >= MAX_TAGS_PER_ENV;

    const commitDraft = (rawText = draft) => {
        const parsed = parseTagInput(rawText);
        if (parsed.length === 0) {
            setDraft('');
            return;
        }
        const merged = normalizeEnvironmentTags([...normalizedValue, ...parsed]);
        onChange(merged);
        setDraft('');
    };

    const removeTag = (target: string) => {
        const key = target.toLowerCase();
        onChange(normalizedValue.filter((tag) => tag.toLowerCase() !== key));
    };

    const addSuggestion = (tag: string) => {
        if (disabled || reachedLimit) return;
        const merged = normalizeEnvironmentTags([...normalizedValue, tag]);
        onChange(merged);
    };

    const filteredSuggestions = useMemo(() => {
        const query = draft.trim().toLowerCase();
        return normalizeEnvironmentTags(suggestions)
            .filter((tag) => !selectedKeys.has(tag.toLowerCase()))
            .filter((tag) => !query || tag.toLowerCase().includes(query))
            .slice(0, 10);
    }, [suggestions, selectedKeys, draft]);

    return (
        <div className={styles.root}>
            {normalizedValue.length > 0 && (
                <div className={styles.tagsWrap}>
                    {normalizedValue.map((tag) => (
                        <span
                            key={tag}
                            className={styles.tagChip}
                            style={getTagStyle(tag)}
                        >
                            <span className={styles.tagText}>#{tag}</span>
                            <button
                                type="button"
                                className={styles.removeBtn}
                                disabled={disabled}
                                aria-label={t(`移除标签 ${tag}`, `Remove tag ${tag}`)}
                                onClick={() => removeTag(tag)}
                            >
                                <Dismiss12Regular />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <div className={styles.inputRow}>
                <Input
                    size="small"
                    className={styles.input}
                    value={draft}
                    disabled={disabled || reachedLimit}
                    maxLength={MAX_TAG_LENGTH * 2}
                    placeholder={
                        reachedLimit
                            ? t(
                                  `已达上限（最多 ${MAX_TAGS_PER_ENV} 个标签）`,
                                  `Limit reached (max ${MAX_TAGS_PER_ENV} tags)`,
                              )
                            : placeholder ||
                              t(
                                  '输入标签后按回车或逗号添加',
                                  'Type a tag and press Enter or comma',
                              )
                    }
                    onChange={(_, data) => {
                        if (/[,，;；]/.test(data.value)) {
                            commitDraft(data.value);
                        } else {
                            setDraft(data.value);
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            commitDraft();
                        } else if (
                            event.key === 'Backspace' &&
                            !draft &&
                            normalizedValue.length > 0
                        ) {
                            event.preventDefault();
                            onChange(normalizedValue.slice(0, -1));
                        }
                    }}
                    onBlur={() => {
                        if (draft.trim()) {
                            commitDraft();
                        }
                    }}
                />
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<AddRegular />}
                    disabled={disabled || reachedLimit || !draft.trim()}
                    onClick={() => commitDraft()}
                >
                    {t('添加', 'Add')}
                </Button>
            </div>

            {filteredSuggestions.length > 0 && !reachedLimit && (
                <div className={styles.suggestionsWrap}>
                    <span className={styles.suggestionsLabel}>
                        {t('常用标签:', 'Existing:')}
                    </span>
                    {filteredSuggestions.map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            className={styles.suggestionBtn}
                            style={getTagStyle(tag)}
                            disabled={disabled}
                            onClick={() => addSuggestion(tag)}
                        >
                            + {tag}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TagEditor;
