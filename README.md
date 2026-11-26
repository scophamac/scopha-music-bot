# Scopha Music Bot

A small Discord music bot built for Scopha's managed Lavalink service.

## Deploy with Scopha

1. Create a Discord application and bot.
2. Invite it with `bot` and `applications.commands` scopes.
3. In Scopha, select **Deploy bot** and paste this repository URL.
4. Set `DISCORD_TOKEN`.
5. Run the deployment check and deploy.

Scopha detects `scopha.json`, enables Lavalink for the bot, and supplies its local connection settings.

## Commands

- `/play query`
- `/pause`
- `/resume`
- `/skip`
- `/stop`
- `/queue`
- `/volume level`

Node.js 22 or newer is required.
