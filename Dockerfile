FROM node:18-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --only=production

COPY server/ .

EXPOSE 3001

CMD ["npm", "start"]