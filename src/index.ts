import bot from './bot';

async function main() {
  console.log('Starting bot...');
  try {
    await bot.start();
    console.log('Bot is running!');
  } catch (err) {
    console.error('Failed to start bot:', err);
    process.exit(1);
  }
}

main();
