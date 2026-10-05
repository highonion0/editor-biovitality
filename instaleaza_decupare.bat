@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==============================================
echo   Instalare decupare (tu fara fundal)
echo ==============================================
echo Se descarca aproximativ 250 MB: onnxruntime (pentru placa video NVIDIA) si modelul de decupare (15 MB).
echo Aplicatia merge si fara ea: pana atunci apari intr-o fereastra verticala.
echo.
python -m pip install -r requirements-decupare.txt || (echo Instalarea a esuat. Trimite-i lui Claude un screenshot. & pause & exit /b)
echo.
echo Descarc modelul de decupare...
python -c "import cutout; cutout.download_model()" || (echo Descarcarea modelului a esuat. Verifica internetul si incearca din nou. & pause & exit /b)
echo.
echo ==============================================
echo   Gata! Inchide aplicatia (butonul de pornire/oprire din dreapta sus)
echo   si porneste-o din nou. In Timeline, la „Tu peste el”, alege forma „✂ Decupat”.
echo ==============================================
pause
