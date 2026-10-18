@echo off
REM Builds "AI Studio Pro" into a normal Windows program (no VS Code needed to run it).
REM Double-click this file. For a version that shows error messages, run:  build_exe.bat debug
cd /d "%~dp0"

set MODE=--windowed
if /I "%1"=="debug" set MODE=--console

echo Installing build tools...
python -m pip install --upgrade pyinstaller pillow
python -m pip install -r requirements.txt

REM Program icon: use assets\icon.ico if you have one, otherwise make it from assets\logo.png
if not exist assets\icon.ico python make_icon.py
set ICON=
if exist icon.ico set ICON=--icon icon.ico
if exist assets\icon.ico set ICON=--icon assets\icon.ico

echo Building (this takes a few minutes)...
python -m PyInstaller --noconfirm --clean %MODE% %ICON% --name "AI Studio Pro" --collect-all webview --collect-all pymupdf --collect-all docx --collect-submodules ddgs --collect-submodules keyring --collect-all spellchecker --copy-metadata pyspellchecker app-2.py
if errorlevel 1 goto :failed

REM The program looks for these files NEXT TO the .exe, so copy them there.
copy /Y index.html "dist\AI Studio Pro\index.html"
if exist assets xcopy /E /I /Y assets "dist\AI Studio Pro\assets"
if exist vendor xcopy /E /I /Y vendor "dist\AI Studio Pro\vendor"
if exist frontend xcopy /E /I /Y frontend "dist\AI Studio Pro\frontend"

REM Ask Windows to refresh its icon pictures so File Explorer shows the new icon
ie4uinit.exe -show

echo.
echo DONE. Your program is in:  dist\AI Studio Pro\AI Studio Pro.exe
echo If File Explorer still shows an old icon, run refresh_icon_cache.bat once.
pause
exit /b 0

:failed
echo.
echo The build failed. Copy the red/error text above and send it to me.
pause
exit /b 1
