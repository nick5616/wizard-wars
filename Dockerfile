FROM node:20-alpine
WORKDIR /app

# Copy shared package first
COPY shared/ ./shared/

# Copy server manifest and rewrite workspace dep to a file reference
COPY server/package.json ./
RUN node -e "\
  const fs = require('fs');\
  const pkg = JSON.parse(fs.readFileSync('package.json'));\
  pkg.dependencies.shared = 'file:./shared';\
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));\
"

RUN npm install --omit=dev

COPY server/ ./

EXPOSE 8080
CMD ["node", "index.js"]
