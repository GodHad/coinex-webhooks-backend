import mongoose from "mongoose";
import AdminData from "../models/AdminData";

require("dotenv").config("../.env");
const DB_CONNECTION = process.env.MONGODB_URI;

export const init = () => {
  if (DB_CONNECTION === undefined) return;
  if (mongoose.connection.readyState === mongoose.ConnectionStates.connected)
    return;
  mongoose
    .connect(DB_CONNECTION)
    .then(async (v) => {
      console.log(`mongodb database connected`);
      await AdminData.findOneAndUpdate({},{
        siteMaintainanceMode: false,
        webhooksMaintainanceMode: false,
      })
    })
    .catch((e) => {
      console.error(`mongodb error ${e}`);
    });
};
