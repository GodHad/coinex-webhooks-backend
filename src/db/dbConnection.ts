import mongoose from "mongoose";
import Hook from "../models/Hook";

require("dotenv").config("../.env");
const DB_CONNECTION = process.env.MONGODB_URI;

export const init = () => {
  if (DB_CONNECTION === undefined) return;
  if (mongoose.connection.readyState === mongoose.ConnectionStates.connected)
    return;
  mongoose
    .connect(DB_CONNECTION)
    .then(async (v) => {
      await Hook.updateMany(
        { tradeDirection: { $exists: false } }, // Only update records where tradeDirection is missing
        { $set: { tradeDirection: 'BOTH' } }
      );
      console.log('All missing tradeDirection fields set to neutral.');

      console.log(`mongodb database connected`);
    })
    .catch((e) => {
      console.error(`mongodb error ${e}`);
    });
};
