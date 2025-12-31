FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create data directory for database persistence
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "src/server.js"]
