import cron from "node-cron";
import Webhook, { IHook } from "../models/Hook";
import User from "../models/User";
import { handleGetDataFromCoinex, handleGetHistoryDataFromCoinex } from "../utils/coinexUtils";
import PositionHistory from "../models/PositionHistory";
import dotenv from 'dotenv';
import { sendEmail } from "../utils/sendMail";
import { trailingStopService, TrailingRuntimeConfig } from "../services/trailingStopService";
import PositionTrailingState, { TrailingType, TrailingSide } from "../models/PositionTrailingState";
dotenv.config();

const TRAIL_TYPES: TrailingType[] = ['percentage', 'fixed', 'atr', 'volatility'];

const toNumber = (value: any): number | undefined => {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
};

const toTrailType = (value: any): TrailingType => {
    const raw = String(value ?? '').toLowerCase() as TrailingType;
    return TRAIL_TYPES.includes(raw) ? raw : 'percentage';
};

const parseSide = (value: any): TrailingSide => {
    const raw = String(value ?? '').toLowerCase();
    return raw === 'short' ? 'short' : 'long';
};

const extractEntryPrice = (position: any): number | undefined => {
    return (
        toNumber(position?.avg_entry_price) ??
        toNumber(position?.entry_price) ??
        toNumber(position?.open_avg_price) ??
        toNumber(position?.base_price) ??
        toNumber(position?.price)
    );
};

const extractCurrentPrice = (position: any, fallback: number): number => {
    const price =
        toNumber(position?.mark_price) ??
        toNumber(position?.current_price) ??
        toNumber(position?.last_price) ??
        toNumber(position?.index_price) ??
        toNumber(position?.market_price) ??
        fallback;
    return Number.isFinite(price) && price && price > 0 ? price : fallback;
};

const buildTrailingRuntimeConfigs = async (
    hook: IHook,
    histories: Array<{ position: any; finished: boolean }> | undefined
): Promise<void> => {
    const hookId = String(hook._id);
    const rows = Array.isArray(histories) ? histories : [];

    const trailing = hook.trailingConfig;
    const defaultMinProfit = Math.max(0, toNumber(trailing?.minProfitThreshold) ?? 0);
    const rawTrailDistance = toNumber(trailing?.trailDistance);
    const validTrailDistance = Number.isFinite(rawTrailDistance) && (rawTrailDistance as number) > 0;
    const defaultTrailDistance = validTrailDistance ? (rawTrailDistance as number) : 1.5;
    const defaultTrailType = toTrailType(trailing?.trailType);
    const enableByDefault = Boolean(hook.enableAutoTrailing && validTrailDistance);

    const bulkOps: any[] = [];
    const activePositionIds = new Set<string>();

    for (const row of rows) {
        if (!row || row.finished) continue;
        const position = row.position;
        if (!position) continue;

        const marketRaw = position.market ?? position.symbol;
        if (!marketRaw) continue;

        const positionId = String(
            position.position_id ??
            position.id ??
            position.order_id ??
            position.positionId ??
            `${marketRaw}-${position.side ?? position.hold_side ?? 'long'}`
        );

        activePositionIds.add(positionId);

        const entryPrice = extractEntryPrice(position);
        const currentPrice = extractCurrentPrice(position, entryPrice ?? 0);
        const side = parseSide(position.side ?? position.position_side ?? position.hold_side);
        const market = String(marketRaw).toUpperCase();

        const setPayload: Record<string, any> = {
            market,
            side,
            isOpen: true,
        };
        if (Number.isFinite(entryPrice) && (entryPrice as number) > 0) setPayload.entryPrice = entryPrice;
        if (Number.isFinite(currentPrice) && (currentPrice as number) > 0) setPayload.currentPrice = currentPrice;

        const insertPayload: Record<string, any> = {
            minProfitThreshold: defaultMinProfit,
            trailDistance: defaultTrailDistance,
            trailType: defaultTrailType,
            isEnabled: enableByDefault,
            autoApplied: enableByDefault,
        };

        bulkOps.push({
            updateOne: {
                filter: { hook: hook._id, positionId },
                update: {
                    $set: setPayload,
                    $setOnInsert: insertPayload,
                },
                upsert: true,
            },
        });
    }

    if (bulkOps.length > 0) {
        try {
            await PositionTrailingState.bulkWrite(bulkOps, { ordered: false });
        } catch (err) {
            console.error(`Failed to sync trailing states for hook ${hookId}:`, err);
        }
    }

    try {
        await PositionTrailingState.updateMany(
            { hook: hook._id, positionId: { $nin: Array.from(activePositionIds) } },
            { $set: { isOpen: false, isEnabled: false } }
        ).exec();
    } catch (err) {
        console.error(`Failed to mark closed trailing states for hook ${hookId}:`, err);
    }

    try {
        await PositionTrailingState.updateMany(
            { hook: hook._id, isOpen: true, autoApplied: true },
            {
                $set: {
                    minProfitThreshold: defaultMinProfit,
                    trailDistance: defaultTrailDistance,
                    trailType: defaultTrailType,
                    isEnabled: enableByDefault,
                },
            }
        ).exec();
    } catch (err) {
        console.error(`Failed to refresh auto-applied trailing configs for hook ${hookId}:`, err);
    }

    await PositionTrailingState.updateMany(
        { hook: hook._id, isOpen: true, autoApplied: true },
        {
            $set: {
                minProfitThreshold: defaultMinProfit,
                trailDistance: defaultTrailDistance,
                trailType: defaultTrailType,
                isEnabled: enableByDefault,
            },
        }
    ).exec();
};

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
        const hookById = new Map<string, IHook>();
        const runtimeConfigs: TrailingRuntimeConfig[] = [];

        for (const user of users) {
            const hooks = await Webhook.find({ creator: user._id });
            hooks.forEach(hook => hookById.set(String(hook._id), hook.toObject<IHook>()));
            const uniqueHooksMap = new Map<string, IHook>();

            hooks.forEach(hook => {
                const key = `${hook.coinExApiKey}::${hook.coinExApiSecret}`;
                if (!uniqueHooksMap.has(key)) {
                    uniqueHooksMap.set(key, hook);
                }
            });

            const uniqueHooks = Array.from(uniqueHooksMap.values());
            let total = 0, available = 0, inPosition = 0;
            for (const hook of hooks) {
                const { success, data } = await handleGetDataFromCoinex(hook.coinExApiKey, hook.coinExApiSecret, `/v2/assets/futures/balance`);

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
                    const histories = historyData.data;
                    await PositionHistory.deleteMany({ hook: hook._id, finished: false });
                    const positionHistories = histories.map((history: any) => ({ data: history.position, hook: hook._id, finished: history.finished }));

                    await PositionHistory.insertMany(positionHistories);
                    hook.lastRetrieveTime = historyData.lastTimestamp || Date.now();
                    await hook.save();

                    await buildTrailingRuntimeConfigs(hook, histories);
                } else if (historyData.data) {
                    await buildTrailingRuntimeConfigs(hook, historyData.data);
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
        }

        const openStates = await PositionTrailingState.find({ isOpen: true, isEnabled: true }).lean();
        for (const state of openStates) {
            let hook = hookById.get(String(state.hook));
            if (!hook) {
                const fetched = await Webhook.findById(state.hook).lean<IHook | null>();
                if (!fetched) continue;
                hookById.set(String(state.hook), fetched);
                hook = fetched;
            }
            if (!hook) continue;

            const entry = Number(state.entryPrice ?? 0);
            const distance = Number(state.trailDistance ?? 0);
            if (!Number.isFinite(entry) || entry <= 0) continue;
            if (!Number.isFinite(distance) || distance <= 0) continue;

            const current = Number(state.currentPrice ?? entry);
            const resolvedTrailType = (state.trailType as TrailingType) || toTrailType(hook.trailingConfig?.trailType);
            const minProfit = Number(
                state.minProfitThreshold ?? hook.trailingConfig?.minProfitThreshold ?? 0
            );

            runtimeConfigs.push({
                stateId: String(state._id),
                positionId: state.positionId,
                hookId: String(state.hook),
                market: state.market,
                side: parseSide(state.side),
                entryPrice: entry,
                currentPrice: Number.isFinite(current) && current > 0 ? current : entry,
                minProfitThreshold: minProfit,
                trailDistance: distance,
                trailType: resolvedTrailType,
                coinExApiKey: hook.coinExApiKey,
                coinExApiSecret: hook.coinExApiSecret,
                highestPrice: state.highestPrice,
                currentStopLoss: state.currentStopLoss,
            });
        }

        trailingStopService.syncEnabledStates(runtimeConfigs);
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
