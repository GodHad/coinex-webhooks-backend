import QRCodeStyling, { DrawType } from 'qr-code-styling';
import nodeCanvas from 'canvas';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

type QRType = 'svg' | 'canvas';

interface GenerateQRCodeOptions {
    filename: string;
    currency: string;
    address: string;
    amount: number;
    imageUrl?: string;
    type?: QRType;
}

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

    const options = {
        width: 300,
        height: 300,
        data,
        type: type as DrawType,
        image: imageUrl,
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
            saveAsBlob: true,
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
