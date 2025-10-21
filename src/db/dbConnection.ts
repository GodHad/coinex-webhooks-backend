import mongoose, { Types } from "mongoose";
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DB_CONNECTION = process.env.MONGODB_URI;

export const init = () => {
  if (DB_CONNECTION === undefined) return;
  if (mongoose.connection.readyState === mongoose.ConnectionStates.connected)
    return;
  mongoose
    .connect(DB_CONNECTION)
    .then(async (v) => {
      console.log(`mongodb database connected`);
    })
    .catch((e) => {
      console.error(`mongodb error ${e}`);
    });
};
