import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { google } from "googleapis";

// Initialize Google Sheets API client
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// Rank thresholds
const RANKS = [
  { name: "PRIVATE", threshold: 0 },
  { name: "PRIVATE SECOND CLASS", threshold: 10 },
  { name: "PRIVATE FIRST CLASS", threshold: 20 },
  { name: "LANCE CORPORAL", threshold: 50 },
];

// Function to get Sheets client
async function getSheetsClient() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// Find user row in sheets
async function findUserRow(sheets, username) {
  for (const rank of RANKS) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${rank.name}!D:G`,
      });
      const rows = res.data.values || [];
      console.log(`Searching in sheet: ${rank.name}, fetched ${rows.length} rows`);
      for (let i = 0; i < rows.length; i++) {
        const cellValue = rows[i][0];
        const sheetUsername = cellValue ? cellValue.toString().trim() : "";
        console.log(`Row ${i + 1} in ${rank.name}: "${sheetUsername}"`);
        if (sheetUsername.toLowerCase() === username.trim().toLowerCase()) {
          console.log(`Match found at row ${i + 1} in sheet ${rank.name}`);
          return {
            rowIndex: i + 1,
            sheetName: rank.name,
            robloxUsername: sheetUsername,
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
  console.log(`User "${username}" not found in any sheet`);
  return null;
}

// Get full row data
async function getFullRow(sheets, sheetName, rowIndex) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!D${rowIndex}:H${rowIndex}`,
    });
    return res.data.values ? res.data.values[0] : [];
  } catch (err) {
    console.error(`Error fetching full row ${rowIndex} in ${sheetName}:`, err.message);
    throw err;
  }
}

// Update user points and events
async function updateUserData(sheets, sheetName, rowIndex, newPoints, newEvents) {
  try {
    console.log(`Updating row ${rowIndex} in ${sheetName} with points: ${newPoints}, events: ${newEvents}`);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!F${rowIndex}:G${rowIndex}`,
      valueInputOption: "RAW",
      requestBody: { values: [[newPoints, newEvents]] },
    });
  } catch (err) {
    console.error(`Error updating row ${rowIndex} in sheet ${sheetName}:`, err.message);
    throw err;
  }
}

// Delete a row
async function deleteRow(sheets, sheetName, rowIndex) {
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
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
    console.log(`Deleted row ${rowIndex} in sheet ${sheetName}`);
  } catch (err) {
    console.error(`Error deleting row ${rowIndex} in ${sheetName}:`, err.message);
    throw err;
  }
}

// Append a new row
async function appendToSheet(sheets, sheetName, rowData) {
  try {
    console.log(`Appending to sheet ${sheetName}:`, rowData);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!D:H`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowData] },
    });
  } catch (err) {
    console.error(`Error appending to sheet ${sheetName}:`, err.message);
    throw err;
  }
}

// Determine eligible rank based on points
function getEligibleRank(points) {
  let eligible = RANKS[0];
  for (const rank of RANKS) {
    if (points >= rank.threshold) eligible = rank;
  }
  return eligible;
}

// Handle promotion logic
async function handlePromotion(sheets, user, newPoints) {
  const eligibleRank = getEligibleRank(newPoints);
  if (eligibleRank.name === user.sheetName) return null;
  const fullRow = await getFullRow(sheets, user.sheetName, user.rowIndex);
  fullRow[2] = newPoints; // points position
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
  console.log(`Bot is online as ${bot.user.tag}`);
});

// Single messageCreate handler for all commands
bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  // Help command
  if (content === "!help") {
    return message.reply(`
**Available Commands:**
!help - Show this help message
!promote <username1> <username2> ... <points> - Promote users by adding points
!event <username1> <username2> ... - Log an event for users
!points <username> - Show points and rank info for a user
`);
  }

  const args = content.split(/\s+/);

  // Promote command
  if (content.startsWith("!promote")) {
    const pointsToAdd = parseInt(args[args.length - 1]);
    const usernames = args.slice(1, -1);
    if (usernames.length === 0 || isNaN(pointsToAdd) || pointsToAdd <= 0) {
      return message.reply("Usage: !promote <username1> <username2> ... <points>");
    }
    const sheets = await getSheetsClient();
    const results = [];

    for (const username of usernames) {
      try {
        const user = await findUserRow(sheets, username);
        if (!user) {
          console.log(`User "${username}" not found`);
          results.push(`${username} - not found in roster`);
          continue;
        }
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
        console.error(`Error processing ${username}:`, err);
        results.push(`${username} - error updating`);
      }
    }
    message.reply("Promote results:\n" + results.join("\n"));
    return;
  }

  // Event command
  if (content.startsWith("!event")) {
    const eventUsers = args.slice(1);
    if (eventUsers.length === 0) {
      return message.reply("Usage: !event <username1> <username2> ...");
    }
    const sheets = await getSheetsClient();
    const results = [];

    for (const username of eventUsers) {
      try {
        const user = await findUserRow(sheets, username);
        if (!user) {
          console.log(`User "${username}" not found`);
          results.push(`${username} - not found in roster`);
          continue;
        }
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
        console.error(`Error processing ${username}:`, err);
        results.push(`${username} - error updating`);
      }
    }
    message.reply("Event log results:\n" + results.join("\n"));
    return;
  }

  // Points command
  if (content.startsWith("!points")) {
    const username = args[1];
    if (!username) {
      return message.reply("Usage: !points <username>");
    }
    try {
      const sheets = await getSheetsClient();
      const user = await findUserRow(sheets, username);
      if (!user) {
        return message.reply(`Could not find ${username} in the roster.`);
      }
      const currentRankIndex = RANKS.findIndex(r => r.name === user.sheetName);
      const nextRank = RANKS[currentRankIndex + 1];
      const progressMsg = nextRank
        ? `\n${nextRank.threshold - user.currentPoints} points until ${nextRank.name}`
        : "\nMax rank reached";
      message.reply(
        `${username} [${user.sheetName}]\nPoints: ${user.currentPoints}\nEvents: ${user.currentEvents}${progressMsg}`
      );
    } catch (err) {
      console.error(`Error fetching points for ${username}:`, err);
      message.reply("Something went wrong.");
    }
    return;
  }

  // Optional: Test command for debugging
  if (content.startsWith("!testuser")) {
    const testUsername = args.slice(1).join(" ");
    const sheets = await getSheetsClient();
    const user = await findUserRow(sheets, testUsername);
    if (user) {
      return message.reply(`Found user at row ${user.rowIndex} in sheet ${user.sheetName}`);
    } else {
      return message.reply(`User "${testUsername}" not found`);
    }
  }
});

// Log in your bot
bot.login(process.env.DISCORD_TOKEN);
