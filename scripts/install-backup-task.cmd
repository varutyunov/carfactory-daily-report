@echo off
REM One-time setup: registers a Windows Task Scheduler entry that runs
REM scripts\backup-to-drive.cmd every day at 8:00 PM under the current user.
REM
REM Run this script ONCE as the user who logs into this machine.
REM Re-running is safe — it overwrites the existing task.

set TASK_NAME=CarFactoryDailyBackup
set SCRIPT_PATH=%~dp0backup-to-drive.cmd

echo Registering Task Scheduler entry "%TASK_NAME%" to run daily at 20:00...
schtasks /Create ^
  /TN "%TASK_NAME%" ^
  /TR "\"%SCRIPT_PATH%\"" ^
  /SC DAILY ^
  /ST 20:00 ^
  /RL LIMITED ^
  /F

if %ERRORLEVEL% NEQ 0 (
  echo Failed to register task. You may need to run this from an
  echo elevated Command Prompt.
  exit /b %ERRORLEVEL%
)

echo.
echo Done. The backup will run nightly at 8:00 PM.
echo To run it now: schtasks /Run /TN "%TASK_NAME%"
echo To remove:    schtasks /Delete /TN "%TASK_NAME%" /F
