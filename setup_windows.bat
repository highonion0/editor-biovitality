@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==============================================
echo   Setup BioVitality Editor
echo ==============================================
where python >nul 2>nul || (echo Nu am gasit Python. Instaleaza-l de pe python.org si bifeaza "Add python.exe to PATH". & pause & exit /b)
where ffmpeg >nul 2>nul || (
  echo Instalez ffmpeg...
  winget install --id Gyan.FFmpeg -e --source winget --accept-source-agreements --accept-package-agreements || (echo Nu am reusit automat. Instaleaza ffmpeg de pe ffmpeg.org. & pause & exit /b)
)
echo.
echo Instalez componentele...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt || (echo Instalarea a esuat. Trimite-i lui Claude un screenshot. & pause & exit /b)
echo.
echo Creez scurtatura pe Desktop...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'BioVitality Editor.lnk')); $s.TargetPath='%~dp0Porneste BioVitality Editor.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.IconLocation='%SystemRoot%\System32\imageres.dll,18'; $s.Save()"
echo.
echo ==============================================
echo   Gata! Pe Desktop ai scurtatura "BioVitality Editor".
echo   Optional: ruleaza instaleaza_gpu.bat pentru placa NVIDIA.
echo ==============================================
pause
