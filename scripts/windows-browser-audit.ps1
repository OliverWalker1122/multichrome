param(
    [Parameter(Mandatory)][ValidateSet('ConfigureHosted', 'Start', 'PrepareProfile', 'Check')][string]$Mode,
    [long]$Baseline,
    [string]$Directory
)
$ErrorActionPreference = 'Stop'
$logon = '{0CCE9215-69AE-11D9-BED3-505054503030}'
$userManagement = '{0CCE9235-69AE-11D9-BED3-505054503030}'
$hostedRunner = $env:GITHUB_ACTIONS -eq 'true' -and $env:RUNNER_ENVIRONMENT -eq 'github-hosted'

if ($Mode -eq 'ConfigureHosted') {
    if (-not $hostedRunner) { throw 'Audit configuration is restricted to a GitHub-hosted runner.' }
    auditpol.exe /set "/subcategory:$logon" /failure:enable | Out-Null
    if ($LASTEXITCODE) { throw 'Could not enable failed logon auditing.' }
    auditpol.exe /set "/subcategory:$userManagement" /success:enable | Out-Null
    if ($LASTEXITCODE) { throw 'Could not enable account lockout auditing.' }
    return
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($Mode -eq 'PrepareProfile') {
    # The upstream blank-password probe can run even with Autofill flags off on
    # Chromium 148. The non-blank branch keeps device reauthentication required.
    # Prefer the account's actual last password change; fall back to current UTC
    # time on MSA/domain accounts where Get-LocalUser is unavailable.
    $account = Get-LocalUser -SID $identity.User -ErrorAction SilentlyContinue
    $ticks = if ($account -and $account.PasswordLastSet) {
        $account.PasswordLastSet.ToUniversalTime().ToFileTimeUtc()
    } else {
        [DateTime]::UtcNow.ToFileTimeUtc()
    }
    # Chromium stores microseconds since 1601 and adds skew margin for its own
    # whole-second password-age clock comparison (password_manager_util_win.cc).
    $micros = [long]([decimal]::Floor([decimal]$ticks / 10)) + 5000000L
    $prefs = @{ password_manager = @{ os_password_blank = $false; os_password_last_changed = [string]$micros } }
    [IO.File]::WriteAllText((Join-Path $Directory 'test-local-state.json'), ($prefs | ConvertTo-Json -Compress))
    return
}
if ($Mode -eq 'Start') {
    $strictAudit = $hostedRunner -or $env:MULTICHROME_REQUIRE_SECURITY_AUDIT -eq '1'
    # AuditQuerySystemPolicy returns the effective bit mask directly, across
    # Windows versions and display languages. auditpol CSV layouts vary.
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class BrowserAuditPolicy {
    [StructLayout(LayoutKind.Sequential)]
    private struct Policy { public Guid subcategory; public uint flags; public Guid category; }
    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.U1)]
    private static extern bool AuditQuerySystemPolicy(ref Guid id, uint count, out IntPtr result);
    [DllImport("advapi32.dll")]
    private static extern void AuditFree(IntPtr value);
    public static uint Read(Guid id) {
        IntPtr result;
        if (!AuditQuerySystemPolicy(ref id, 1, out result)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            Policy policy = (Policy)Marshal.PtrToStructure(result, typeof(Policy));
            if (policy.subcategory != id) throw new InvalidOperationException("Unexpected audit subcategory");
            return policy.flags;
        } finally { AuditFree(result); }
    }
}
'@
    try {
        if (-not ([BrowserAuditPolicy]::Read([guid]$logon) -band 2)) { throw 'Failed logon auditing is disabled.' }
        if (-not ([BrowserAuditPolicy]::Read([guid]$userManagement) -band 1)) { throw 'User account management success auditing is disabled.' }
        $last = Get-WinEvent -LogName Security -MaxEvents 1 -ErrorAction Stop
        if (-not $last.RecordId) { throw 'Security event log unavailable.' }
        Write-Output $last.RecordId
    } catch {
        if ($strictAudit) { throw }
        Write-Output 'LOCAL_GUARD'
    }
    return
}

$pids = @{}
foreach ($entry in [IO.Directory]::GetFiles($Directory, '*.started')) {
    if ([IO.Path]::GetFileName($entry) -match '^([\da-f-]+)\.(\d+)\.(system-chrome|fingerprint-chromium)\.started$') {
        $number = [long]$Matches[2]
        $since = [IO.File]::GetLastWriteTimeUtc((Join-Path $Directory ($Matches[1] + '.go')))
        if (-not $pids.ContainsKey($number) -or $pids[$number] -gt $since) { $pids[$number] = $since }
    }
}
$latest = Get-WinEvent -LogName Security -MaxEvents 1
if ($latest.RecordId -lt $Baseline) { throw 'Security log baseline lost. Audit unverified.' }
$filter = "*[System[(EventID=4625 or EventID=4740 or EventID=1102) and EventRecordID > $Baseline]]"
$query = [System.Diagnostics.Eventing.Reader.EventLogQuery]::new('Security', 'LogName', $filter)
$reader = [System.Diagnostics.Eventing.Reader.EventLogReader]::new($query)
try {
    while ($null -ne ($event = $reader.ReadEvent())) {
        try {
            if ($event.Id -eq 1102) { throw 'Security log cleared during browser test. Audit unverified.' }
            $data = @{}
            foreach ($item in ([xml]$event.ToXml()).Event.EventData.Data) { $data[$item.Name] = $item.'#text' }
            if ($event.Id -eq 4740 -and $data.TargetSid -eq $identity.User.Value) {
                throw 'Security event 4740 for the test account. Further browser starts blocked.'
            }
            if ($event.Id -eq 4625 -and $data.ProcessId) {
                $caller = [Convert]::ToInt64(($data.ProcessId -replace '^0x', ''), 16)
                if ($pids.ContainsKey($caller) -and $event.TimeCreated.ToUniversalTime() -ge $pids[$caller]) {
                    throw 'Security event 4625 from a test browser PID. Further browser starts blocked.'
                }
            }
        } finally { $event.Dispose() }
    }
} finally { $reader.Dispose() }
