import {
  Client,
  Events,
  GatewayIntentBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Kazagumo } from 'kazagumo';
import { Connectors } from 'shoukaku';

const required = ['DISCORD_TOKEN', 'LAVALINK_HOST', 'LAVALINK_PORT', 'LAVALINK_PASSWORD'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing environment: ${missing.join(', ')}`);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const music = new Kazagumo({
  defaultSearchEngine: 'youtube',
  send: (guildId, payload) => client.guilds.cache.get(guildId)?.shard.send(payload),
}, new Connectors.DiscordJS(client), [{
  name: 'scopha',
  url: `${process.env.LAVALINK_HOST}:${process.env.LAVALINK_PORT}`,
  auth: process.env.LAVALINK_PASSWORD,
  secure: process.env.LAVALINK_SECURE === '1',
}], {
  resume: true,
  reconnectTries: 8,
  reconnectInterval: 5,
});

const commands = [
  new SlashCommandBuilder().setName('play').setDescription('Play or queue music from YouTube').addStringOption((option) => option.setName('query').setDescription('YouTube URL or song name').setRequired(true)),
  new SlashCommandBuilder().setName('pause').setDescription('Pause playback'),
  new SlashCommandBuilder().setName('resume').setDescription('Resume playback'),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current track'),
  new SlashCommandBuilder().setName('stop').setDescription('Stop playback and leave'),
  new SlashCommandBuilder().setName('queue').setDescription('Show the queue'),
  new SlashCommandBuilder().setName('volume').setDescription('Set playback volume').addIntegerOption((option) => option.setName('level').setDescription('Volume from 1 to 150').setMinValue(1).setMaxValue(150).setRequired(true)),
].map((command) => command.toJSON());

async function registerGuildCommands(guild) {
  const registered = await guild.commands.set(commands);
  console.log(`Registered ${registered.size} commands in ${guild.name}`);
  return registered.size;
}

async function voiceChannelFor(interaction) {
  const guild = interaction.guild ?? await client.guilds.fetch(interaction.guildId);
  const member = await guild.members.fetch(interaction.user.id);
  return member.voice.channel;
}

function currentPlayer(interaction) {
  return music.players.get(interaction.guildId);
}

async function requirePlayer(interaction) {
  const player = currentPlayer(interaction);
  if (!player) await interaction.editReply('Nothing is playing.');
  return player;
}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    let registered = 0;
    for (const guild of readyClient.guilds.cache.values()) {
      registered += await registerGuildCommands(guild);
    }
    await readyClient.application.commands.set([]);
    console.log(`Ready as ${readyClient.user.tag}; registered ${registered} server commands`);
  } catch (error) {
    console.error('Command registration failed:', error);
  }
});

client.on(Events.GuildCreate, (guild) => {
  registerGuildCommands(guild).catch((error) => console.error(`Command registration failed in ${guild.id}:`, error));
});

music.shoukaku.on('ready', (name) => console.log(`Lavalink ${name} connected`));
music.shoukaku.on('error', (name, error) => console.error(`Lavalink ${name}:`, error));

music.on('playerStart', async (player, track) => {
  const channel = await client.channels.fetch(player.textId).catch(() => null);
  if (channel?.isTextBased()) await channel.send(`Now playing **${track.title}**`);
});

music.on('playerEmpty', async (player) => {
  const channel = await client.channels.fetch(player.textId).catch(() => null);
  if (channel?.isTextBased()) await channel.send('Queue finished.');
  player.destroy();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Music commands are available in servers only.', ephemeral: true }).catch(console.error);
    return;
  }

  try {
    // Acknowledge first. Discord invalidates an unanswered interaction after
    // three seconds, while member fetches and music searches can take longer.
    await interaction.deferReply();
    console.log(`Command /${interaction.commandName} received in guild ${interaction.guildId}`);

    if (interaction.commandName === 'play') {
      const voice = await voiceChannelFor(interaction);
      if (!voice) return interaction.editReply('Join a voice channel first.');
      let player = currentPlayer(interaction);
      if (player && player.voiceId !== voice.id) return interaction.editReply('Join my voice channel first.');
      if (!player) {
        player = await music.createPlayer({
          guildId: interaction.guildId,
          textId: interaction.channelId,
          voiceId: voice.id,
          volume: 60,
        });
      }
      const query = interaction.options.getString('query', true).trim();
      const result = await music.search(query, { requester: interaction.user, engine: 'youtube' });
      if (!result.tracks.length) return interaction.editReply('No YouTube results found.');
      if (result.type === 'PLAYLIST') player.queue.add(result.tracks);
      else player.queue.add(result.tracks[0]);
      if (!player.playing && !player.paused) await player.play();
      return interaction.editReply(result.type === 'PLAYLIST' ? `Queued ${result.tracks.length} tracks.` : `Queued **${result.tracks[0].title}**.`);
    }

    const player = await requirePlayer(interaction);
    if (!player) return;
    const voice = await voiceChannelFor(interaction);
    if (!voice || voice.id !== player.voiceId) return interaction.editReply('Join my voice channel first.');

    if (interaction.commandName === 'pause') {
      await player.pause(true);
      return interaction.editReply('Paused.');
    }
    if (interaction.commandName === 'resume') {
      await player.pause(false);
      return interaction.editReply('Resumed.');
    }
    if (interaction.commandName === 'skip') {
      await player.skip();
      return interaction.editReply('Skipped.');
    }
    if (interaction.commandName === 'stop') {
      player.destroy();
      return interaction.editReply('Stopped.');
    }
    if (interaction.commandName === 'volume') {
      const level = interaction.options.getInteger('level', true);
      await player.setVolume(level);
      return interaction.editReply(`Volume set to ${level}%.`);
    }
    if (interaction.commandName === 'queue') {
      const tracks = [...player.queue].slice(0, 10);
      const lines = tracks.map((track, index) => `${index + 1}. ${track.title}`);
      return interaction.editReply(lines.length ? lines.join('\n') : 'The queue is empty.');
    }
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed:`, error);
    const message = 'The command failed. Check the bot logs.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(console.error);
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(console.error);
    }
  }
});

async function shutdown() {
  for (const player of music.players.values()) player.destroy();
  client.destroy();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await client.login(process.env.DISCORD_TOKEN);
