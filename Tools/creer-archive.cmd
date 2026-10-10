@echo off
setlocal
rem Double-clic : cree l'archive de release dans le dossier du projet.
rem Cette commande ne modifie pas la politique PowerShell de Windows.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0package.ps1"
set "archiveExitCode=%errorlevel%"
echo.
if not "%archiveExitCode%"=="0" echo Echec de creation du ZIP. Voir l'erreur ci-dessus.
pause
exit /b %archiveExitCode%
