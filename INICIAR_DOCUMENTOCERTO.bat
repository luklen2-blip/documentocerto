@echo off
title DocumentoCerto - Servidor de Producao 24/7
cd /d C:\Users\luciano\.gemini\antigravity\scratch\documentocerto
echo ===================================================
echo   INICIANDO DOCUMENTOCERTO (SAAS 2.0)
echo   Antes de enviar, descubra se esta tudo certo.
echo ===================================================
echo.
echo Executando testes automatizados de integridade...
call npm test
if %errorlevel% neq 0 (
    echo [ERRO] Falha nos testes de integridade. Corrija antes de iniciar.
    pause
    exit /b %errorlevel%
)
echo.
echo Iniciando servidor HTTP na porta 3000...
start DocumentoCerto-Server /min node server.js
timeout /t 2 /nobreak >nul
echo Iniciando tunel seguro em nuvem 24/7...
start DocumentoCerto-Tunnel /min node start_tunnel.js
timeout /t 4 /nobreak >nul
start http://localhost:3000
echo.
echo ===================================================
echo DocumentoCerto em operacao!
echo Servidor e Tunel iniciados com sucesso.
echo A URL publica e o status estao em: URL-NUVEM-DOCUMENTOCERTO.txt
echo ===================================================
pause
