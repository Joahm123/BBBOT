Index · JS
Copy

import "dotenv/config";
import { Client, GatewayIntentBits, PermissionsBitField } from "discord.js";
import { google } from "googleapis";
 
// Initialize Google Sheets API client
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
 
// Define ranks with exact sheet names
const RANKS = [
  { name: "PRIVATE", threshold: 0 },
  { name: "PRIVATE SECOND CLASS", threshold: 10 },
  { name: "PRIVATE FIRST CLASS", threshold: 20 },
  { name: "LANCE CORPORAL", threshold: 50 },
];
 
// Function to get Google Sheets client
async function getSheetsClient() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}
 
// Function to find user across sheets, considering data starts at row 6
async function findUserRow(sheets, username) {
  for (const rank of RANKS) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${rank.name}!D:D`,
      });
      const rows = res.data.values || [];
      for (let i = 5; i < rows.length; i++) {
        const sheetUsername = rows[i][0]?.toString().trim() || "";
        if (sheetUsername.toLowerCase() === username.trim().toLowerCase()) {
          const fullRow = await getFullRow(sheets, rank.name, i + 1);
          return {
            rowIndex: i + 1,
            sheetName: rank.name,
            robloxUsername: sheetUsername,
            robloxId: fullRow[1] || "",
            currentPoints: parseInt(fullRow[2]) || 0,
            currentEvents: parseInt(fullRow[3]) || 0,
          };
        }
      }
    } catch (err) {
      console.error(`Error fetching sheet ${rank.name}:`, err.message);
    }
  }
  return null;
}
 
// Get full row data for a user (columns D-H)
async function getFullRow(sheets, sheetName, rowIndex) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!D${rowIndex}:H${rowIndex}`,
  });
  return res.data.values ? res.data.values[0] : [];
}
 
// Update points and events
async function updateUserData(sheets, sheetName, rowIndex, newPoints, newEvents) {
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!F${rowIndex}:G${rowIndex}`,
      valueInputOption: "RAW",
      requestBody: { values: [[newPoints, newEvents]] },
    });
  } catch (err) {
    console.error(`Error updating row ${rowIndex} in ${sheetName}:`, err.message);
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
  } catch (err) {
    console.error(`Error deleting row ${rowIndex} in ${sheetName}:`, err.message);
  }
}
 
// Append a new row
async function appendToSheet(sheets, sheetName, rowData) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!D:H`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowData] },
  });
}
 
// Determine rank based on points
function getEligibleRank(points) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (points >= r.threshold) rank = r;
  }
  return rank;
}
 
// Handle promotion — only moves user if they've crossed a rank threshold
async function handlePromotion(sheets, user, newPoints) {
  const newRank = getEligibleRank(newPoints);
  const oldRank = getEligibleRank(user.currentPoints);
  if (newRank.name === oldRank.name) return null;
  const fullRow = await getFullRow(sheets, user.sheetName, user.rowIndex);
  fullRow[2] = newPoints;
  await deleteRow(sheets, user.sheetName, user.rowIndex);
  await appendToSheet(sheets, newRank.name, fullRow);
  return newRank.name;
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
 
// Main message handler
bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;
 
  const content = message.content.trim();
  const args = content.split(/\s+/);
 
  if (content === "!help") {
    return message.reply(`
**Commands:**
!help - Show this help message
!promote <user(s)> <points> - Promote users (Moderator only)
!event <user(s)> - Log an event for users
!points <user> - Show user's points and rank
!check <user> - Check a user's rank and points
`);
  }
 
  if (content.startsWith("!promote")) {
    // Check for Moderator permission
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return message.reply("You need the **Moderator** permission to use this command.");
    }
 
    const points = parseInt(args[args.length - 1]);
    const users = args.slice(1, -1);
    if (users.length === 0 || isNaN(points) || points <= 0) {
      return message.reply("Usage: !promote <user(s)> <points>");
    }
    const sheets = await getSheetsClient();
    const results = [];
 
    for (const username of users) {
      try {
        const user = await findUserRow(sheets, username);
        if (!user) {
          results.push(`${username} - not found in roster`);
          continue;
        }
        const newPoints = user.currentPoints + points;
        const newRank = await handlePromotion(sheets, user, newPoints);
        if (newRank) {
          results.push(`${username} - promoted to **${newRank}**!`);
        } else {
          await updateUserData(sheets, user.sheetName, user.rowIndex, newPoints, user.currentEvents);
          const currentIdx = RANKS.findIndex(r => r.name === user.sheetName);
          const nextRank = RANKS[currentIdx + 1];
          const progressMsg = nextRank
            ? ` (${nextRank.threshold - newPoints} points until ${nextRank.name})`
            : " (max rank)";
          results.push(`${username} [${user.sheetName}] - Points: ${newPoints}${progressMsg}`);
        }
      } catch (err) {
        results.push(`${username} - error`);
      }
    }
    message.reply("Promotion results:\n" + results.join("\n"));
    return;
  }
 
  if (content.startsWith("!event")) {
    const users = args.slice(1);
    if (users.length === 0) {
      return message.reply("Usage: !event <user(s)>");
    }
    const sheets = await getSheetsClient();
    const results = [];
 
    for (const username of users) {
      try {
        const user = await findUserRow(sheets, username);
        if (!user) {
          results.push(`${username} - not found in roster`);
          continue;
        }
        const newPoints = user.currentPoints + 1;
        const newEvents = user.currentEvents + 1;
        const newRank = await handlePromotion(sheets, user, newPoints);
        if (newRank) {
          results.push(`${username} - promoted to ${newRank}! Points: ${newPoints}, Events: ${newEvents}`);
        } else {
          await updateUserData(sheets, user.sheetName, user.rowIndex, newPoints, newEvents);
          results.push(`${username} [${user.sheetName}] - Events: ${newEvents}, Points: ${newPoints}`);
        }
      } catch (err) {
        results.push(`${username} - error`);
      }
    }
    message.reply("Event log results:\n" + results.join("\n"));
    return;
  }
 
  if (content.startsWith("!points")) {
    const username = args[1];
    if (!username) {
      return message.reply("Usage: !points <user>");
    }
    try {
      const sheets = await getSheetsClient();
      const user = await findUserRow(sheets, username);
      if (!user) {
        return message.reply(`Cannot find user "${username}"`);
      }
      const currentIdx = RANKS.findIndex(r => r.name === user.sheetName);
      const nextRank = RANKS[currentIdx + 1];
      const progressMsg = nextRank
        ? `\n${nextRank.threshold - user.currentPoints} points until ${nextRank.name}`
        : "\nMax rank reached";
      message.reply(
        `${username} [${user.sheetName}]\nPoints: ${user.currentPoints}\nEvents: ${user.currentEvents}${progressMsg}`
      );
    } catch (err) {
      message.reply("Error fetching points.");
    }
    return;
  }
 
  if (content.startsWith("!check")) {
    const username = args.slice(1).join(" ");
    if (!username) {
      return message.reply("Usage: !check <username>");
    }
    try {
      const sheets = await getSheetsClient();
      const user = await findUserRow(sheets, username);
      if (!user) {
        return message.reply(`Could not find user "${username}" in the roster.`);
      }
      const currentIdx = RANKS.findIndex(r => r.name === user.sheetName);
      const nextRank = RANKS[currentIdx + 1];
      const progressMsg = nextRank
        ? `\n${nextRank.threshold - user.currentPoints} points until ${nextRank.name}`
        : "\nMax rank reached";
      message.reply(
        `${username} [${user.sheetName}]\nPoints: ${user.currentPoints}\nEvents: ${user.currentEvents}${progressMsg}`
      );
    } catch (err) {
      message.reply("Error retrieving user data.");
    }
    return;
  }
});
 
// Log in your bot
bot.login(process.env.DISCORD_TOKEN);
 
