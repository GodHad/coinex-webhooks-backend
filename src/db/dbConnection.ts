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
        { positionState: { $exists: false } }, // Only update records where positionState is missing
        { $set: { positionState: 'neutral' } }
      );
      console.log('All missing positionState fields set to neutral.');

      console.log(`mongodb database connected`);
    })
    .catch((e) => {
      console.error(`mongodb error ${e}`);
    });
};
