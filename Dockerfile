FROM denoland/deno:latest

WORKDIR /app

# Copy backend and frontend (server serves frontend statically)
COPY ./backend /app
COPY ../frontend /app/frontend

WORKDIR /app

# Cache remote deps
RUN deno cache deno-server.ts || true

ENV PORT=5099
ENV DB_FILE=/data/ttoys.db

EXPOSE 5099

ENTRYPOINT ["deno"]
CMD ["run", "--allow-env", "--allow-net", "--allow-read", "--allow-write", "deno-server.ts"]
