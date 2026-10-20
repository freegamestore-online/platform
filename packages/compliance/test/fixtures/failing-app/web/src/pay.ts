// Uses the Payment Request API, which FreeGameStore games may not (#376).
export const buy = (m: PaymentMethodData[], d: PaymentDetailsInit) => new PaymentRequest(m, d).show();
