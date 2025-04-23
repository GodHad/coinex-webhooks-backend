import QRCodeStyling, { DrawType } from 'qr-code-styling';
import nodeCanvas from 'canvas';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';

type QRType = 'svg' | 'canvas';

interface GenerateQRCodeOptions {
    filename: string;
    currency: string;
    address: string;
    amount: number;
    imageUrl?: string;
    type?: QRType;
}

const downloadImage = async (url: string, currency: string) => {
    const filePath = path.join(__dirname, '../uploads', `${currency}.svg`);

    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        console.log(`${currency}.svg already exists. Skipping download.`);
    } catch (err) {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        await fs.promises.writeFile(filePath, Buffer.from(response.data));
        console.log(`${currency}.svg downloaded and saved.`);
    }

    return path.join(__dirname, '../uploads', currency + '.svg');
};
const generateQRData = (currency: string, address: string, amount: number) => {
    switch (currency) {
        case 'BTC':
            return `bitcoin:${address}?amount=${amount}`;
        case 'ETH':
            return `ethereum:${address}?value=${amount}`;
        case 'SOL':
            return `solana:${address}?amount=${amount}`;
        default:
            return '';
    }
}

const generateQRCode = async ({
    filename,
    currency,
    address,
    amount,
    imageUrl,
    type = 'canvas'
}: GenerateQRCodeOptions): Promise<string> => {
    const data = generateQRData(currency, address, amount);

    const targetDirr = path.join(__dirname, '../uploads');
    try {
        await fs.promises.access(targetDirr);
    } catch {
        await fs.promises.mkdir(targetDirr, {recursive: true});
    }

    const downloadImageUrl = await downloadImage(imageUrl || '', currency);

    const options = {
        width: 300,
        height: 300,
        data,
        type: type as DrawType,
        image: downloadImageUrl,
        jsdom: JSDOM,
        ...(type === 'canvas' ? { nodeCanvas } : {}),
        dotsOptions: {
            color: "#4267b2",
            type: "rounded" as const
        },
        backgroundOptions: {
            color: "#e9ebee",
        },
        imageOptions: {
            crossOrigin: "anonymous",
            margin: 20,
            imageSize: 0.8,
        }
    };

    const qrCode = new QRCodeStyling(options);

    const fileExtension = type === 'canvas' ? 'png' : 'svg';
    const buffer = await qrCode.getRawData(fileExtension);
    if (!buffer) throw new Error("Failed to generate QR code: buffer is null");

    const arrayBuffer = buffer instanceof Blob
        ? await buffer.arrayBuffer()
        : buffer;

    const targetDir = path.resolve(__dirname, '../../../coinex-new-frontend/public/uploads');
    try {
        await fs.promises.access(targetDir);
    } catch {
        await fs.promises.mkdir(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, `${filename}.${fileExtension}`);
    await fs.promises.writeFile(filePath, Buffer.isBuffer(arrayBuffer) ? arrayBuffer : Buffer.from(arrayBuffer));

    return `/uploads/${filename}.${fileExtension}`;
};

export default generateQRCode;
