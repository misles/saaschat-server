FROM node:18-bullseye

# Security updates and cleanup in a single RUN to reduce layers
RUN sed -i 's/stable\/updates/stable-security\/updates/' /etc/apt/sources.list && \
    apt-get update && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files first for better layer caching
COPY package*.json ./

ARG NPM_TOKEN

# Handle NPM token securely
RUN if [ -n "${NPM_TOKEN:-}" ]; then \
    echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc && \
    npm install --production && \
    rm -f .npmrc; \
    else \
    npm install --production; \
    fi

# Copy the rest of the application
COPY . .

EXPOSE 3000

CMD [ "npm", "start" ]