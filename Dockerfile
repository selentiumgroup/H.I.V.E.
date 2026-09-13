FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
RUN mkdir -p /app/data
ENV HOST=0.0.0.0 PORT=48686 DATA_DIR=/app/data
EXPOSE 48686/tcp 48686/udp 48685/udp
CMD ["node","src/index.js"]
