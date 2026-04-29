@echo off
REM Daily backup of the Car Factory project to Google Drive.
REM Invoked by Windows Task Scheduler at 8:00 PM. To install the scheduled
REM task, run scripts/install-backup-task.cmd ONCE as the same user.
REM
REM Logs to backup-to-drive.log in the project root so any failure is
REM visible without having to dig through Task Scheduler history.

cd /d "%~dp0\.."
echo. >> backup-to-drive.log
echo === Backup run %DATE% %TIME% === >> backup-to-drive.log
python scripts\backup-to-drive.py >> backup-to-drive.log 2>&1
exit /b %ERRORLEVEL%
