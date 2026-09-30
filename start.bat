@echo off
cd /d "%~dp0"
echo Membuka Konversi Invoice di http://127.0.0.1:3471  (tutup jendela ini untuk berhenti)
start "" http://127.0.0.1:3471
node server.js
