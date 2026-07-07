export type RechargePaymentInfo = {
  accountName?: string
  accountNo?: string
  bankName?: string
  contact?: string
  notice: string
}

function clean(value: string | undefined): string | undefined {
  const text = (value || "").trim()
  return text || undefined
}

export const RECHARGE_PAYMENT_INFO: RechargePaymentInfo = {
  accountName: clean(process.env.NEXT_PUBLIC_RECHARGE_ACCOUNT_NAME),
  accountNo: clean(process.env.NEXT_PUBLIC_RECHARGE_ACCOUNT_NO),
  bankName: clean(process.env.NEXT_PUBLIC_RECHARGE_BANK_NAME),
  contact: clean(process.env.NEXT_PUBLIC_RECHARGE_CONTACT),
  notice:
    clean(process.env.NEXT_PUBLIC_RECHARGE_NOTICE)
    || "请先按对接人员提供的收款码或对公账户完成付款，再提交充值申请。管理员核对到账后会审批加积分。",
}
