import type {
    ChromeEnvironment,
    LaunchConsistencyReport,
    LaunchGuardEntry,
} from '../types';

export async function checkProfile(
    env: ChromeEnvironment,
    readReport: (id: string) => Promise<LaunchConsistencyReport | null>,
    translate: (zh: string, en: string) => string,
): Promise<LaunchGuardEntry> {
    try {
        const report = await readReport(env.id);
        if (report) return { env, report };
    } catch {
        // An interrupted IPC check requires the same retry as a missing report.
    }
    return {
        env,
        incomplete: true,
        report: {
            ok: false,
            hasError: true,
            canAutoAlign: false,
            issues: [
                {
                    id: 'check-unavailable',
                    severity: 'error',
                    title: translate('预检未完成', 'Check incomplete'),
                    detail: translate(
                        '未收到检查结果，请重新检查。',
                        'No result was received. Retry the check.',
                    ),
                },
            ],
        },
    };
}

export function canLaunchProfile(entry: LaunchGuardEntry) {
    return !entry.incomplete && !entry.report.hasError;
}
