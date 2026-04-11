# Use an official Node.js runtime as a parent image
FROM node:20

# Set the working directory inside the container
WORKDIR /app

# Copy the rest of the backend code
COPY . .

# Install dependencies
RUN npm install

EXPOSE 8000

# Start the backend
CMD ["sh", "scripts/start-server.sh"]
