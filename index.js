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
        // Debug: Log the username you're searching for
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

// The other functions remain unchanged, just with added logs if desired

// ... (rest of your code remains the same)

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

// Your message handlers...
// (Same as previous, with debugging in findUserRow)

bot.on("messageCreate", async (message) => {
  // Your existing command handling code...
  // For testing, add a debug command to directly test findUserRow:
  if (message.content.startsWith("!testuser")) {
    const args = message.content.split(/\s+/);
    const testUsername = args.slice(1).join(" ");
    const sheets = await getSheetsClient();
    const user = await findUserRow(sheets, testUsername);
    if (user) {
      message.reply(`Found user at row ${user.rowIndex} in sheet ${user.sheetName}`);
    } else {
      message.reply(`User "${testUsername}" not found`);
    }
  }
  // ... rest of your commands
});

bot.login(process.env.DISCORD_TOKEN);
