@echo off
cd /d "%~dp0"
where pythonw >nul 2>nul
if %errorlevel%==0 (
  start "" pythonw "%~dp0app.py"
) else (
  start "BioVitality Editor" python "%~dp0app.py"
)
