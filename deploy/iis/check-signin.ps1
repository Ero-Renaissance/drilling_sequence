<#
.SYNOPSIS
  Read-only check of the IIS Windows sign-in setup for Drilling Sequence.

.DESCRIPTION
  Reports each setting from docs/iis-signin-handover.md as OK or FAIL, with the
  fix for anything that is off. It CHANGES NOTHING: it only reads IIS and
  firewall settings and sends three ordinary web requests to the app (the same
  as opening a page). It never prints the proxy shared secret.

  Run it on the server that hosts the app, in PowerShell opened with
  "Run as administrator":

      .\check-signin.ps1                          # lists the IIS sites
      .\check-signin.ps1 -SiteName "My Site"      # checks that site

  To keep the result in a file to send on:

      .\check-signin.ps1 -SiteName "My Site" | Tee-Object signin-check.txt

  If Windows refuses to run the file ("running scripts is disabled"), run it
  for this one time with:

      powershell -ExecutionPolicy Bypass -File .\check-signin.ps1 -SiteName "My Site"

.PARAMETER SiteName
  The IIS site that fronts the app, as shown in IIS Manager.

.PARAMETER BackendPort
  The port the app (uvicorn) listens on. Default 8000.

.PARAMETER UserHeader
  The header the app reads the signed-in user from (PROXY_USER_HEADER in
  backend\.env). Default X-Remote-User.

.PARAMETER Url
  The site's address, e.g. http://myserver:8083. Worked out from the site's
  bindings when left out.
#>
[CmdletBinding()]
param(
    [string]$SiteName,
    [ValidateRange(1, 65535)][int]$BackendPort = 8000,
    [ValidatePattern('^[A-Za-z0-9-]{1,64}$')][string]$UserHeader = 'X-Remote-User',
    [ValidatePattern('^https?://[^\s/]+/?$')][string]$Url
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:Fails = 0
$script:Warns = 0

function Report {
    param([string]$Level, [string]$Text, [string]$Fix)
    $tag = '[INFO]'
    if ($Level -eq 'OK') { $tag = '[ OK ]' }
    if ($Level -eq 'FAIL') { $tag = '[FAIL]'; $script:Fails++ }
    if ($Level -eq 'WARN') { $tag = '[WARN]'; $script:Warns++ }
    Write-Output "$tag $Text"
    if ($Fix) { Write-Output "       Fix: $Fix" }
}

# Run one check; a check that cannot be read is a warning, never a crash.
function Check {
    param([string]$Name, [scriptblock]$Block)
    try {
        & $Block
    } catch {
        Report 'WARN' "Could not check: $Name ($($_.Exception.Message))"
    }
}

# A config attribute comes back as the value itself or wrapped in an object.
function Get-ConfigValue {
    param([string]$Path, [string]$Filter, [string]$Name)
    $v = Get-WebConfigurationProperty -PSPath $Path -Filter $Filter -Name $Name
    if ($null -ne $v -and $v.PSObject.Properties['Value']) { return $v.Value }
    return $v
}

# GET a URL with no credentials. Returns the status code and the sign-in
# challenge; an HTTP error code is a result here, not an exception.
function Invoke-Probe {
    param([string]$Address)
    try {
        $r = Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 15
        return @{ Status = [int]$r.StatusCode; Challenge = '' }
    } catch {
        $resp = $null
        if ($_.Exception.PSObject.Properties['Response']) { $resp = $_.Exception.Response }
        if ($null -eq $resp) { throw }
        $challenge = ''
        try {
            $challenge = [string]$resp.Headers['WWW-Authenticate']
        } catch {
            try { $challenge = [string]$resp.Headers.WwwAuthenticate } catch { $challenge = '' }
        }
        return @{ Status = [int]$resp.StatusCode; Challenge = $challenge }
    }
}

Write-Output "Drilling Sequence - Windows sign-in check (read-only)"
Write-Output ("Server: {0}   Date: {1}" -f $env:COMPUTERNAME, (Get-Date -Format 'yyyy-MM-dd HH:mm'))
Write-Output ''

# --- Before anything else: administrator, and the IIS tools -----------------
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Output '[FAIL] Not running as administrator.'
    Write-Output '       Fix: close this window, open PowerShell with "Run as administrator", run again.'
    exit 1
}

try {
    Import-Module WebAdministration
} catch {
    Write-Output '[FAIL] The IIS PowerShell tools are not on this server, so nothing can be read.'
    Write-Output '       Fix: run this on the server that hosts the app; if it is that server, install'
    Write-Output '       "IIS Management Scripts and Tools" (Install-WindowsFeature Web-Scripting-Tools).'
    exit 1
}

$sites = @(Get-Website)
$site = $null
if ($SiteName) {
    $site = $sites | Where-Object { $_.Name -eq $SiteName } | Select-Object -First 1
}
if ($null -eq $site) {
    if ($SiteName) { Write-Output "[FAIL] No IIS site is named '$SiteName'." }
    Write-Output 'IIS sites on this server:'
    foreach ($s in $sites) {
        $b = @($s.bindings.Collection | ForEach-Object { "$($_.protocol) $($_.bindingInformation)" }) -join ', '
        Write-Output ("  {0}   [{1}]   {2}" -f $s.Name, $s.State, $b)
    }
    Write-Output ''
    Write-Output 'Run again with the app''s site:  .\check-signin.ps1 -SiteName "<name from the list>"'
    exit 1
}

$sitePath = "IIS:\Sites\$SiteName"
$serverPath = 'MACHINE/WEBROOT/APPHOST'
$headerVariable = 'HTTP_' + ($UserHeader.ToUpper() -replace '-', '_')
$secretVariable = 'HTTP_X_PROXY_AUTH'
$authFilter = 'system.webServer/security/authentication'

# --- 1. The pieces are installed --------------------------------------------
Write-Output '1. Installed pieces'

Check 'Windows Authentication is installed' {
    $feature = Get-WindowsFeature -Name Web-Windows-Auth
    if ($feature.Installed) {
        Report 'OK' 'Windows Authentication is installed.'
    } else {
        Report 'FAIL' 'Windows Authentication is not installed.' 'Install-WindowsFeature Web-Windows-Auth'
    }
}

Check 'URL Rewrite and ARR are installed' {
    $modules = @(Get-WebGlobalModule | ForEach-Object { $_.Name })
    if ($modules -contains 'RewriteModule') {
        Report 'OK' 'URL Rewrite is installed.'
    } else {
        Report 'FAIL' 'URL Rewrite is not installed.' 'Install the IIS URL Rewrite module (Microsoft download).'
    }
    if ($modules -contains 'ApplicationRequestRouting') {
        Report 'OK' 'Application Request Routing (ARR) is installed.'
    } else {
        Report 'FAIL' 'Application Request Routing (ARR) is not installed.' 'Install ARR (Microsoft download).'
    }
}

Check 'ARR proxy is enabled' {
    $enabled = Get-ConfigValue $serverPath 'system.webServer/proxy' 'enabled'
    if ($enabled -eq $true) {
        Report 'OK' 'ARR proxy is enabled.'
    } else {
        Report 'FAIL' 'ARR proxy is switched off.' 'IIS Manager > server > Application Request Routing Cache > Server Proxy Settings > tick "Enable proxy".'
    }
}

# --- 2. The site signs people in with Windows --------------------------------
Write-Output ''
Write-Output "2. Sign-in switches on site '$SiteName'"

Check 'the site is started' {
    $b = @($site.bindings.Collection | ForEach-Object { "$($_.protocol) $($_.bindingInformation)" }) -join ', '
    if ($site.State -eq 'Started') {
        Report 'OK' "Site is started. Bindings: $b"
    } else {
        Report 'FAIL' "Site is $($site.State). Bindings: $b" 'Start the site in IIS Manager.'
    }
}

Check 'Anonymous Authentication is off' {
    $anonymous = Get-ConfigValue $sitePath "$authFilter/anonymousAuthentication" 'enabled'
    if ($anonymous -eq $false) {
        Report 'OK' 'Anonymous Authentication is disabled.'
    } else {
        Report 'FAIL' 'Anonymous Authentication is enabled, so nobody is asked to sign in.' 'IIS Manager > site > Authentication > Anonymous Authentication > Disable.'
    }
}

Check 'Windows Authentication is on' {
    $windows = Get-ConfigValue $sitePath "$authFilter/windowsAuthentication" 'enabled'
    if ($windows -eq $true) {
        Report 'OK' 'Windows Authentication is enabled.'
    } else {
        Report 'FAIL' 'Windows Authentication is disabled.' 'IIS Manager > site > Authentication > Windows Authentication > Enable.'
    }
}

Check 'kernel-mode authentication is on' {
    $kernel = Get-ConfigValue $sitePath "$authFilter/windowsAuthentication" 'useKernelMode'
    if ($kernel -eq $true) {
        Report 'OK' 'Kernel-mode authentication is on.'
    } else {
        Report 'FAIL' 'Kernel-mode authentication is off, so the user name reaches the app empty.' 'IIS Manager > site > Authentication > Windows Authentication > Advanced Settings > tick "Enable Kernel-mode authentication".'
    }
}

# --- 3. IIS may set the user header -------------------------------------------
Write-Output ''
Write-Output '3. Header variables IIS is allowed to set'

Check 'allowed server variables' {
    $allowed = @(Get-WebConfiguration -PSPath $sitePath -Filter 'system.webServer/rewrite/allowedServerVariables/add' | ForEach-Object { $_.name })
    if ($allowed -contains $headerVariable) {
        Report 'OK' "$headerVariable is allowed."
    } else {
        Report 'FAIL' "$headerVariable is not allowed, so IIS cannot pass the user name on." "IIS Manager > server > URL Rewrite > View Server Variables > Add $headerVariable."
    }
    if ($allowed -contains $secretVariable) {
        Report 'OK' "$secretVariable is allowed."
    } else {
        Report 'INFO' "$secretVariable is not allowed. Only needed if the shared secret is used."
    }
}

# --- 4. The site's web.config forwards to the app with the user name ----------
Write-Output ''
Write-Output '4. The forwarding rule (web.config in the site root)'

Check 'the forwarding rule' {
    $root = [Environment]::ExpandEnvironmentVariables([string]$site.physicalPath)
    $configPath = Join-Path $root 'web.config'
    if (-not (Test-Path -LiteralPath $configPath)) {
        Report 'FAIL' "No web.config in the site root ($root)." 'Copy deploy\iis\web.config into the site root, unchanged.'
        return
    }
    $config = New-Object System.Xml.XmlDocument
    $config.Load($configPath)

    if ($null -ne $config.SelectSingleNode('/configuration/system.webServer/security/authentication')) {
        Report 'WARN' 'web.config sets the sign-in switches itself. IIS normally locks these: error 500.19.'
    }

    $proxyRules = 0
    foreach ($rule in @($config.SelectNodes('/configuration/system.webServer/rewrite/rules/rule'))) {
        $action = $rule.SelectSingleNode('action')
        if ($null -eq $action) { continue }
        $target = [string]$action.GetAttribute('url')
        if ($target -notmatch '^https?://') { continue }
        $proxyRules++
        $ruleName = [string]$rule.GetAttribute('name')

        if ($target -match '^http://(127\.0\.0\.1|localhost|\[::1\]):(\d+)/') {
            if ([int]$Matches[2] -eq $BackendPort) {
                Report 'OK' "Rule '$ruleName' forwards to the app on this server, port $BackendPort."
            } else {
                Report 'WARN' "Rule '$ruleName' forwards to port $($Matches[2]), not $BackendPort. Rerun with -BackendPort $($Matches[2]) if that is the app."
            }
        } else {
            Report 'FAIL' "Rule '$ruleName' forwards to another address ($target), not to the app on this server." "Forward to http://127.0.0.1:$BackendPort/ as in deploy\iis\web.config."
        }

        $userSet = $null
        $secretSet = $null
        foreach ($set in @($rule.SelectNodes('serverVariables/set'))) {
            $setName = [string]$set.GetAttribute('name')
            if ($setName -eq $headerVariable) { $userSet = $set }
            if ($setName -eq $secretVariable) { $secretSet = $set }
        }
        if ($null -eq $userSet) {
            Report 'FAIL' "Rule '$ruleName' does not set $headerVariable, so the app never learns who is signed in." 'Use deploy\iis\web.config unchanged.'
        } else {
            $source = [string]$userSet.GetAttribute('value')
            if (@('{LOGON_USER}', '{REMOTE_USER}', '{AUTH_USER}') -contains $source.ToUpper()) {
                Report 'OK' "Rule '$ruleName' passes the signed-in user ($source) in $UserHeader."
            } else {
                Report 'FAIL' "Rule '$ruleName' sets $headerVariable from something other than the signed-in user." 'Set its value to {LOGON_USER}.'
            }
        }
        if ($null -ne $secretSet) {
            Report 'INFO' "Rule '$ruleName' sends the shared secret (value not shown). PROXY_SHARED_SECRET in backend\.env must match it."
        } else {
            Report 'INFO' "Rule '$ruleName' sends no shared secret. Optional; add it once sign-in works."
        }
    }
    if ($proxyRules -eq 0) {
        Report 'FAIL' 'web.config has no rule that forwards to the app.' 'Copy deploy\iis\web.config into the site root, unchanged.'
    }
}

# --- 5. The app itself is private ---------------------------------------------
Write-Output ''
Write-Output "5. The app on port $BackendPort"

Check 'what the app listens on' {
    $addresses = @(Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)
    if ($addresses.Count -eq 0) {
        Report 'FAIL' "Nothing is listening on port $BackendPort: the app is not running (or uses another port)." 'Start the app service, or rerun with -BackendPort.'
        return
    }
    $open = @($addresses | Where-Object { @('127.0.0.1', '::1') -notcontains $_ })
    if ($open.Count -eq 0) {
        Report 'OK' "The app listens on this server only ($($addresses -join ', '))."
    } else {
        Report 'FAIL' "The app listens on $($open -join ', '): other PCs can reach it and skip sign-in." 'Start the app with --host 127.0.0.1 (DS_HOST=127.0.0.1 for windows_service.py).'
    }
}

Check 'the firewall rule (this one can take a minute)' {
    $port = "$BackendPort"
    $filters = @(Get-NetFirewallPortFilter -Protocol TCP | Where-Object { @($_.LocalPort) -contains $port })
    $rules = @($filters | Get-NetFirewallRule | Where-Object { "$($_.Enabled)" -eq 'True' -and "$($_.Direction)" -eq 'Inbound' })
    $block = @($rules | Where-Object { "$($_.Action)" -eq 'Block' })
    $allow = @($rules | Where-Object { "$($_.Action)" -eq 'Allow' })
    if ($block.Count -gt 0) {
        Report 'OK' "A firewall rule blocks port $BackendPort from other PCs."
    } elseif ($allow.Count -gt 0) {
        Report 'FAIL' "A firewall rule ALLOWS port $BackendPort from other PCs ($(@($allow | ForEach-Object { $_.DisplayName }) -join ', '))." 'Remove that rule and add the block rule from step 5 of the handover page.'
    } else {
        Report 'WARN' "No firewall rule blocks port $BackendPort. It is the backup if the app is ever started open by mistake."
    }
}

Check 'the app answers' {
    $health = Invoke-Probe "http://127.0.0.1:$BackendPort/api/health"
    if ($health.Status -eq 200) {
        Report 'OK' 'The app answers on this server.'
    } else {
        Report 'FAIL' "The app answered $($health.Status) to a health check." 'Read the app log.'
    }
}

Check 'the app refuses a request with no user' {
    $direct = Invoke-Probe "http://127.0.0.1:$BackendPort/api/auth/me"
    if ($direct.Status -eq 401) {
        Report 'OK' 'The app refuses a request that carries no user name.'
    } elseif ($direct.Status -eq 200) {
        Report 'FAIL' 'The app lets in a request with no user name: it is running with sign-in switched off.' 'In backend\.env set ENVIRONMENT=production and DEV_MODE=false, then restart the app.'
    } else {
        Report 'WARN' "The app answered $($direct.Status) to a request with no user name (401 expected)."
    }
}

# --- 6. End to end, through IIS, with no credentials ---------------------------
Write-Output ''
Write-Output '6. Through IIS'

if (-not $Url) {
    $bindings = @($site.bindings.Collection | Where-Object { $_.protocol -eq 'http' -or $_.protocol -eq 'https' })
    $binding = $bindings | Where-Object { $_.protocol -eq 'http' } | Select-Object -First 1
    if ($null -eq $binding) { $binding = $bindings | Select-Object -First 1 }
    if ($null -ne $binding) {
        $parts = ([string]$binding.bindingInformation).Split(':')
        $hostName = $parts[-1]
        if (-not $hostName) { $hostName = 'localhost' }
        $Url = "$($binding.protocol)://${hostName}:$($parts[-2])"
    }
}

if (-not $Url) {
    Report 'WARN' 'The site has no http or https binding to test. Rerun with -Url.'
} else {
    Check "the site at $Url" {
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
        $probe = Invoke-Probe ($Url.TrimEnd('/') + '/api/auth/me')
        $asksWindows = $probe.Challenge -match 'Negotiate|NTLM'
        if ($probe.Status -eq 401 -and $asksWindows) {
            Report 'OK' "IIS asks for Windows sign-in at $Url before anything reaches the app."
        } elseif ($probe.Status -eq 401) {
            Report 'FAIL' "IIS at $Url passed the request on without asking for Windows sign-in; the app refused it." 'Section 2 above: Anonymous off, Windows Authentication on.'
        } elseif ($probe.Status -eq 200) {
            Report 'FAIL' "The site at $Url let in a request with no sign-in at all." 'Sections 2 and 5 above.'
        } elseif ($probe.Status -eq 502) {
            Report 'FAIL' "IIS at $Url could not reach the app (502)." 'Check the app is running and the rule forwards to its port.'
        } else {
            Report 'FAIL' "The site at $Url answered $($probe.Status) (401 with a Windows sign-in request expected)." '500 usually means section 3 or a locked section in web.config (500.19): see the IIS error page.'
        }
    }
}

# --- Result ----------------------------------------------------------------
Write-Output ''
if ($script:Fails -eq 0 -and $script:Warns -eq 0) {
    Write-Output 'RESULT: everything checked is OK.'
    Write-Output 'Last step, from a normal PC: open the site address followed by /api/auth/me.'
    Write-Output 'You should see your own name with no password prompt.'
} else {
    Write-Output ("RESULT: {0} to fix, {1} to look at." -f $script:Fails, $script:Warns)
}
Write-Output 'Please send this whole output back to the person who asked you to run it.'
