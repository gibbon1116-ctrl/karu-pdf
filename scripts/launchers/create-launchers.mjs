// Generate ASCII-only cmd sources. No .ps1 file or execution-policy change.
const chars = text => `(-join [char[]](${[...text].map(c => c.charCodeAt(0)).join(',')}))`
const common = `
$ErrorActionPreference='Stop';
$dry=$env:KARU_LAUNCHER_DRY_RUN -eq '1';
if($dry) { [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false) };
$title=${chars('かるPDF')};
function Notice($message) { if($dry) { @{error=$message} | ConvertTo-Json -Compress } else { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($message,$title) | Out-Null } };
try {
$folder=$env:KARU_LAUNCHER_DIR;
$html=Get-ChildItem -LiteralPath $folder -File | Where-Object { $_.Name -match '^karu-pdf-v(\\d+\\.\\d+\\.\\d+)\\.html$' } | Sort-Object @{Expression={ [version]($_.Name -replace '^karu-pdf-v|\\.html$','') };Descending=$true} | Select-Object -First 1;
if(!$html) { Notice ${chars('HTML ファイルが見つかりません。ZIP をすべて展開し、起動用のファイルと同じフォルダに置いてください。')}; exit 1 };
$url=([System.Uri]$html.FullName).AbsoluteUri;
$browser=$null;
foreach($exe in @('msedge.exe','chrome.exe')) {
foreach($hive in @('HKCU','HKLM')) {
$key=Get-Item -LiteralPath ($hive+':\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\'+$exe) -ErrorAction SilentlyContinue;
if($key) { $candidate=([string]$key.GetValue('')).Trim([char]34); if($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { $browser=$candidate; break } }
};
if(!$browser) {
$relative=if($exe -eq 'msedge.exe') { 'Microsoft\\Edge\\Application\\msedge.exe' } else { 'Google\\Chrome\\Application\\chrome.exe' };
foreach($base in @(\${env:ProgramFiles(x86)},$env:ProgramFiles,$env:LOCALAPPDATA)) { if($base) { $candidate=Join-Path $base $relative; if(Test-Path -LiteralPath $candidate -PathType Leaf) { $browser=$candidate; break } } }
};
if($browser) { break }
};
if(!$browser) { Notice ${chars('Microsoft Edge または Google Chrome が見つかりません。ブラウザをインストールしてから、もう一度実行してください。')}; exit 1 };
$arguments='--app='+[char]34+$url+[char]34;
`
// Keep paths in an environment variable: never interpolate user paths into code.
function cmd(action) {
  const ps = (common + action + `
} catch { Notice (${chars('起動用の処理を完了できませんでした。フォルダと実行権限を確認してください。')}+[Environment]::NewLine+$_.Exception.Message); exit 1 }
`).trim().split('\n').map(s => s.trim()).join(' ')
  const invocation = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "${ps}"`
  // Run synchronously in dry-run mode and preserve PowerShell's exit code.
  // A parenthesized cmd block would expand %errorlevel% before PowerShell runs.
  return Buffer.from(`@echo off\r\nsetlocal\r\nset "KARU_LAUNCHER_DIR=%~dp0"\r\nif "%KARU_LAUNCHER_DRY_RUN%"=="1" goto dry_run\r\nstart "" /min ${invocation}\r\nexit /b\r\n:dry_run\r\n${invocation}\r\nexit /b %errorlevel%\r\n`, 'ascii')
}
export function createLaunchers() {
  return new Map([
    ['かるPDFを開く.cmd', cmd(`
if($dry) { @{browser=$browser;url=$url;arguments=$arguments;workingDirectory=$folder} | ConvertTo-Json -Compress; exit 0 };
Start-Process -FilePath $browser -ArgumentList $arguments
`)],
    ['デスクトップにショートカットを作る.cmd', cmd(`
$icon=Join-Path $folder 'karu-pdf.ico';
$description=${chars('かるPDF（固定・閉域版）')};
$shortcuts=@([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs')) | ForEach-Object { @{path=(Join-Path $_ ($title+'.lnk'));target=$browser;arguments=$arguments;workingDirectory=$folder;icon=$icon;description=$description} };
if($dry) { @{browser=$browser;url=$url;arguments=$arguments;shortcuts=@($shortcuts)} | ConvertTo-Json -Depth 4 -Compress; exit 0 };
$shell=New-Object -ComObject WScript.Shell;
foreach($item in $shortcuts) { $link=$shell.CreateShortcut($item.path); $link.TargetPath=$item.target; $link.Arguments=$item.arguments; $link.WorkingDirectory=$item.workingDirectory; $link.IconLocation=$item.icon; $link.Description=$item.description; $link.Save() };
Notice (${chars('ショートカットを作りました。')}+[Environment]::NewLine+($shortcuts.path -join [Environment]::NewLine))
`)],
  ])
}
