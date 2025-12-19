FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Copy SQL file to dist directory (TypeScript doesn't copy non-TS files)
RUN cp src/config/database.sql dist/config/database.sql

# Create storage directories
RUN mkdir -p /app/storage/uploads /app/storage/thumbnails

# Expose port
EXPOSE 3001

# Start the application
CMD ["npm", "start"]

