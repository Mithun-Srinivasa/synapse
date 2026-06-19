# Dockerfile -- Synapse Socket.io backend server
# Phase 4: Production Deployment

FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies (including devDependencies required for typescript compilation)
RUN npm ci

# Copy all source files
COPY . .

# Compile TypeScript to JavaScript (dist/)
RUN npm run build

# Prune dev dependencies to keep image size small
RUN npm prune --production

# Expose backend port
EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

# Run the compiled server
CMD ["npm", "run", "start"]
