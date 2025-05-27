import mongoose, { Types } from "mongoose";
import AdminHook from "../models/AdminHook";
import PremiumHook from "../models/PremiumHook";

require("dotenv").config("../.env");
const DB_CONNECTION = process.env.MONGODB_URI;

// interface IAdminHookLegacy {
//   _id: Types.ObjectId;
//   creator: Types.ObjectId;
//   name: string;
//   pair: string;
//   url: string;
//   timeframe?: string;
//   description?: string;
//   imageUrl: string;
//   riskLevel?: 'High' | 'Medium' | 'Low';
//   recommendedLeverage?: string;
//   enabled: boolean;
// }

export const init = () => {
  if (DB_CONNECTION === undefined) return;
  if (mongoose.connection.readyState === mongoose.ConnectionStates.connected)
    return;
  mongoose
    .connect(DB_CONNECTION)
    .then(async (v) => {
      console.log(`mongodb database connected`);
      // const adminHooks = await AdminHook.find().lean<IAdminHookLegacy[]>();

      // for (const ah of adminHooks) {
      //   const premiumData = {
      //     creator: ah.creator,
      //     name: ah.name,
      //     timeframe: ah.timeframe,
      //     description: ah.description,
      //     imageUrl: ah.imageUrl,
      //     riskLevel: ah.riskLevel,
      //     recommendedLeverage: ah.recommendedLeverage,
      //     enabled: ah.enabled,
      //     pairs: [ah._id],
      //   };

      //   await PremiumHook.create(premiumData);
      //   console.log(`Created PremiumHook for AdminHook ${ah._id}`);
      // }

      // console.log('1-to-1 migration done.');
    })
    .catch((e) => {
      console.error(`mongodb error ${e}`);
    });
};
