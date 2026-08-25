# Alleen voor de WhatsApp-bot in bot/. De site draait op Vercel en heeft dit niet nodig.
#
# De bot moet blijven draaien om zijn WhatsApp-sessie in leven te houden, en dat kan
# Vercel niet. Deze image is bedoeld voor Railway, Fly.io of een eigen server.

FROM node:22-alpine

WORKDIR /app

# Eerst alleen de manifesten, zodat npm ci in een eigen laag komt en niet opnieuw
# hoeft te draaien als je alleen een berichtje aanpast.
COPY bot/package.json bot/package-lock.json ./bot/
RUN cd bot && npm ci --omit=dev

# De berichten. Dit bestand wordt gegenereerd door `npm run build` in de hoofdmap,
# dus zorg dat het gecommit is voordat je deployt.
COPY api/_data.js ./api/_data.js

COPY bot/ ./bot/

# De WhatsApp-sessie en de verzendstand moeten op een volume dat een herbouw overleeft.
# Koppel bij Railway of Fly.io een volume aan /data.
ENV DATA_DIR=/data
RUN mkdir -p /data

WORKDIR /app/bot
CMD ["node", "bot.mjs"]
