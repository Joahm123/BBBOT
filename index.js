import "dotenv/config";
import { Client, GatewayIntentBits, PermissionsBitField } from "discord.js";
import { google } from "googleapis";

// ============================================================
// CONFIGURATION
// ============================================================

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const RANKS = [
  { name: "PRIVATE",              threshold: 0  },
  { name: "PRIVATE SECOND CLASS", threshold: 10 },
  { name: "PRIVATE FIRST CLASS",  threshold: 20 },
  { name: "LANCE CORPORAL",       threshold: 50 },
];

// ============================================================
// GOOGLE SHEETS SETUP
// ============================================================

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function getSheetsClient() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ============================================================
// SHEETS HELPERS
// ============================================================

// Find a user across all rank sheets (data starts at row 6)
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
            rowIndex:       i + 1,
            sheetName:      rank.name,
            robloxUsername: sheetUsername,
            robloxId:       fullRow[1] || "",
            currentPoints:  parseInt(fullRow[2]) || 0,
            currentEvents:  parseInt(fullRow[3]) || 0,
          };
        }
      }
    } catch (err) {
      console.error(`Error fetching sheet ${rank.name}:`, err.message);
    }
  }
  return null;
}

// Get columns D–H for a specific row
async function getFullRow(sheets, sheetName, rowIndex) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!D${rowIndex}:H${rowIndex}`,
  });
  return res.data.values ? res.data.values[0] : [];
}

// Update points (col F) and events (col G)
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

// Delete a row by index
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
              sheetId:    sheet.properties.sheetId,
              dimension:  "ROWS",
              startIndex: rowIndex - 1,
              endIndex:   rowIndex,
            },
          },
        }],
      },
    });
  } catch (err) {
    console.error(`Error deleting row ${rowIndex} in ${sheetName}:`, err.message);
  }
}

// Append a new row to a sheet
async function appendToSheet(sheets, sheetName, rowData) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!D:H`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowData] },
  });
}

// ============================================================
// RANK LOGIC
// ============================================================

// Return the highest rank a user qualifies for based on points
function getEligibleRank(points) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (points >= r.threshold) rank = r;
  }
  return rank;
}

// Move user to a new sheet if they crossed a rank threshold
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

// Build a progress string toward next rank
function progressMessage(sheetName, points) {
  const currentIdx = RANKS.findIndex(r => r.name === sheetName);
  const nextRank = RANKS[currentIdx + 1];
  return nextRank
    ? `${nextRank.threshold - points} points until ${nextRank.name}`
    : "Max rank reached";
}

// ============================================================
// DISCORD BOT
// ============================================================

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

bot.on("ready", () => {
  console.log(`✅ Bot is online as ${bot.user.tag}`);
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const args    = content.split(/\s+/);
  const command = args[0].toLowerCase();

  // ----------------------------------------------------------
  // !help
  // ----------------------------------------------------------
  if (command === "!help") {
    return message.reply(
      "**📋 Commands:**\n" +
      "`!help` — Show this message\n" +
      "`!promote <user(s)> <points>` — Add points & promote if threshold met *(Moderator only)*\n" +
      "`!event <user(s)> <points>` — Log an event with a set point value *(Moderator only)*\n" +
      "`!points <user>` — Show a user's points and rank\n" +
      "`!check <user>` — Check a user's rank and progress\n"
    );
  }

  // ----------------------------------------------------------
  // !promote <user(s)> <points>   (Moderator only)
  // ----------------------------------------------------------
  if (command === "!promote") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return message.reply("❌ You need the **Moderator** permission to use this command.");
    }

    const points = parseInt(args[args.length - 1]);
    const users  = args.slice(1, -1);

    if (users.length === 0 || isNaN(points) || points <= 0) {
      return message.reply("Usage: `!promote <user(s)> <points>`");
    }

    const sheets  = await getSheetsClient();
    const results = [];

    for (const username of users) {
      try {
        const user = await findUserRow(sheets, username);
        if (!user) {
          results.push(`• **${username}** — not found in roster`);
          continue;
        }

        const newPoints = user.currentPoints + points;
        const promoted  = await handlePromotion(sheets, user, newPoints);

        if (promoted) {
          results.push(`• **${username}** — promoted to **${promoted}**! 🎖️`);
        } else {
          await updateUserData(sheets, user.sheetName, user.rowIndex, newPoints, user.currentEvents);
          results.push(`• **${username}** [${user.sheetName}] — Points: ${newPoints} *(${progressMessage(user.sheetName, newPoints)})*`);
        }
      } catch (err) {
        console.error(err);
        results.push(`• **${username}** — error processing`);
      }
    }

    return message.reply("**Promotion Results:**\n" + results.join("\n"));
  }

  // ----------------------------------------------------------
  // !event <user(s)> <points>   (Moderator only)
  // ----------------------------------------------------------
  if (command === "!event") {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
      return message.reply("❌ You need the **Moderator** permission to use this command.");
    }

    const points = parseInt(args[args.length - 1]);
    const users  = args.slice(1, -1);

    if (users.length === 0 || isNaN(points) || points <= 0) {
      return message.reply("Usage: `!event <user(s)> <points>`\nExample: `!event PlayerOne PlayerTwo 3`");
    }

    const sheets  = await getSheetsClient();
    const results = [];

    for (const username of users) {
      try {
        const user = await findUserRow(sheets, username);
        if (!user) {
          results.push(`• **${username}** — not found in roster`);
          continue;
        }

        const newPoints = user.currentPoints + points;
        const newEvents = user.currentEvents + 1;
        const promoted  = await handlePromotion(sheets, user, newPoints);

        if (promoted) {
          results.push(`• **${username}** — promoted to **${promoted}**! 🎖️ *(+${points} pts, Events: ${newEvents})*`);
        } else {
          await updateUserData(sheets, user.sheetName, user.rowIndex, newPoints, newEvents);
          results.push(`• **${username}** [${user.sheetName}] — +${points} pts → ${newPoints} total | Events: ${newEvents} *(${progressMessage(user.sheetName, newPoints)})*`);
        }
      } catch (err) {
        console.error(err);
        results.push(`• **${username}** — error processing`);
      }
    }

    return message.reply("**Event Log Results:**\n" + results.join("\n"));
  }

  // ----------------------------------------------------------
  // !points <user>
  // ----------------------------------------------------------
  if (command === "!points") {
    const username = args[1];
    if (!username) {
      return message.reply("Usage: `!points <user>`");
    }

    try {
      const sheets = await getSheetsClient();
      const user   = await findUserRow(sheets, username);
      if (!user) {
        return message.reply(`❌ Cannot find user **"${username}"** in the roster.`);
      }

      return message.reply(
        `**${username}** [${user.sheetName}]\n` +
        `Points: **${user.currentPoints}**\n` +
        `Events: **${user.currentEvents}**\n` +
        `Progress: *${progressMessage(user.sheetName, user.currentPoints)}*`
      );
    } catch (err) {
      console.error(err);
      return message.reply("❌ Error fetching points.");
    }
  }

  // ----------------------------------------------------------
  // !check <user>
  // ----------------------------------------------------------
  if (command === "!check") {
    const username = args.slice(1).join(" ");
    if (!username) {
      return message.reply("Usage: `!check <username>`");
    }

    try {
      const sheets = await getSheetsClient();
      const user   = await findUserRow(sheets, username);
      if (!user) {
        return message.reply(`❌ Could not find user **"${username}"** in the roster.`);
      }

      return message.reply(
        `**${username}** [${user.sheetName}]\n` +
        `Points: **${user.currentPoints}**\n` +
        `Events: **${user.currentEvents}**\n` +
        `Progress: *${progressMessage(user.sheetName, user.currentPoints)}*`
      );
    } catch (err) {
      console.error(err);
      return message.reply("❌ Error retrieving user data.");
    }
  }
});

// ============================================================
// LOGIN
// ============================================================

bot.login(process.env.DISCORD_TOKEN);
