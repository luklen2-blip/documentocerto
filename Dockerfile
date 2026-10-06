FROM node:20-alpine

WORKDIR /usr/src/app

# Instala dependências com cache eficiente
COPY package*.json ./
RUN npm install --omit=dev || npm install

# Copia código-fonte da aplicação
COPY . .

# Variáveis padrão
ENV NODE_ENV=production
ENV PORT=3000

# Execução obrigatória dos testes de integridade antes de autorizar a inicialização
RUN node tests/run_all.js

EXPOSE 3000

CMD ["node", "server.js"]
