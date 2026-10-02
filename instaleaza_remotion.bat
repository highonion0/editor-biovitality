@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==============================================
echo   Instalare motor Remotion
echo ==============================================
echo Se descarca aproximativ 300 MB: Node.js, Remotion si un browser de randare.
echo Aplicatia merge cu motorul clasic intre timp.
echo.
where node >nul 2>nul
if not errorlevel 1 goto have_node
echo Instalez Node.js...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if not errorlevel 1 goto have_node
echo Node.js s-a instalat, dar Windows are nevoie de o fereastra noua.
echo Inchide aceasta fereastra si ruleaza din nou instaleaza_remotion.bat.
pause
exit /b

:have_node
cd remotion
echo.
echo Instalez Remotion...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail
echo.
echo Pregatesc motorul: browser de randare si pachet...
node render.mjs --prepare
if errorlevel 1 goto fail
echo.
echo ==============================================
echo   Gata! Inchide aplicatia din butonul de pornire/oprire din dreapta sus
echo   si porneste-o din nou. Sus trebuie sa scrie "Motor Remotion".
echo ==============================================
pause
exit /b

:fail
echo.
echo Instalarea nu s-a terminat. Trimite-i lui Claude un screenshot cu fereastra asta.
pause
