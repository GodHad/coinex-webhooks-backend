type TradeEmailKind = 'success' | 'error';

interface TradeEmailData {
    kind: TradeEmailKind;  
    action: 'BUY' | 'SELL';
    symbol: string;
    requestedAmount: string; 
    unit?: string;
    computedQty?: string;
    leverageUsed?: number; 
    priceUsed?: number;  
    balanceAvail?: number; 
    reasonText?: string;
    code?: number | string; 
    dashboardUrl?: string;
    ts?: string;
    brand?: { name?: string; url?: string; accent?: string; };
}

export function renderTradeEmail(data: TradeEmailData) {
    const {
        kind, action, symbol, requestedAmount, unit,
        computedQty, leverageUsed, priceUsed, balanceAvail,
        reasonText, code, dashboardUrl,
        ts = new Date().toISOString(),
        brand = {}
    } = data;

    const brandName = brand.name || 'SIGNALYZE';
    const brandUrl = brand.url || 'https://www.signalyze.net';
    const accent = brand.accent || (kind === 'error' ? '#e03131' : '#2f9e44');

    const subj = kind === 'error'
        ? `Trade ${action} ${symbol} — Failed`
        : `Trade ${action} ${symbol} — Placed`;

    const text = [
        `${brandName}`,
        `${kind === 'error' ? 'TRADE FAILED' : 'TRADE PLACED'}`,
        `Action: ${action}`,
        `Symbol: ${symbol}`,
        `Requested: ${requestedAmount}${unit ? ` ${unit}` : ''}`,
        computedQty ? `Computed Qty: ${computedQty}` : '',
        leverageUsed ? `Leverage: ${leverageUsed}x` : '',
        priceUsed ? `Price Used: ${priceUsed}` : '',
        balanceAvail != null ? `Avail. Balance: ${balanceAvail}` : '',
        kind === 'error' && reasonText ? `Reason: ${reasonText}${code ? ` (code ${code})` : ''}` : '',
        `Time: ${ts}`,
        dashboardUrl ? `Open Dashboard: ${dashboardUrl}` : ''
    ].filter(Boolean).join('\n');

    const html = `
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">
  ${kind === 'error' ? 'Trade failed' : 'Trade placed'} • ${action} ${symbol}
</span>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fb;padding:24px 0">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;">
        <tr>
          <td style="padding:0 24px 16px 24px;text-align:left;">
            <a href="${brandUrl}" style="text-decoration:none;color:#0b1f33;font-family:Inter,Segoe UI,Arial,sans-serif;font-weight:700;font-size:18px;letter-spacing:0.3px">${brandName}</a>
          </td>
        </tr>

        <tr>
          <td style="padding:0 24px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e9edf3;border-radius:12px;overflow:hidden;">
              <tr>
                <td style="background:${accent};padding:12px 16px;color:#fff;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;letter-spacing:.3px">
                  ${kind === 'error' ? 'Trade Failed' : 'Trade Placed'}
                </td>
              </tr>
              <tr>
                <td style="padding:20px 20px 8px 20px;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0b1f33;">
                  <div style="font-size:18px;font-weight:700;margin-bottom:6px">${action} • ${symbol}</div>
                  <div style="font-size:13px;color:#4a6071">Time: ${new Date(ts).toLocaleString()}</div>
                </td>
              </tr>

              <tr>
                <td style="padding:0 20px 20px 20px">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0 8px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;color:#0b1f33">
                    <tr>
                      <td style="width:45%;color:#4a6071;">Requested</td>
                      <td style="width:55%;font-weight:600;">${requestedAmount}${unit ? ` ${unit}` : ''}</td>
                    </tr>
                    ${computedQty ? `
                    <tr>
                      <td style="color:#4a6071;">Computed Qty</td>
                      <td style="font-weight:600;">${computedQty}</td>
                    </tr>` : ''}
                    ${leverageUsed ? `
                    <tr>
                      <td style="color:#4a6071;">Leverage</td>
                      <td style="font-weight:600;">${leverageUsed}×</td>
                    </tr>` : ''}
                    ${priceUsed ? `
                    <tr>
                      <td style="color:#4a6071;">Price Used</td>
                      <td style="font-weight:600;">${priceUsed}</td>
                    </tr>` : ''}
                    ${balanceAvail != null ? `
                    <tr>
                      <td style="color:#4a6071;">Avail. Balance</td>
                      <td style="font-weight:600;">${balanceAvail}</td>
                    </tr>` : ''}
                    ${kind === 'error' && (reasonText || code) ? `
                    <tr>
                      <td style="color:#4a6071;">Reason</td>
                      <td style="font-weight:600;color:#b02a37;">
                        ${reasonText || 'Unknown error'}${code ? ` <span style="opacity:.7">(code ${code})</span>` : ''}
                      </td>
                    </tr>` : ''}
                  </table>
                </td>
              </tr>

              ${dashboardUrl ? `
              <tr>
                <td style="padding:0 20px 24px 20px;">
                  <a href="${dashboardUrl}"
                     style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-family:Inter,Segoe UI,Arial,sans-serif;font-weight:700;font-size:14px;padding:10px 16px;border-radius:10px">
                     Open Dashboard
                  </a>
                </td>
              </tr>` : ''}

            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:12px 24px 0 24px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:12px;color:#7a8b99">
            You’re receiving this because trading alerts are enabled on your account.
          </td>
        </tr>
        <tr>
          <td style="padding:6px 24px 24px 24px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:12px;color:#7a8b99">
            © ${new Date().getFullYear()} ${brandName}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`.trim();

    return { subject: subj, text, html };
}
