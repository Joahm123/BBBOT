import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { google } from "googleapis";
import noblox from "noblox.js";

const SPREADSHEET_ID  = process.env.SPREADSHEET_ID;
const ROBLOX_COOKIE   = process.env.ROBLOX_COOKIE;
const ROBLOX_GROUP_ID = parseInt(process.env.ROBLOX_GROUP_ID);

const ALLOWED_ROLES = [
  "1474218253290176531",
  "1474218253290176530",
];

const RANKS = [
  { name: "PRIVATE",              threshold: 0,  robloxRoleId: 641231080 },
  { name: "PRIVATE SECOND CLASS", threshold: 10, robloxRoleId: 639865065 },
  { name: "PRIVATE FIRST CLASS",  threshold: 20, robloxRoleId: 640153080 },
  { name: "LANCE CORPORAL",       threshold: 50, robloxRoleId: 640541050 },
];

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function getSheetsClient() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

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
            robloxId:       parseInt(fullRow[1]) || null,
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

async function getFullRow(sheets, sheetName, rowIndex) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!D${rowIndex}:H${rowIndex}`,
  });
  return res.data.values ? res.data.values[0] : [];
}

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
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (points >= r.threshold) rank = r;
  }
  return rank;
}

function progressMessage(sheetName, points) {
  const currentIdx = RANKS.findIndex(r => r.name === sheetName);
  const nextRank = RANKS[currentIdx + 1];
  return nextRank
    ? `${nextRank.threshold - points} points until ${nextRank.name}`
    : "Max rank reached";
}

async function setRobloxRank(robloxId, roleId) {
  if (!robloxId) {
    console.warn("No Roblox ID provided, skipping rank update.");
    return false;
  }
  try {
    await noblox.setRank(ROBLOX_GROUP_ID, robloxId, roleId);
    return true;
  } catch (err) {
    console.error("Roblox rank update failed:", err.message);
    return false;
  }
}

// Removed role check to allow everyone
// function hasAllowedRole(member
//   return member.roles.cache.some(role => ALLOWED_ROLES.includes(role.id));
// }

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

noblox.setCookie(ROBLOX_COOKIE).then(() => {
  console.log("Logged into Roblox.");
}).catch(err => {
  console.error("Failed to log into Roblox:", err.message);
});

bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const args    = content.split(/\s+/);
  const command = args[0].toLowerCase();

  if (command === "!help") {
    return message.reply(
      "**Commands:**\n" +
      "`!event <user(s)> <points>` - Log an event and add points\n" +
      "`!points <user>` - Show a user's points and rank\n" +
      "`!check <user>` - Check a user's rank, auto-promotes if eligible\n"
    );
  }

  // Removed role check, everyone can use commands
  // if (!hasAllowedRole(message.member)) {
  //   return message.reply("You do not have permission to use this command.");
  // }

  if (command === "!event") {
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
          results.push(`- ${username}: not found in roster`);
          continue;
        }
        const newPoints = user.currentPoints + points;
        const newEvents = user.currentEvents + 1;
        await updateUserData(sheets, user.sheetName, user.rowIndex, newPoints, newEvents);
        results.push(`- ${username} [${user.sheetName}]: +${points} pts, ${newPoints} total | Events: ${newEvents} | ${progressMessage(user.sheetName, newPoints)}`);
      } catch (err) {
        console.error(err);
        results.push(`- ${username}: error processing`);
      }
    }

    return message.reply("**Event Log Results:**\n" + results.join("\n"));
  }

  if (command === "!points") {
    const username = args[1];
    if (!username) {
      return message.reply("Usage: `!points <user>`");
    }
    try {
      const sheets = await getSheetsClient();
      const user   = await findUserRow(sheets, username);
      if (!user) {
        return message.reply(`Cannot find user "${username}" in the roster.`);
      }
      return message.reply(
        `**${username}** [${user.sheetName}]\n` +
        `Points: ${user.currentPoints}\n` +
        `Events: ${user.currentEvents}\n` +
        `Progress: ${progressMessage(user.sheetName, user.currentPoints)}`
      );
    } catch (err) {
      console.error(err);
      return message.reply("Error fetching points.");
    }
  }

  if (command === "!check") {
    const username = args.slice(1).join(" ");
    if (!username) {
      return message.reply("Usage: `!check <username>`");
    }
    try {
      const sheets       = await getSheetsClient();
      const user         = await findUserRow(sheets, username);
      if (!user) {
        return message.reply(`Could not find user "${username}" in the roster.`);
      }

      const eligibleRank = getEligibleRank(user.currentPoints);
      const currentRank  = RANKS.find(r => r.name === user.sheetName);

      if (eligibleRank.name !== currentRank.name) {
        const fullRow = await getFullRow(sheets, user.sheetName, user.rowIndex);
        fullRow[2] = user.currentPoints;
        await deleteRow(sheets, user.sheetName, user.rowIndex);
        await appendToSheet(sheets, eligibleRank.name, fullRow);
        const robloxUpdated = await setRobloxRank(user.robloxId, eligibleRank.robloxRoleId);
        return message.reply(
          `**${username}** has been promoted to **${eligibleRank.name}**\n` +
          `Points: ${user.currentPoints}\n` +
          `Events: ${user.currentEvents}\n` +
          `Progress: ${progressMessage(eligibleRank.name, user.currentPoints)}\n` +
          (robloxUpdated ? "Roblox rank updated successfully." : "Roblox rank update failed.")
        );
      }

      return message.reply(
        `**${username}** [${user.sheetName}]\n` +
        `Points: ${user.currentPoints}\n` +
        `Events: ${user.currentEvents}\n` +
        `Progress: ${progressMessage(user.sheetName, user.currentPoints)}`
      );
    } catch (err) {
      console.error(err);
      return message.reply("Error retrieving user data.");
    }
  }
});

bot.login(process.env.DISCORD_TOKEN);
