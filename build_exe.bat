@echo off
setlocal
REM Usage: build_exe.bat [debug] [piper]
cd /d "%~dp0"
set "MODE=--windowed"
set "VOICE_FLAGS=--exclude-module piper"
set "WITH_PIPER=0"
for %%A in (%*) do (
  if /I not "%%A"=="debug" if /I not "%%A"=="piper" goto :usage
  if /I "%%A"=="debug" set "MODE=--console"
  if /I "%%A"=="piper" set "WITH_PIPER=1"
)
python -m pip install --upgrade pyinstaller pillow
if errorlevel 1 goto :failed
python -m pip install -r requirements.txt
if errorlevel 1 goto :failed
if "%WITH_PIPER%"=="1" (
  echo Building with optional Piper. Review its license and third-party notices before distribution.
  python -m pip install -r requirements-voices.txt
  if errorlevel 1 goto :failed
  python -c "from piper import PiperVoice; import onnxruntime"
  if errorlevel 1 goto :failed
  set "VOICE_FLAGS=--collect-all piper --collect-all onnxruntime --copy-metadata piper-tts"
)
if not exist assets\icon.ico if exist assets\logo.png python make_icon.py
set "ICON="
if exist icon.ico set "ICON=--icon icon.ico"
if exist assets\icon.ico set "ICON=--icon assets\icon.ico"
python -m PyInstaller --noconfirm --clean %MODE% %ICON% %VOICE_FLAGS% --name "AI Studio Pro" --collect-all webview --collect-all pymupdf --collect-all docx --collect-submodules ddgs --collect-submodules keyring --collect-all spellchecker --copy-metadata pyspellchecker app-2.py
if errorlevel 1 goto :failed
copy /Y index.html "dist\AI Studio Pro\index.html"
if errorlevel 1 goto :failed
if exist assets (
  xcopy /E /I /Y assets "dist\AI Studio Pro\assets"
  if errorlevel 2 goto :failed
)
if exist vendor (
  xcopy /E /I /Y vendor "dist\AI Studio Pro\vendor"
  if errorlevel 2 goto :failed
)
if exist frontend (
  xcopy /E /I /Y frontend "dist\AI Studio Pro\frontend"
  if errorlevel 2 goto :failed
)
copy /Y LICENSE "dist\AI Studio Pro\LICENSE"
if errorlevel 1 goto :failed
copy /Y README.md "dist\AI Studio Pro\README.md"
if errorlevel 1 goto :failed
python -m pip freeze > "dist\AI Studio Pro\BUILD_DEPENDENCIES.txt"
if errorlevel 1 goto :failed
> "dist\AI Studio Pro\BUILD_MODE.txt" echo WITH_PIPER=%WITH_PIPER%
if exist "%SystemRoot%\System32\ie4uinit.exe" ie4uinit.exe -show
echo.
echo Built: dist\AI Studio Pro\AI Studio Pro.exe
echo Keep the entire application folder together. This is not a single-file build.
echo A successful build is not a playback or installer validation. Follow the README checklist.
if not defined CI pause
exit /b 0
:usage
echo Usage: build_exe.bat [debug] [piper]
if not defined CI pause
exit /b 1
:failed
echo Build failed. Do not distribute an old or incomplete dist folder.
if not defined CI pause
exit /b 1
