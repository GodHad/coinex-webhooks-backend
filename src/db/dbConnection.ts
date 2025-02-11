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
      // await AdminData.create({
      //   twitter: 'https://twitter.com/TwitterWebHookPro',
      //   telegram: 'https://t.me/WebHookPro',
      //   discord: 'https://discord.gg/WebHookPro',
      //   instagram: 'https://instagram.com/WebHookPro',
      //   favicon: '/vite.svg',
      //   pageTitle: 'Webhook Manager',
      //   sidebarTitle: 'Webhook Manager',
      //   mainTitle: 'Quantum Edge Trading',
      //   subTitle: 'An exclusive algorithmic trading platform for elite traders.',
      //   featuredCardTitle: 'Institutional-Grade Security',
      //   featuredCardDescription: 'Advanced encryption and secure infrastructure',
      //   featuredCardTitle1: 'Lightning-Fast Execution',
      //   featuredCardDescription1: 'Sub-millisecond order processing',
      //   featuredCardTitle2: 'Global Market Access',
      //   featuredCardDescription2: 'Trade on multiple exchanges seamlessly',
      //   maintainanceMode: false,
      //   allowSignup: false,
      // })
    })
    .catch((e) => {
      console.error(`mongodb error ${e}`);
    });
};
