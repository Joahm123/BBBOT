import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const RANKS = [
  { name: "PRIVATE", threshold: 0 },
  { name: "PRIVATE SECOND CLASS", threshold: 10 },
  { name: "PRIVATE FIRST CLASS", threshold: 20 },
  { name: "LANCE CORPORAL", threshold: 50 },
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
      console.log(`Searching in sheet: ${rank.name}, fetched ${rows.length} rows`);
      for (let i = 0; i < rows.length; i++) {
        const cellValue = rows[i][0];
        const sheetUsername = cellValue ? cellValue.toString().trim() : "";
        console.log(`Row ${i + 1} in ${rank.name}: "${sheetUsername}"`);
        console.log(`Comparing with input: "${username.trim().toLowerCase()}"`);
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

// ... (other functions unchanged, include with same debug/error handling)

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

// Command: !help
bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();

  if (content === "!help") {
    const helpMessage = `
Available Commands:
!help - Show this help message
!promote <username1> <username2> ... <points> - Promote users by adding points
!event <username1> <username2> ... - Log an event for users
!points <username> - Show points and rank info for a user
`;
    return message.reply(helpMessage);
  }

  // Your other command handlers below...
  if (content.startsWith("!promote")) {
    // ... existing promote code
  } else if (content.startsWith("!event")) {
    // ... existing event code
  } else if (content.startsWith("!points")) {
    // ... existing points code
  }
  // Optional: add your test command for debugging
  if (content.startsWith("!testuser")) {
    const args = content.split(/\s+/);
    const testUsername = args.slice(1).join(" ");
    const sheets = await getSheetsClient();
    const user = await findUserRow(sheets, testUsername);
    if (user) {
      message.reply(`Found user at row ${user.rowIndex} in sheet ${user.sheetName}`);
    } else {
      message.reply(`User "${testUsername}" not found`);
    }
  }
});

// Your existing promote, event, points handlers...

// Example: promote handler
bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!promote")) return;
  // ... your promote code here
});

// ... (rest of your handlers)

bot.login(process.env.DISCORD_TOKEN);
