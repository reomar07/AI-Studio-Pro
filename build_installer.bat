@echo off
setlocal
cd /d "%~dp0"
if not exist "dist\AI Studio Pro\AI Studio Pro.exe" goto :nobuild
REM Validate the actual packaged files, not the source vendor directory.
for %%F in ("dist\AI Studio Pro\vendor\marked.min.js" "dist\AI Studio Pro\vendor\tailwind.js" "dist\AI Studio Pro\vendor\purify.min.js" "dist\AI Studio Pro\vendor\highlight.min.js") do (
  if not exist "%%~fF" goto :novendor
  if %%~zF LSS 3000 goto :novendor
)
if not exist "dist\AI Studio Pro\frontend\scripts\bootstrap.js" goto :nobuild
if not exist "dist\AI Studio Pro\frontend\scripts\settings_hub.js" goto :nobuild
if not exist "dist\AI Studio Pro\frontend\scripts\offline_voices.js" goto :nobuild
if not exist "dist\AI Studio Pro\BUILD_MODE.txt" goto :nobuild
findstr /X /C:"WITH_PIPER=1" "dist\AI Studio Pro\BUILD_MODE.txt" >nul
if not errorlevel 1 (
  echo Piper-enabled build: verify third-party licenses, notices and applicable source obligations before distribution.
)
set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if "%ISCC%"=="" goto :noinno
"%ISCC%" AI_Studio_Pro.iss
if errorlevel 1 goto :failed
echo Installer created: installer\AI_Studio_Pro_Setup.exe
echo Test installation and playback on Windows before distributing it.
if not defined CI pause
exit /b 0
:nobuild
echo Build files are missing. Run build_exe.bat with the desired options first.
goto :failed
:novendor
echo Packaged vendor libraries are missing or too small.
echo Run the source app online once, rebuild the application, then retry.
goto :failed
:noinno
echo Inno Setup 6 was not found. Install it or compile AI_Studio_Pro.iss in Inno Setup.
:failed
echo Installer not completed. Review the errors above.
if not defined CI pause
exit /b 1
