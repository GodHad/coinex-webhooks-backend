// models/ExchangePartner.js
import mongoose from 'mongoose';

const exchangePartnerSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        logo: { type: String, required: true },
        description: { type: String, required: true },
        rating: { type: Number, required: true },
        pros: [{ type: String, required: true }],
        cons: [{ type: String, required: true }],
        currentPromoTitle: { type: String },
        currentPromoDescription: { type: String },
        currentPromoExpiry: { type: Date },
        tradingFee: { type: String },
        leverage: { type: String },
        minDeposit: { type: String },
        assets: { type: String },
        enabled: { type: Boolean, required: true },
        affiliateLink: { type: String, required: true }
    },
    { timestamps: true }
);

const ExchangePartner = mongoose.model('ExchangePartner', exchangePartnerSchema);

export default ExchangePartner;