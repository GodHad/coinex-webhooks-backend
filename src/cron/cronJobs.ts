import cron from "node-cron";
import Webhook from "../models/Hook";
import User from "../models/User";
import { handleGetDataFromCoinex, handleGetHistoryDataFromCoinex } from "../utils/coinexUtils";
import PositionHistory from "../models/PositionHistory";


async function removeOldWebhooks(): Promise<void> {
    try {
        const fifteenDaysAgo = new Date();
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);

        const result = await Webhook.deleteMany({
            updatedAt: { $lt: fifteenDaysAgo },
            adminHook: undefined
        });

        console.log(`✅ Deleted ${result.deletedCount} old webhooks.`);
    } catch (error) {
        console.error("❌ Error deleting old webhooks:", error);
    }
}

async function getAccountsData(): Promise<void> {
    try {
        const users = await User.find();

        users.forEach(async user => {
            const hooks = await Webhook.find({ creator: user._id });
            let total = 0, available = 0, inPosition = 0;
            for (let i = 0; i < hooks.length; i++) {
                const hook = hooks[i];
                const { success, data, error } = await handleGetDataFromCoinex(hook.coinExApiKey, hook.coinExApiSecret, `/v2/assets/futures/balance`);

                if (success && data.code === 0) {
                    const subAccounts = data.data;
                    if (subAccounts) {
                        const balances = subAccounts.reduce(
                            (sum: { total: number; available: number; inPosition: number }, acc: { available: string; frozen: string }) => {
                                const available = Number(acc.available) || 0;
                                const frozen = Number(acc.frozen) || 0;

                                sum.total += available + frozen;
                                sum.available += available;
                                sum.inPosition += frozen;

                                return sum;
                            },
                            { total: 0, available: 0, inPosition: 0 }
                        );

                        total += balances.total;
                        available += balances.available;
                        inPosition += balances.inPosition;
                    }
                }

                const historyData = await handleGetHistoryDataFromCoinex(hook.coinExApiKey, hook.coinExApiSecret);

                if (historyData.success && historyData.data) {
                    await PositionHistory.deleteMany({ hook: hook._id });
                    const histories = historyData.data;
                    const positionHistories = histories.map((history: any) => ({ data: history.position, hook: hook._id, finished: history.finished }));

                    await PositionHistory.insertMany(positionHistories);
                }
            }

            const balance = { total: 0, available: 0, inPosition: 0 };
            balance.total = total;
            balance.available = available;
            balance.inPosition = inPosition;
            user.balance = balance;
            user.activeAccount = hooks.length;

            user.markModified('balance');

            await user.save();
        })
    } catch (error) {
        console.error("❌ Get Accounts Data:", error);
    }
}

cron.schedule("31 21 * * *", () => {
    console.log("🕛 Running daily webhook cleanup job...");
    getAccountsData();
    removeOldWebhooks();
});

export { removeOldWebhooks };
