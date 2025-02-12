// models/AdminData.js
import mongoose from 'mongoose';

const adminDataSchema = new mongoose.Schema(
    {
        favicon: { type: String },
        pageTitle: { type: String, required: true },
        sidebarTitle: { type: String, required: true },
        mainTitle: { type: String, required: true },
        subTitle: { type: String, required: true },
        featuredCardTitle: { type: String, required: true },
        featuredCardDescription: { type: String, required: true },
        featuredCardTitle1: { type: String, required: true },
        featuredCardDescription1: { type: String, required: true },
        featuredCardTitle2: { type: String, required: true },
        featuredCardDescription2: { type: String, required: true },
        twitter: { type: String },
        telegram: { type: String },
        instagram: { type: String },
        discord: { type: String },
        siteMaintainanceMode: { type: Boolean, required: true },
        webhooksMaintainanceMode: { type: Boolean, required: true },
        allowSignup: { type: Boolean, required: true },
        // inviteCodes:{type: Array}
    },
    { timestamps: true }
);

const AdminData = mongoose.model('AdminData', adminDataSchema);

export default AdminData;