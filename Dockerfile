FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY servidor.js ./
COPY public/ ./public/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO /dev/null http://127.0.0.1:3000/saude || exit 1
CMD ["node", "servidor.js"]
