# Use the official Puppeteer environment container that comes pre-packaged with Node, Chromium, and Linux shared dependencies
FROM ghcr.io/puppeteer/puppeteer:latest

# Change working directory inside the container
WORKDIR /usr/src/app

# Copy dependency configuration manifests
COPY package*.json ./

# Install packages securely 
RUN npm ci

# Copy all local project source files into the container
COPY . .

# Expose the internal network port matching your server setup
EXPOSE 3000

# Fire up the live production server environment
CMD [ "node", "server.js" ]