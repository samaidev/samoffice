; SamOffice 安装包脚本（Inno Setup 6.3+ / 7.x）
; 版本号可由 CI 注入：iscc /DMyAppVersion=0.5.0 packaging/windows/SamOffice.iss
; 未注入时使用默认值。路径全部相对仓库根，本地/CI 通用。
; 安装界面支持英文/简体中文；默认安装到用户目录，装完创建桌面快捷方式
#ifndef MyAppVersion
#define MyAppVersion "0.6.0"
#endif
; 中文语言文件路径可由 CI 注入（runner 预装的 Inno 可能缺 ChineseSimplified.isl）
#ifndef CnMessages
#define CnMessages compiler:Languages\ChineseSimplified.isl
#endif
#define MyAppName "SamOffice"
#define MyAppExeName "samoffice.exe"

[Setup]
AppId={{8E7B6C3A-5D2E-4A9F-9B34-2C9F6A1D5E77}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
DefaultDirName={localappdata}\Programs\SamOffice
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=SamOffice-setup-{#MyAppVersion}
SetupIconFile=..\..\build\windows\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinese"; MessagesFile: "{#CnMessages}"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; exe 由 CI 在仓库根构建（samoffice.exe），路径相对 .iss 所在目录
Source: "..\..\samoffice.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autoprograms}\{#MyAppName}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autoprograms}\{#MyAppName}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 卸载时清理运行产生的用户数据目录（保留文档，用户数据在 文档/SamOffice 由应用管理）
Type: files; Name: "{app}\*.log"
