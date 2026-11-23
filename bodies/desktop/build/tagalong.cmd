@echo off
rem Starts the bundled brain's tagalong command. The installer puts this folder on the user PATH.
rem The environment is the one the desktop gives the brain (see packagedEnv in launch.ts).
setlocal
set "TG_HOME=%TAGALONG_HOME%"
if "%TG_HOME%"=="" set "TG_HOME=%USERPROFILE%\.tagalong"
set "UV_PROJECT_ENVIRONMENT=%TG_HOME%\runtime\venv"
set "UV_PYTHON_INSTALL_DIR=%TG_HOME%\runtime\python"
set "UV_CACHE_DIR=%TG_HOME%\cache\uv"
set "UV_PYTHON_PREFERENCE=only-managed"
"%~dp0resources\uv\uv.exe" run --no-sync --project "%~dp0resources\brain" tagalong %*
exit /b %ERRORLEVEL%
