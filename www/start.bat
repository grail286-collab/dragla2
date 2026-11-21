@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=8080
echo Запускаю «Логово дракона» на http://localhost:%PORT%
echo Не закрывай это окно, пока играешь.
where python >nul 2>nul && (start "" http://localhost:%PORT% & python -m http.server %PORT% & goto :end)
where py >nul 2>nul && (start "" http://localhost:%PORT% & py -m http.server %PORT% & goto :end)
where npx >nul 2>nul && (start "" http://localhost:%PORT% & npx --yes serve -l %PORT% . & goto :end)
echo.
echo Не нашёл ни Python, ни Node.js.
echo Установи Python с https://www.python.org/downloads/ (галочка "Add Python to PATH") и запусти снова.
:end
pause
