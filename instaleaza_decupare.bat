@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==============================================
echo   Instalare decupare (tu fara fundal)
echo ==============================================
echo Se descarca aproximativ 250 MB: onnxruntime (pentru placa video NVIDIA) si modelul de decupare (15 MB).
echo Aplicatia merge si fara ea: pana atunci apari intr-o fereastra verticala.
echo.
echo Daca aplicatia e deschisa, inchide-o intai (butonul de pornire/oprire din dreapta sus).
pause
rem onnxruntime (varianta pentru procesor, venita odata cu transcrierea) si onnxruntime-gpu scriu in acelasi folder:
rem le scot pe amandoua si o pun curat pe cea pentru placa video (o poti rula oricand din nou, fara grija)
python -m pip uninstall -y onnxruntime onnxruntime-gpu >nul 2>nul
python -m pip install -r requirements-decupare.txt || (echo Instalarea a esuat. Trimite-i lui Claude un screenshot. & pause & exit /b)
echo.
echo Descarc modelul de decupare...
python -c "import cutout; cutout.download_model()" || (echo Descarcarea modelului a esuat. Verifica internetul si incearca din nou. & pause & exit /b)
echo.
echo ==============================================
echo   Gata! Inchide aplicatia (butonul de pornire/oprire din dreapta sus)
echo   si porneste-o din nou. In Timeline, la "Tu peste el", alege forma "Decupat".
echo ==============================================
pause
