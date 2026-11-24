FROM apify/actor-node-playwright-chrome:22 AS builder

WORKDIR /home/myuser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY --chown=myuser:myuser package*.json tsconfig.json ./

RUN npm install --include=dev --audit=false

COPY --chown=myuser:myuser src ./src

RUN npm run build


FROM apify/actor-node-playwright-chrome:22

WORKDIR /home/myuser
ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional --audit=false \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && rm -rf ~/.npm

COPY --from=builder --chown=myuser:myuser /home/myuser/dist ./dist
COPY --chown=myuser:myuser .actor ./.actor

CMD ["node", "dist/main.js"]
