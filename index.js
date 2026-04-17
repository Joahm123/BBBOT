import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
    const SHEET_NAME = "PRIVATE";

    async function getSheets() {
      const client = await auth.getClient();
        return google.sheets({ version: "v4", auth: client });
        }

        async function findUserRow(sheets, username) {
          const res = await sheets.spreadsheets.values.get({
              spreadsheetId: SPREADSHEET_ID,
                  range: `${SHEET_NAME}!D:G`,
                    });
                      const rows = res.data.values || [];
                        for (let i = 0; i < rows.length; i++) {
                            if (rows[i][0] && rows[i][0].toLowerCase() === username.toLowerCase()) {
                                  return {
                                          rowIndex: i + 1,
                                                  currentPoints: parseInt(rows[i][2]) || 0,
                                                          currentEvents: parseInt(rows[i][3]) || 0,
                                                                };
                                                                    }
                                                                      }
                                                                        return null;
                                                                        }

                                                                        async function updateUserData(sheets, rowIndex, newPoints, newEvents) {
                                                                          await sheets.spreadsheets.values.update({
                                                                              spreadsheetId: SPREADSHEET_ID,
                                                                                  range: `${SHEET_NAME}!F${rowIndex}:G${rowIndex}`,
                                                                                      valueInputOption: "RAW",
                                                                                          requestBody: { values: [[newPoints, newEvents]] },
                                                                                            });
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

                                                                                                              bot.on("messageCreate", async (message) => {
                                                                                                                if (message.author.bot) return;
                                                                                                                  if (!message.content.startsWith("!promote")) return;
                                                                                                                    const args = message.content.trim().split(/\s+/).slice(1);
                                                                                                                      const robloxUsername = args[0];
                                                                                                                        const pointsToAdd = parseInt(args[1]);
                                                                                                                          if (!robloxUsername || isNaN(pointsToAdd) || pointsToAdd <= 0) {
                                                                                                                              return message.reply("Usage: !promote <RobloxUsername> <points>\nExample: !promote coolwhip825 3");
                                                                                                                                }
                                                                                                                                  try {
                                                                                                                                      const sheets = await getSheets();
                                                                                                                                          const user = await findUserRow(sheets, robloxUsername);
                                                                                                                                              if (!user) return message.reply(`Could not find ${robloxUsername} in the roster.`);
                                                                                                                                                  const newPoints = user.currentPoints + pointsToAdd;
                                                                                                                                                      await updateUserData(sheets, user.rowIndex, newPoints, user.currentEvents);
                                                                                                                                                          message.reply(`Added ${pointsToAdd} point(s) to ${robloxUsername}.\nPoints: ${newPoints} (was ${user.currentPoints})`);
                                                                                                                                                            } catch (err) {
                                                                                                                                                                console.error(err);
                                                                                                                                                                    message.reply("Access error - check that the sheet is shared with the service account email.");
                                                                                                                                                                      }
                                                                                                                                                                      });

                                                                                                                                                                      bot.on("messageCreate", async (message) => {
                                                                                                                                                                        if (message.author.bot) return;
                                                                                                                                                                          if (!message.content.startsWith("!event")) return;
                                                                                                                                                                            const args = message.content.trim().split(/\s+/).slice(1);
                                                                                                                                                                              const robloxUsername = args[0];
                                                                                                                                                                                if (!robloxUsername) return message.reply("Usage: !event <RobloxUsername>\nExample: !event coolwhip825");
                                                                                                                                                                                  try {
                                                                                                                                                                                      const sheets = await getSheets();
                                                                                                                                                                                          const user = await findUserRow(sheets, robloxUsername);
                                                                                                                                                                                              if (!user) return message.reply(`Could not find ${robloxUsername} in the roster.`);
                                                                                                                                                                                                  const newPoints = user.currentPoints + 1;
                                                                                                                                                                                                      const newEvents = user.currentEvents + 1;
                                                                                                                                                                                                          await updateUserData(sheets, user.rowIndex, newPoints, newEvents);
                                                                                                                                                                                                              message.reply(`Event logged for ${robloxUsername}.\nEvents attended: ${newEvents}\nPoints: ${newPoints} (was ${user.currentPoints})`);
                                                                                                                                                                                                                } catch (err) {
                                                                                                                                                                                                                    console.error(err);
                                                                                                                                                                                                                        message.reply("Access error - check that the sheet is shared with the service account email.");
                                                                                                                                                                                                                          }
                                                                                                                                                                                                                          });

                                                                                                                                                                                                                          bot.on("messageCreate", async (message) => {
                                                                                                                                                                                                                            if (message.author.bot) return;
                                                                                                                                                                                                                              if (!message.content.startsWith("!points")) return;
                                                                                                                                                                                                                                const args = message.content.trim().split(/\s+/).slice(1);
                                                                                                                                                                                                                                  const robloxUsername = args[0];
                                                                                                                                                                                                                                    if (!robloxUsername) return message.reply("Usage: !points <RobloxUsername>");
                                                                                                                                                                                                                                      try {
                                                                                                                                                                                                                                          const sheets = await getSheets();
                                                                                                                                                                                                                                              const user = await findUserRow(sheets, robloxUsername);
                                                                                                                                                                                                                                                  if (!user) return message.reply(`Could not find ${robloxUsername} in the roster.`);
                                                                                                                                                                                                                                                      message.reply(`${robloxUsername}\nPoints: ${user.currentPoints}\nEvents: ${user.currentEvents}`);
                                                                                                                                                                                                                                                        } catch (err) {
                                                                                                                                                                                                                                                            console.error(err);
                                                                                                                                                                                                                                                                message.reply("Something went wrong.");
                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                  });

                                                                                                                                                                                                                                                                  bot.login(process.env.DISCORD_TOKEN);