@echo off
rem One click launcher (D4). Starts the local server and opens the browser.
rem The server is bound to 127.0.0.1 only: there is no login on it, so it must
rem never be reachable from the rest of the network.

cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies, this happens once...
  call npm install || goto :failed
)

echo Applying any new database migrations...
call npx prisma migrate deploy || goto :failed

if not exist ".next\BUILD_ID" (
  echo Building the app, this happens once...
  call npm run build || goto :failed
)

start "" http://127.0.0.1:3939
call npm run start
goto :eof

:failed
echo.
echo Something went wrong. The message above says what.
pause
