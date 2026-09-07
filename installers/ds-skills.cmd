@echo off
setlocal
node "%~dp0..\lib\bin\ds-skills.mjs" %*
exit /b %ERRORLEVEL%
