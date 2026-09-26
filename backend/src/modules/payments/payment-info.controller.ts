import {
  BadRequestException, Controller, Get, Query, StreamableFile,
} from '@nestjs/common';
import { getPaymentConfig } from '../../config/payment.config';
import { getBookingHoldMs } from '../../config/booking.config';

// promptpay-qr is CommonJS with a default export function; qrcode is CommonJS
// too. Loaded via require (with typed casts) so no esModuleInterop / @types are
// needed just for these two.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const generatePayload = require('promptpay-qr') as (
  target: string,
  opts?: { amount?: number },
) => string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode') as {
  toBuffer: (text: string, opts?: Record<string, unknown>) => Promise<Buffer>;
};
/**
 * Public payment information + a dynamic PromptPay QR.
 *
 * `GET /api/payment/qr?amount=1234.50` generates an EMVCo PromptPay payload for
 * the resort's PromptPay ID with the amount embedded, then renders it to a PNG.
 * No auth — the QR contains no secret, and the amount is a public figure the
 * app already shows.
 */
@Controller('payment')
export class PaymentInfoController {
  private readonly cfg = getPaymentConfig();

  @Get('info')
  info() {
    return {
      accountName: this.cfg.accountName,
      promptPayId: this.cfg.promptPayId,
      note: this.cfg.note,
      // Base URL; the app appends ?amount=<booking total> for a dynamic QR.
      qrImageUrl: '/api/payment/qr',
      // How long an unpaid booking holds its room — drives the app countdown.
      holdMinutes: Math.round(getBookingHoldMs() / 60000),
    };
  }

  /** Dynamic PromptPay QR with the amount embedded. */
  @Get('qr')
  async qr(@Query('amount') amount?: string): Promise<StreamableFile> {
    let amt: number | undefined;
    if (amount !== undefined && amount !== '') {
      amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        throw new BadRequestException('amount ไม่ถูกต้อง');
      }
    }
    const payload = generatePayload(this.cfg.promptPayId, amt !== undefined ? { amount: amt } : {});
    const png = await QRCode.toBuffer(payload, { type: 'png', width: 512, margin: 1 });
    return new StreamableFile(png, { type: 'image/png' });
  }
}
