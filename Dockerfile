FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/main"]
