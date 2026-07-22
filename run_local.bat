@echo off
echo Starting eLearn with local Dictionary proxy...
echo.

if not exist "functions\node_modules\cheerio" (
    echo [INFO] cheerio is not installed in functions directory.
    echo Installing dependencies for functions...
    cd functions
    call npm install
    cd ..
    echo.
)

echo Open: http://localhost:3000
echo Dictionary works immediately — no Firebase deploy needed for local dev.
echo.
node server/dict-server.mjs
pause
