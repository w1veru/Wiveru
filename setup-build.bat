@echo off
cd /d "%~dp0"
echo Building Wiveru-Setup...
if exist setup-dist rmdir /s /q setup-dist
mkdir setup-dist\Wiveru-Setup\resources\app
xcopy /e /i /q node_modules\electron\dist setup-dist\Wiveru-Setup\ >nul
copy /y installer\main.js setup-dist\Wiveru-Setup\resources\app\ >nul
copy /y installer\index.html setup-dist\Wiveru-Setup\resources\app\ >nul
copy /y installer\style.css setup-dist\Wiveru-Setup\resources\app\ >nul
copy /y installer\renderer.js setup-dist\Wiveru-Setup\resources\app\ >nul
echo {"name":"wiveru-setup","version":"1.0.0","main":"main.js","private":true} > setup-dist\Wiveru-Setup\resources\app\package.json
ren setup-dist\Wiveru-Setup\electron.exe Wiveru-Setup.exe
echo Done: setup-dist\Wiveru-Setup\Wiveru-Setup.exe
