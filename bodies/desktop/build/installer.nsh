; Stops a running Scout brain before the installer replaces or removes its files, so an update
; never meets a brain still holding them. The brain writes "<pid> <start time>" to brain.pid in
; its data folder (TAGALONG_HOME, else %USERPROFILE%\.tagalong); a missing file means no brain.
; Pids are reused, so taskkill only matches a Python process: a stale file never ends a stranger.
; The brain service (`tagalong service install`, a scheduled task named TagalongBrain) is
; ended first, or its restart-on-failure would bring the brain back. The desktop starts the
; service again after it syncs the new files, so the installer never does.

!macro tagalongStopBrain id
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  nsExec::Exec 'schtasks /End /TN "TagalongBrain"'
  Pop $0
  ReadEnvStr $0 "TAGALONG_HOME"
  StrCmp $0 "" 0 +2
  StrCpy $0 "$PROFILE\.tagalong"
  ClearErrors
  FileOpen $1 "$0\brain.pid" r
  IfErrors tagalongDone_${id}
  FileRead $1 $2
  FileClose $1
  ; Keep the first token: the characters before the first space or line break.
  StrCpy $3 ""
  StrCpy $4 0
  tagalongNext_${id}:
    StrCpy $0 $2 1 $4
    StrCmp $0 "" tagalongKill_${id}
    StrCmp $0 " " tagalongKill_${id}
    StrCmp $0 "$\r" tagalongKill_${id}
    StrCmp $0 "$\n" tagalongKill_${id}
    StrCpy $3 "$3$0"
    IntOp $4 $4 + 1
    Goto tagalongNext_${id}
  tagalongKill_${id}:
  StrCmp $3 "" tagalongDone_${id}
  nsExec::Exec 'taskkill /PID $3 /T /F /FI "IMAGENAME eq python*"'
  Pop $0
  tagalongDone_${id}:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customInit
  !insertmacro tagalongStopBrain install
!macroend

!macro customUnInit
  !insertmacro tagalongStopBrain uninstall
!macroend



; `tagalong` on the user's own PATH (HKCU, no admin), so an AI tool can start the memory bridge.
; The folder reaches PowerShell through the environment, never inside its script text, so an
; apostrophe in the path is harmless. The value is read unexpanded and written back as
; REG_EXPAND_SZ so entries such as %USERPROFILE%\bin survive. Terminals opened before the
; install need reopening.
!macro tagalongUserPath op
  System::Call 'Kernel32::SetEnvironmentVariable(t "TAGALONG_DIR", t "$INSTDIR")'
  System::Call 'Kernel32::SetEnvironmentVariable(t "TAGALONG_PATH_OP", t "${op}")'
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "$$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$$true); $$p=[string]$$k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $$d=$$env:TAGALONG_DIR; $$r=@($$p -split ';' | Where-Object { $$_ -and $$_ -ne $$d }); if($$env:TAGALONG_PATH_OP -eq 'add'){ $$r+=$$d }; $$k.SetValue('Path',($$r -join ';'),[Microsoft.Win32.RegistryValueKind]::ExpandString)"`
  Pop $0
  ; A registry write does not tell running programs; this broadcast does, so new windows see it.
  System::Call 'user32::SendMessageTimeoutW(i 0xffff, i 0x1A, i 0, t "Environment", i 2, i 5000, *i .r0)'
!macroend

!macro customInstall
  !insertmacro tagalongUserPath add
!macroend

!macro customUnInstall
  nsExec::Exec 'schtasks /Delete /TN "TagalongBrain" /F'
  Pop $0
  !insertmacro tagalongUserPath remove
!macroend
