import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { google } from "googleapis";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const RANKS = [
  { name: "PRIVATE", threshold: 0 },
  { name: "PRIVATE SECOND CLASS", threshold: 10 },
  { name: "PRIVATE FIRST CLASS", threshold: 20 },
  { name: "LANCE CORPORAL", threshold: 50 },
];

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

async function getSheetsClient() {
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

async function getFullRow(sheets, sheetName, rowIndex) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!D${rowIndex}:H${rowIndex}`,
  });
  return res.data.values ? res.data.values[0] : [];
}

async function findUserRow(sheets, username) {
  for (const rank of RANKS) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${rank.name}!D:D`,
    });

    const rows = res.data.values || [];

    for (let i = 5; i < rows.length; i++) {
      const name = rows[i][0]?.toString().trim();
      if (name && name.toLowerCase() === username.toLowerCase()) {
        const fullRow = await getFullRow(sheets, rank.name, i + 1);

        return {
          rowIndex: i + 1,
          sheetName: rank.name,
          currentPoints: parseInt(fullRow[2]) || 0,
          currentEvents: parseInt(fullRow[3]) || 0,
        };
      }
    }
  }
  return null;
}

async function firewarnUser(sheets, username) {
  for (const rank of RANKS) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${rank.name}!D6:L100`,
    });

    const rows = res.data.values;
    if (!rows) continue;

    for (let i = 0; i < rows.length; i++) {
      const name = rows[i][0];

      if (name && name.toLowerCase().trim() === username.toLowerCase().trim()) {
        const rowIndex = i + 6;

        const fw1 = rows[i][6];
        const fw2 = rows[i][7];

        let range = "";

        if (!fw1) {
          range = `${rank.name}!J${rowIndex}`;
        } else if (!fw2) {
          range = `${rank.name}!K${rowIndex}`;
        } else {
          return `${username} already has 2 fire warns`;
        }

        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range,
          valueInputOption: "RAW",
          requestBody: { values: [[true]] },
        });

        return `Firewarn applied to ${username}`;
      }
    }
  }

  return "User not found";
}

function getEligibleRank(points) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (points >= r.threshold) rank = r;
  }
  return rank;
}

function progressMessage(sheetName, points) {
  const i = RANKS.findIndex(r => r.name === sheetName);
  const next = RANKS[i + 1];
  return next ? `${next.threshold - points} points until ${next.name}` : "Max rank reached";
}

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

bot.on("ready", () => {
  console.log(`Logged in as ${bot.user.tag}`);
});

bot.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();

  const sheets = await getSheetsClient();

  // FIREWARN
  if (command === "!firewarn") {
    const username = args.slice(1).join(" ");
    if (!username) return message.reply("Usage: !firewarn <user>");

    const result = await firewarnUser(sheets, username);
    return message.reply(result);
  }

  // EVENT
  if (command === "!event") {
    const points = parseInt(args[args.length - 1]);
    const users = args.slice(1, -1);

    if (!users.length || isNaN(points)) {
      return message.reply("Usage: !event <users> <points>");
    }

    const results = [];

    for (const u of users) {
      const user = await findUserRow(sheets, u);
      if (!user) {
        results.push(`${u}: not found`);
        continue;
      }

      const newPoints = user.currentPoints + points;
      const newEvents = user.currentEvents + 1;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${user.sheetName}!F${user.rowIndex}:G${user.rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [[newPoints, newEvents]] },
      });

      const rank = getEligibleRank(newPoints);

      results.push(
        `${u}: +${points} (${newPoints}) | Rank: ${rank.name} | ${progressMessage(user.sheetName, newPoints)}`
      );
    }

    return message.reply(results.join("\n"));
  }

  // POINTS
  if (command === "!points") {
    const username = args[1];
    if (!username) return message.reply("Usage: !points <user>");

    const user = await findUserRow(sheets, username);
    if (!user) return message.reply("User not found");

    return message.reply(
      `${username}: ${user.currentPoints} pts | ${user.currentEvents} events | ${progressMessage(user.sheetName, user.currentPoints)}`
    );
  }

  // NOTE (overwrite)
  if (command === "!note") {
    const users = args.slice(1, -1);
    const note = args.slice(-1).join(" ");

    if (!users.length || !note) {
      return message.reply("Usage: !note <users> <note>");
    }

    const results = [];

    for (const username of users) {
      const user = await findUserRow(sheets, username);

      if (!user) {
        results.push(`${username}: not found`);
        continue;
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${user.sheetName}!H${user.rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [[note]] },
      });

      results.push(`${username}: note set`);
    }

    return message.reply(results.join("\n"));
  }

  // ADDNOTE (append)
  if (command === "!addnote") {
    const users = args.slice(1, -1);
    const note = args.slice(-1).join(" ");

    if (!users.length || !note) {
      return message.reply("Usage: !addnote <users> <note>");
    }

    const results = [];

    for (const username of users) {
      const user = await findUserRow(sheets, username);

      if (!user) {
        results.push(`${username}: not found`);
        continue;
      }

      const currentRow = await getFullRow(sheets, user.sheetName, user.rowIndex);
      const existingNote = currentRow[4] || "";

      const newNote = existingNote
        ? `${existingNote} | ${note}`
        : note;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${user.sheetName}!H${user.rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [[newNote]] },
      });

      results.push(`${username}: note added`);
    }

    return message.reply(results.join("\n"));
  }
});

bot.login(process.env.DISCORD_TOKEN);
