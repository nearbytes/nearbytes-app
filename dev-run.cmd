@echo off
setlocal

set "REPO_ROOT=%~dp0"
if "%REPO_ROOT:~0,4%"=="\\?\" set "REPO_ROOT=%REPO_ROOT:~4%"

pushd "%REPO_ROOT%" >nul
if errorlevel 1 (
  echo Failed to enter repository root: %REPO_ROOT%
  exit /b 1
)

node ".\scripts\run-dev.mjs" %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul
exit /b %EXIT_CODE%
