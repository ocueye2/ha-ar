
# Build stage
FROM node:22-bookworm-slim AS build

# Dependencies required to compile node-canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHON=/usr/bin/python3

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built React application into Nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Nginx listens on port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
