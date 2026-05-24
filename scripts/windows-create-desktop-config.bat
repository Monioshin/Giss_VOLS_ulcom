@echo off
chcp 65001 >nul
setlocal
set "CFG_DIR=%APPDATA%\GIS VOLS"
set "CFG_FILE=%CFG_DIR%\gis-desktop.json"
if not exist "%CFG_DIR%" mkdir "%CFG_DIR%"
if exist "%CFG_FILE%" (
  echo Файл уже есть: %CFG_FILE%
  notepad "%CFG_FILE%"
  exit /b 0
)
(
echo {
echo   "apiUrl": "http://192.168.1.50:4000"
echo }
) > "%CFG_FILE%"
echo Создан %CFG_FILE%
echo Замените IP на адрес вашего сервера GIS, сохраните файл.
notepad "%CFG_FILE%"
