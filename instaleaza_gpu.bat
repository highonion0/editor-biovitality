@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==============================================
echo   Activare placa video NVIDIA
echo ==============================================
echo Se descarca aproximativ 1,2 GB de librarii NVIDIA.
echo Poate dura, in functie de internet. Aplicatia merge pe procesor intre timp.
echo.
python -m pip install -r requirements-gpu.txt || (echo Instalarea a esuat. Trimite-i lui Claude un screenshot. & pause & exit /b)
echo.
echo ==============================================
echo   Gata! Inchide aplicatia (butonul de pornire/oprire din dreapta sus)
echo   si porneste-o din nou. Sus trebuie sa scrie "GPU - RTX 4070".
echo ==============================================
pause
