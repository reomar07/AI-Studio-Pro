@echo off
REM Turns the finished program (dist\AI Studio Pro) into  installer\AI_Studio_Pro_Setup.exe
cd /d "%~dp0"

if not exist "dist\AI Studio Pro\AI Studio Pro.exe" goto :nobuild

REM A real library file is thousands of bytes. A tiny one means the download failed, so stop here.
for %%F in (vendor\marked.min.js vendor\tailwind.js vendor\purify.min.js vendor\highlight.min.js) do (
  if not exist "dist\AI Studio Pro\%%F" goto :novendor
  if %%~zF LSS 3000 goto :novendor
)

set "ISCC="
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if exist "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if "%ISCC%"=="" goto :noinno

"%ISCC%" AI_Studio_Pro.iss
if errorlevel 1 goto :failed

echo.
echo DONE. Your installer is here:  installer\AI_Studio_Pro_Setup.exe
pause
exit /b 0

:nobuild
echo The program has not been built yet. Run build_exe.bat first, then run this again.
pause
exit /b 1

:novendor
echo One of the library files in "dist\AI Studio Pro\vendor" is missing or too small.
echo Start the app once while connected to the internet so it downloads them, run build_exe.bat again, then retry.
pause
exit /b 1

:noinno
echo Inno Setup 6 was not found. Install it, or open AI_Studio_Pro.iss in Inno Setup and press Compile.
pause
exit /b 1

:failed
echo.
echo The installer build failed. Copy the error text above and send it to me.
pause
exit /b 1
