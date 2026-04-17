import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const RANKS = [
  { name: "PRIVATE",              threshold: 0  },
  { name: "PRIVATE SECOND CLASS", threshold: 10 },
  { name: "PRIVATE FIRST CLASS",  threshold: 20 },
  { name: "LANCE CORPORAL",       threshold: 50 },
];

async function getSheetsClient() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

async function findUserRow(sheets, username) {
  for (const rank of RANKS) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${rank.name}!D:G`,
      });
      const rows = res.data.values || [];
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][0] && rows[i][0].toLowerCase() === username.toLowerCase()) {
          return {
            rowIndex: i + 1,
            sheetName: rank.name,
            robloxUsername: rows[i][0],
            robloxId: rows[i][1] || "",
            currentPoints: parseInt(rows[i][2]) || 0,
            currentEvents: parseInt(rows[i][3]) || 0,
          };
        }
      }
    } catch (err) {
      console.error(`Error searching ${rank.name}:`, err.message);
    }
  }
  return null;
}

async function getFullRow(sheets, sheetName, rowIndex) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!D${rowIndex}:H${rowIndex}`,
  });
  return res.data.values ? res.data.values[0] : [];
}

async function updateUserData(sheets, sheetName, rowIndex, newPoints, newEvents) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!F${rowIndex}:G${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [[newPoints, newEvents]] },
  });
}

async function deleteRow(sheets, sheetName, rowIndex) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });
  const sheet = spreadsheet.data.sheets.find(
    s => s.properties.title === sheetName
  );
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: "ROWS",
            startIndex: rowIndex - 1,
            endIndex: rowIndex,
          },
        },
      }],
    },
  });
}

async function appendToSheet(sheets, sheetName, rowData) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!D:H`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowData] },
  });
}

function getEligibleRank(points) {
  let eligible = RANKS[0];
  for (const rank of RANKS) {
    if (points >= rank.threshold) eligible = rank;
  }
  return eligible;
}

async function handlePromotion(sheets, user, newPoints) {
  const eligibleRank = getEligibleRank(newPoints);
  if (eligibleRank.name === user.sheetName) return null;
  const fullRow = await getFullRow(sheets, user.sheetName, user.rowIndex);
  fullRow[2] = newPoints;
  await deleteRow(sheets, user.sheetName, user.rowIndex);
  await appendToSheet(sheets, eligibleRank.name, fullRow);
  return eligibleRank.name;
}

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

bot.on("ready", () => {
  console.log(`Bot online: ${bot.user.tag}`);
});

// !promote <user1> <user2> ... <points>
bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!promote")) return;

  const args = message.content.trim().split(/\s+/).slice(1);
  const pointsToAdd = parseInt(args[args.length - 1]);
  const usernames = args.slice(0, -1);

  if (usernames.length === 0 || isNaN(pointsToAdd) || pointsToAdd <= 0) {
    return message.reply("Usage: !promote <username1> <username2> ... <points>\nExample: !promote coolwhip825 walrus_WB2 3");
  }

  const sheets = await getSheetsClient();
  const results = [];

  for (const username of usernames) {
    try {
      const user = await findUserRow(sheets, username);
      if (!user) { results.push(`${username} - not found in roster`); continue; }
      const newPoints = user.currentPoints + pointsToAdd;
      const promotedTo = await handlePromotion(sheets, user, newPoints);
      if (promotedTo) {
        results.push(`${username} - promoted to ${promotedTo}! Points: ${newPoints}`);
      } else {
        await updateUserData(sheets, user.sheetName, user.rowIndex, newPoints, user.currentEvents);
        const currentRankIndex = RANKS.findIndex(r => r.name === user.sheetName);
        const nextRank = RANKS[currentRankIndex + 1];
        const progressMsg = nextRank ? ` (${nextRank.threshold - newPoints} points until ${nextRank.name})` : " (max rank reached)";
        results.push(`${username} [${user.sheetName}] - Points: ${newPoints}${progressMsg}`);
      }
    } catch (err) {
      console.error(err);
      results.push(`${username} - error updating`);
    }
  }

  message.reply("Promote results:\n" + results.join("\n"));
});

// !event <user1> <user2> ...
bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!event")) return;

  const args = message.content.trim().split(/\s+/).slice(1);
  if (args.length === 0) {
    return message.reply("Usage: !event <username1> <username2> ...\nExample: !event coolwhip825 walrus_WB2");
  }

  const sheets = await getSheetsClient();
  const results = [];

  for (const username of args) {
    try {
      const user = await findUserRow(sheets, roblox_username);
      if (!user) { results.push(`${username} - not found in roster`); continue; }
      const newPoints = user.currentPoints + 1;
      const newEvents = user.currentEvents + 1;
      const promotedTo = await handlePromotion(sheets, user, newPoints);
      if (promotedTo) {
        results.push(`${username} - promoted to ${promotedTo}! Points: ${newPoints}, Events: ${newEvents}`);
      } else {
        await updateUserData(sheets, user.sheetName, user.rowIndex, newPoints, newEvents);
        results.push(`${username} [${user.sheetName}] - Events: ${newEvents}, Points: ${newPoints}`);
      }
    } catch (err) {
      console.error(err);
      results.push(`${username} - error updating`);
    }
  }

  message.reply("Event log results:\n" + results.join("\n"));
});

// !points <username>
bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!points")) return;

  const args = message.content.trim().split(/\s+/).slice(1);
  const robloxUsername = args[0];
  if (!robloxUsername) return message.reply("Usage: !points <username>");

  try {
    const sheets = await getSheetsClient();
    const user = await findUserRow(sheets, robloxUsername);
    if (!user) return message.reply(`Could not find ${robloxUsername} in the roster.`);
    const currentRankIndex = RANKS.findIndex(r => r.name === user.sheetName);
    const nextRank = RANKS[currentRankIndex + 1];
    const progressMsg = nextRank
      ? `\n${nextRank.threshold - user.currentPoints} points until ${nextRank.name}`
      : "\nMax rank reached";
    message.reply(
      `${robloxUsername} [${user.sheetName}]\nPoints: ${user.currentPoints}\nEvents: ${user.currentEvents}${progressMsg}`
    );
  } catch (err) {
    console.error(err);
    message.reply("Something went wrong.");
  }
});

bot.login(process.env.DISCORD_TOKEN);
