; samoffice_installer.nsi - NSIS installer script for SamOffice
; Build: makensis samoffice_installer.nsi
; Output: samoffice-setup-0.1.0.exe
; Requires: NSIS 3.x (https://nsis.sourceforge.io/)

!define APP_NAME "SamOffice"
!define APP_NAME_ZH "SamOffice Suite"
!define APP_VERSION "0.1.0"
!define APP_PUBLISHER "SamOffice Team"
!define APP_URL "https://github.com/samaidev/samoffice"
!define APP_REGKEY "Software\SamOffice"
!define APP_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SamOffice"

Unicode true
ManifestDPIAware true

Name "${APP_NAME} ${APP_VERSION}"
OutFile "samoffice-setup-${APP_VERSION}.exe"
InstallDir "$PROGRAMFILES64\SamOffice"
InstallDirRegKey HKLM "${APP_REGKEY}" "InstallDir"
RequestExecutionLevel admin
ShowInstDetails show
ShowUnInstDetails show

; === Version Info ===
VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME_ZH} Installer"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "MIT License"

; === Modern UI ===
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define MUI_ABORTWARNING

; Welcome page
!insertmacro MUI_PAGE_WELCOME
; License page
!insertmacro MUI_PAGE_LICENSE "stage\LICENSE.txt"
; Components page
!insertmacro MUI_PAGE_COMPONENTS
; Directory page
!insertmacro MUI_PAGE_DIRECTORY
; Install files page
!insertmacro MUI_PAGE_INSTFILES
; Finish page (with option to start app)
!define MUI_FINISHPAGE_RUN "$INSTDIR\samoffice.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start SamOffice now"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "View README"
!define MUI_FINISHPAGE_LINK "Visit project homepage"
!define MUI_FINISHPAGE_LINK_LOCATION "${APP_URL}"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; Languages
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; === Sections ===

Section "SamOffice Desktop (GUI)" SecDesktop
    SectionIn RO ; Required
    SetOutPath "$INSTDIR"

    ; Main executable (renamed from gooffice.exe)
    File "stage\samoffice.exe"
    File "stage\README.txt"
    File "stage\LICENSE.txt"

    ; Registry entries
    WriteRegStr HKLM "${APP_REGKEY}" "InstallDir" "$INSTDIR"
    WriteRegStr HKLM "${APP_REGKEY}" "Version" "${APP_VERSION}"
    WriteRegStr HKLM "${APP_UNINSTKEY}" "DisplayName" "${APP_NAME_ZH}"
    WriteRegStr HKLM "${APP_UNINSTKEY}" "DisplayVersion" "${APP_VERSION}"
    WriteRegStr HKLM "${APP_UNINSTKEY}" "Publisher" "${APP_PUBLISHER}"
    WriteRegStr HKLM "${APP_UNINSTKEY}" "DisplayIcon" "$INSTDIR\samoffice.exe"
    WriteRegStr HKLM "${APP_UNINSTKEY}" "URLInfoAbout" "${APP_URL}"
    WriteRegStr HKLM "${APP_UNINSTKEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKLM "${APP_UNINSTKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
    WriteRegDWORD HKLM "${APP_UNINSTKEY}" "NoModify" 1
    WriteRegDWORD HKLM "${APP_UNINSTKEY}" "NoRepair" 1

    ; 文件关联：双击 / 右键"打开方式" 用 SamOffice 打开 Office 文档
    !define PROGID "SamOffice.File"
    WriteRegStr HKLM "Software\Classes\${PROGID}" "" "SamOffice Document"
    WriteRegStr HKLM "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\samoffice.exe,0"
    WriteRegStr HKLM "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\samoffice.exe" "%1"'
    WriteRegStr HKLM "Software\Classes\.docx" "" "${PROGID}"
    WriteRegStr HKLM "Software\Classes\.doc"  "" "${PROGID}"
    WriteRegStr HKLM "Software\Classes\.xlsx" "" "${PROGID}"
    WriteRegStr HKLM "Software\Classes\.pptx" "" "${PROGID}"
    WriteRegStr HKLM "Software\Classes\.pdf"  "" "${PROGID}"
    WriteRegStr HKLM "Software\Classes\.md"   "" "${PROGID}"

    ; Uninstaller
    WriteUninstaller "$INSTDIR\uninstall.exe"

    ; Start menu shortcuts
    CreateDirectory "$SMPROGRAMS\SamOffice"
    CreateShortcut "$SMPROGRAMS\SamOffice\SamOffice.lnk" "$INSTDIR\samoffice.exe"
    CreateShortcut "$SMPROGRAMS\SamOffice\Uninstall SamOffice.lnk" "$INSTDIR\uninstall.exe"
SectionEnd

Section "SamOffice Server (HTTP)" SecServer
    SetOutPath "$INSTDIR"
    ; Server executable (renamed from gooffice-server.exe)
    File "stage\samoffice-server.exe"

    ; Start menu shortcut for server
    CreateShortcut "$SMPROGRAMS\SamOffice\SamOffice Server.lnk" "$INSTDIR\samoffice-server.exe" "--addr 127.0.0.1:8080"
SectionEnd

Section "Create Desktop Shortcut" SecDesktop2
    CreateShortcut "$DESKTOP\SamOffice.lnk" "$INSTDIR\samoffice.exe"
SectionEnd

; === Section Descriptions ===
LangString DESC_SecDesktop ${LANG_SIMPCHINESE} "SamOffice 桌面应用（必装）"
LangString DESC_SecServer ${LANG_SIMPCHINESE} "HTTP 服务模式，浏览器访问"
LangString DESC_SecDesktop2 ${LANG_SIMPCHINESE} "在桌面创建快捷方式"

LangString DESC_SecDesktop ${LANG_ENGLISH} "SamOffice desktop application (required)"
LangString DESC_SecServer ${LANG_ENGLISH} "HTTP server mode, access via browser"
LangString DESC_SecDesktop2 ${LANG_ENGLISH} "Create a desktop shortcut"

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
!insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_SecDesktop)
!insertmacro MUI_DESCRIPTION_TEXT ${SecServer} $(DESC_SecServer)
!insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop2} $(DESC_SecDesktop2)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; === Uninstall ===
Section "Uninstall"
    ; Stop running instances
    ExecWait 'taskkill /IM samoffice.exe /F'
    ExecWait 'taskkill /IM samoffice-server.exe /F'

    ; Delete files
    Delete "$INSTDIR\samoffice.exe"
    Delete "$INSTDIR\samoffice-server.exe"
    Delete "$INSTDIR\README.txt"
    Delete "$INSTDIR\LICENSE.txt"
    Delete "$INSTDIR\uninstall.exe"
    ; 清理文件关联（仅删除我们写入的值）
    !define PROGID "SamOffice.File"
    DeleteRegKey HKLM "Software\Classes\${PROGID}"
    DeleteRegValue HKLM "Software\Classes\.docx" ""
    DeleteRegValue HKLM "Software\Classes\.doc"  ""
    DeleteRegValue HKLM "Software\Classes\.xlsx" ""
    DeleteRegValue HKLM "Software\Classes\.pptx" ""
    DeleteRegValue HKLM "Software\Classes\.pdf"  ""
    DeleteRegValue HKLM "Software\Classes\.md"   ""
    RMDir /r "$INSTDIR"

    ; Delete shortcuts
    RMDir /r "$SMPROGRAMS\SamOffice"
    Delete "$DESKTOP\SamOffice.lnk"

    ; Clean registry
    DeleteRegKey HKLM "${APP_UNINSTKEY}"
    DeleteRegKey HKLM "${APP_REGKEY}"

    DetailPrint "SamOffice has been completely uninstalled"
SectionEnd

; === Check admin privileges ===
Function .onInit
    ${IfNot} ${RunningX64}
        MessageBox MB_OK|MB_ICONSTOP "SamOffice requires 64-bit Windows."
        Abort
    ${EndIf}
FunctionEnd
