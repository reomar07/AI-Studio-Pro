@echo off
REM Clears Windows' saved icon pictures so File Explorer shows the real icon of "AI Studio Pro.exe".
REM Your desktop and taskbar will flicker for a few seconds - that is normal.
echo Refreshing the Windows icon cache...
ie4uinit.exe -show
taskkill /f /im explorer.exe >nul 2>&1
del /a /q "%localappdata%\IconCache.db" >nul 2>&1
del /a /f /q "%localappdata%\Microsoft\Windows\Explorer\iconcache*" >nul 2>&1
start explorer.exe
echo.
echo Done. Open the dist\AI Studio Pro folder again to check the icon.
pause
