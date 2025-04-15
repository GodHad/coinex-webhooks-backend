import cron from "node-cron";
import Webhook, { IHook } from "../models/Hook";
import User from "../models/User";
import { handleGetDataFromCoinex, handleGetHistoryDataFromCoinex } from "../utils/coinexUtils";
import PositionHistory from "../models/PositionHistory";
import dotenv from 'dotenv';
import { sendEmail } from "../utils/sendMail";
dotenv.config();

async function removeOldWebhooks(): Promise<void> {
    try {
        const now = new Date();

        const fifteenDaysAgo = new Date(now);
        fifteenDaysAgo.setDate(now.getDate() - 15);

        const fourteenDaysAgo = new Date(now);
        fourteenDaysAgo.setDate(now.getDate() - 14);

        const oneDayBeforeFifteen = new Date(fifteenDaysAgo);
        oneDayBeforeFifteen.setDate(oneDayBeforeFifteen.getDate() - 1);

        // 🔴 Hooks to delete now (15+ days old)
        const toDeleteHooks = await Webhook.find({
            updatedAt: { $lt: fifteenDaysAgo },
            createdAt: { $lt: oneDayBeforeFifteen },
            adminHook: undefined,
        });

        // 🟡 Hooks that will be deleted soon (14+ days old)
        const toWarnHooks = await Webhook.find({
            updatedAt: { $lt: fourteenDaysAgo },
            createdAt: { $lt: fourteenDaysAgo },
            adminHook: undefined,
        });

        const notifyUser = async (hooks: any[], type: 'deleted' | 'warning') => {
            const groupedByUser = new Map<string, typeof hooks>();

            for (const hook of hooks) {
                if (hook.creator) {
                    const uid = hook.creator.toString();
                    if (!groupedByUser.has(uid)) groupedByUser.set(uid, []);
                    groupedByUser.get(uid)!.push(hook);
                }
            }

            for (const [userId, userHooks] of groupedByUser) {
                const user = await User.findById(userId);
                if (!user || !user.email) continue;

                const hookCount = userHooks.length;

                let subject = '';
                let text = '';

                if (type === 'deleted') {
                    subject = 'Your Webhooks Were Removed';
                    text = `Hi ${user.firstName || 'there'},\n\n` +
                        `${hookCount} of your webhook${hookCount > 1 ? 's were' : ' was'} deleted due to inactivity for over 15 days.\n` +
                        `Please make sure to keep your webhooks up to date in the future.\n\n` +
                        `- Signalyze Team`;
                } else {
                    subject = 'Your Webhooks Will Be Deleted Soon';
                    text = `Hi ${user.firstName || 'there'},\n\n` +
                        `${hookCount} of your webhook${hookCount > 1 ? 's' : ''} have been inactive for 14 days.\n` +
                        `They will be deleted in 1 day if not updated.\n\n` +
                        `Please log in and update them if you want to keep them.\n\n` +
                        `- Signalyze Team`;
                }

                await sendEmail(user.email, subject, text, '');
            }
        };

        // 📨 Send both notifications
        await notifyUser(toDeleteHooks, 'deleted');
        await notifyUser(toWarnHooks, 'warning');

        // 🧹 Actually delete the old ones
        const result = await Webhook.deleteMany({
            _id: { $in: toDeleteHooks.map(h => h._id) }
        });

        console.log(`✅ Deleted ${result.deletedCount} old webhooks.`);
    } catch (error) {
        console.error("❌ Error in removeOldWebhooks:", error);
    }
}

async function getAccountsData(): Promise<void> {
    try {
        const users = await User.find();

        users.forEach(async user => {
            const hooks = await Webhook.find({ creator: user._id });
            const uniqueHooksMap = new Map();

            hooks.forEach(hook => {
                const key = `${hook.coinExApiKey}::${hook.coinExApiSecret}`;
                if (!uniqueHooksMap.has(key)) {
                    uniqueHooksMap.set(key, hook);
                }
            });

            const uniqueHooks = Array.from(uniqueHooksMap.values());
            let total = 0, available = 0, inPosition = 0;
            for (let i = 0; i < hooks.length; i++) {
                const hook = hooks[i];
                const { success, data, error } = await handleGetDataFromCoinex(hook.coinExApiKey, hook.coinExApiSecret, `/v2/assets/futures/balance`);

                if (success && data.code === 0) {
                    const subAccounts = data.data;
                    if (subAccounts) {
                        const balance = subAccounts.reduce(
                            (sum: { total: number; available: number; inPosition: number }, acc: { available: string; margin: string }) => {
                                const available = Number(acc.available) || 0;
                                const margin = Number(acc.margin) || 0;

                                sum.total += available + margin;
                                sum.available += available;
                                sum.inPosition += margin;

                                return sum;
                            },
                            { total: 0, available: 0, inPosition: 0 }
                        );

                        total += balance.total;
                        available += balance.available;
                        inPosition += balance.inPosition;
                        hook.balance = balance;
                        await hook.save();
                    }
                }

                const historyData = await handleGetHistoryDataFromCoinex(hook.coinExApiKey, hook.coinExApiSecret, hook.lastRetrieveTime || Date.now());

                if (historyData.success && historyData.data) {
                    await PositionHistory.deleteMany({ hook: hook._id, finished: false });
                    const histories = historyData.data;
                    const positionHistories = histories.map((history: any) => ({ data: history.position, hook: hook._id, finished: history.finished }));

                    await PositionHistory.insertMany(positionHistories);
                    hook.lastRetrieveTime = historyData.lastTimestamp || Date.now();
                    await hook.save();
                }
            }

            const balance = { total: 0, available: 0, inPosition: 0 };
            balance.total = total;
            balance.available = available;
            balance.inPosition = inPosition;
            user.balance = balance;
            user.activeAccount = uniqueHooks.length;

            user.markModified('balance');

            await user.save();
        })
    } catch (error) {
        console.error("❌ Get Accounts Data:", error);
    }
}

const cleanupCronTime = process.env.WEBHOOK_CLEANUP_CRON || '0 0 * * *';
const retrieveAccountDataTime = process.env.WEBHOOK_RETRIEVE_POSITION_DATE_CRON || '0 * * * *';

cron.schedule(cleanupCronTime, () => {
    console.log("🕛 Running daily webhook cleanup job...");
    removeOldWebhooks();
});

cron.schedule(retrieveAccountDataTime, () => {
    console.log("🕛 Running hourly get history job...");
    getAccountsData();
});

export { removeOldWebhooks, getAccountsData };
