; SamOffice 安装包脚本（Inno Setup 6.3+ / 7.x）
; 版本号可由 CI 注入：iscc /DMyAppVersion=0.5.0 packaging/windows/SamOffice.iss
; 未注入时使用默认值。路径全部相对仓库根，本地/CI 通用。
; 安装界面支持英文/简体中文；默认安装到用户目录，装完创建桌面快捷方式
;
; 首页双语（对齐用户要求）：跳过 Inno 内建语言选择对话框（单语言），
; 直接在欢迎页（安装引导首页）同时呈现中英文案 + 语言单选钮；
; 选定语言后若与当前语言不同，则以 /LANG 重启安装程序，其余页面均为单一语言。
; 注意：本文件含中文字符串字面量，必须保存为 UTF-8 with BOM（ISCC 按 BOM 识别编码）。
#ifndef MyAppVersion
#define MyAppVersion "0.5.0"
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
; 文件关联变化通知资源管理器刷新图标与“打开方式”缓存
ChangesAssociations=yes
; 首页双语：不弹内建语言对话框（其标题/按钮只有单一语言），语言选择并入双语欢迎页
ShowLanguageDialog=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinese"; MessagesFile: "{#CnMessages}"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
; 文件关联（默认勾选）：注册为各类文档的“打开方式”候选（不改默认程序）。
; 仅覆盖应用实际支持的格式（docx/doc/xlsx/xls/csv/pptx/ppt/md/txt/pdf）。
Name: "fileassoc"; Description: "Associate document types (Open with list)"; GroupDescription: "File association:"
Name: "fileassoc\word"; Description: "Word — .docx .doc"; Flags: checkablealone
Name: "fileassoc\excel"; Description: "Excel — .xlsx .xls .csv"; Flags: checkablealone
Name: "fileassoc\ppt"; Description: "PowerPoint — .pptx .ppt"; Flags: checkablealone
Name: "fileassoc\other"; Description: "Text/Markdown/PDF/HTML — .md .markdown .txt .pdf .html"; Flags: checkablealone

[Files]
; exe 由 CI 在仓库根构建（samoffice.exe），路径相对 .iss 所在目录
Source: "..\..\samoffice.exe"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
; === 文件关联（每用户 HKCU；卸载自动清除） ===
; 1) SamOffice.Document ProgID：应用标识 + 打开命令 + 图标 + 友好名（“打开方式”菜单显示）。
;    DefaultIcon 索引 0 指向 exe 内嵌图标组（与主窗口一致，7 尺寸 16~256）。
Root: HKCU; Subkey: "Software\Classes\SamOffice.Document"; ValueType: string; ValueName: ""; ValueData: "SamOffice Document"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\SamOffice.Document\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExeName},0"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\SamOffice.Document\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Flags: uninsdeletekey
; 2) 各扩展名：写 OpenWithProgids（加入“打开方式”列表，不改默认程序 ——
;    不强抢用户已装的 Word/Excel 默认关联）。uninsdeletevalue 只删我们写的值，
;    uninsdeletekeyifempty 顺带清掉空键。
; Word 类
Root: HKCU; Subkey: "Software\Classes\.docx\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\word
Root: HKCU; Subkey: "Software\Classes\.doc\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\word
; Excel 类
Root: HKCU; Subkey: "Software\Classes\.xlsx\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\excel
Root: HKCU; Subkey: "Software\Classes\.xls\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\excel
Root: HKCU; Subkey: "Software\Classes\.csv\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\excel
; PPT 类
Root: HKCU; Subkey: "Software\Classes\.pptx\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\ppt
Root: HKCU; Subkey: "Software\Classes\.ppt\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\ppt
; 文本/Markdown/PDF/HTML
Root: HKCU; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\other
Root: HKCU; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\other
Root: HKCU; Subkey: "Software\Classes\.txt\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\other
Root: HKCU; Subkey: "Software\Classes\.pdf\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\other
Root: HKCU; Subkey: "Software\Classes\.html\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\other
Root: HKCU; Subkey: "Software\Classes\.htm\OpenWithProgids"; ValueType: string; ValueName: "SamOffice.Document"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: fileassoc\other
; 3) “始终显示 SamOffice”（UserChoice 免手动：注册候选后 Windows 会在
;    “选择默认应用”里列出；不直接写 UserChoice —— Win10/11 有校验哈希，写错反而失效）。
;    Applications 条目让“打开方式 → 选择其他应用”里始终能找到 SamOffice：
Root: HKCU; Subkey: "Software\Classes\Applications\{#MyAppExeName}"; ValueType: string; ValueName: ""; ValueData: "SamOffice"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Applications\{#MyAppExeName}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Flags: uninsdeletekey

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

[Code]
var
  RadioEn, RadioCn: TNewRadioButton;
  SuppressExitConfirm: Boolean;

// 双语欢迎标题/正文 + 语言单选钮（首页唯一会出现双语的页面，选定语言后其余页面单语言）
procedure InitializeWizard();
begin
  WizardForm.WelcomeLabel1.WordWrap := True;
  WizardForm.WelcomeLabel1.AutoSize := False;
  WizardForm.WelcomeLabel1.Height := ScaleY(56);
  WizardForm.WelcomeLabel1.Caption :=
    'Welcome to the SamOffice Setup Wizard' + #13#10 +
    '欢迎安装 SamOffice 向导';
  WizardForm.WelcomeLabel2.WordWrap := True;
  WizardForm.WelcomeLabel2.Caption :=
    'This wizard will install SamOffice {#MyAppVersion} on your computer.' + #13#10 +
    'It is recommended that you close all other applications before continuing. ' +
    'Click Next to continue, or Cancel to exit Setup.' + #13#10#13#10 +
    '安装向导将在您的电脑上安装 SamOffice {#MyAppVersion}。' + #13#10 +
    '建议在继续之前关闭所有其他程序。点击下一步继续，或点击取消退出安装。';

  RadioEn := TNewRadioButton.Create(WizardForm);
  RadioEn.Parent := WizardForm.WelcomePage;
  RadioEn.Left := WizardForm.WelcomeLabel2.Left;
  RadioEn.Width := ScaleX(280);
  RadioEn.Top := WizardForm.WelcomePage.ClientHeight - ScaleY(84);
  RadioEn.Caption := 'English';
  RadioEn.Checked := (ActiveLanguage = 'english');

  RadioCn := TNewRadioButton.Create(WizardForm);
  RadioCn.Parent := WizardForm.WelcomePage;
  RadioCn.Left := RadioEn.Left;
  RadioCn.Width := RadioEn.Width;
  RadioCn.Top := RadioEn.Top + RadioEn.Height + ScaleY(8);
  RadioCn.Caption := '简体中文 (Simplified Chinese)';
  RadioCn.Checked := (ActiveLanguage = 'chinese');

  // 首页按钮双语（离开首页后由 CurPageChanged 恢复单语言）
  WizardForm.NextButton.Caption := 'Next >  下一步 >';
  WizardForm.NextButton.Width := ScaleX(150);
  WizardForm.CancelButton.Caption := 'Cancel  取消';
  WizardForm.CancelButton.Width := ScaleX(120);
end;

// 离开首页后恢复当前语言的单一语言按钮标题
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID <> wpWelcome then
  begin
    WizardForm.NextButton.Caption := SetupMessage(msgButtonNext);
    WizardForm.NextButton.Width := WizardForm.BackButton.Width;
    WizardForm.CancelButton.Caption := SetupMessage(msgButtonCancel);
    WizardForm.CancelButton.Width := WizardForm.BackButton.Width;
  end;
end;

// 用户点了 Cancel：重启流程需要无确认直接关闭（Confirm=False 跳过"退出安装?"确认框）
procedure CancelButtonClick(CurPageID: Integer; var Cancel, Confirm: Boolean);
begin
  if SuppressExitConfirm then
  begin
    Confirm := False;
    SuppressExitConfirm := False;
  end;
end;

// 首页点"下一步"：所选语言与当前语言不同 → 以 /LANG 重启安装程序（其余页面即为该单一语言）
function NextButtonClick(CurPageID: Integer): Boolean;
var
  Chosen, Params: String;
  R: Integer;
begin
  Result := True;
  if CurPageID = wpWelcome then
  begin
    if RadioCn.Checked then Chosen := 'chinese' else Chosen := 'english';
    if Chosen <> ActiveLanguage then
    begin
      Params := '/LANG=' + Chosen;
      SuppressExitConfirm := True;
      Exec(ExpandConstant('{srcexe}'), Params, ExpandConstant('{src}'), SW_SHOW, ewNoWait, R);
      Result := False;
      WizardForm.Close;
    end;
  end;
end;
