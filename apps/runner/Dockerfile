# The runner's image (D56). Built from the repository root, since the runner
# needs the shared package next to it: docker build -f apps/runner/Dockerfile .
FROM oven/bun:1.4.4-alpine

WORKDIR /app

# Dependencies first, so this layer is rebuilt only when they change.
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/runner/package.json apps/runner/
RUN bun install --frozen-lockfile --production --filter @exhibition/runner

COPY packages/shared/src packages/shared/src
COPY apps/runner apps/runner

CMD ["bun", "apps/runner/src/main.ts"]
