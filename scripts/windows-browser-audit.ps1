param(
    [Parameter(Mandatory)][ValidateSet('ConfigureHosted', 'Start', 'Check')][string]$Mode,
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
if ($Mode -eq 'Start') {
    if (-not $hostedRunner) {
        $group = Get-LocalGroup -Name 'MultiChromeTestRunners' -ErrorAction SilentlyContinue
        if (-not $group -or -not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole($group.SID)) {
            throw 'Blocked before browser startup. Use a disposable Windows VM or a dedicated test account in MultiChromeTestRunners.'
        }
    }
    foreach ($policy in @(@($logon, 2), @($userManagement, 1))) {
        $rows = @(auditpol.exe /get "/subcategory:$($policy[0])" /r)
        if ($LASTEXITCODE -or $rows.Count -lt 2) { throw 'Security audit policy could not be verified.' }
        # Numeric setting in the CSV is independent of the Windows display language.
        $row = $rows | ConvertFrom-Csv | Select-Object -Last 1
        $fields = @($row.PSObject.Properties.Value)
        if ($fields -notcontains $policy[0] -or -not ([int]$fields[-1] -band $policy[1])) {
            throw 'Failed logon and successful user-account-management auditing must both be enabled.'
        }
    }
    $last = Get-WinEvent -LogName Security -MaxEvents 1
    if (-not $last.RecordId) { throw 'Security event log unavailable.' }
    Write-Output $last.RecordId
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
