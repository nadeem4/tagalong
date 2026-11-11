; Stops a running Scout brain before the installer replaces or removes its files, so an update
; never meets a brain still holding them. The brain writes "<pid> <start time>" to brain.pid in
; its data folder (TAGALONG_HOME, else %USERPROFILE%\.tagalong); a missing file means no brain.
; Pids are reused, so taskkill only matches a Python process: a stale file never ends a stranger.

!macro tagalongStopBrain id
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
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
