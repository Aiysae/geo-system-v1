export type RechargePaymentInfo = {
  accountName?: string
  creditCode?: string
  registeredAddress?: string
  accountNo?: string
  bankName?: string
  bankCode?: string
  contact?: string
  qrCodes: Array<{
    label: string
    imageUrl: string
    description?: string
  }>
  notice: string
}

function clean(value: string | undefined): string | undefined {
  const text = (value || "").trim()
  return text || undefined
}

export const RECHARGE_PAYMENT_INFO: RechargePaymentInfo = {
  accountName: clean(process.env.NEXT_PUBLIC_RECHARGE_ACCOUNT_NAME),
  creditCode: clean(process.env.NEXT_PUBLIC_RECHARGE_CREDIT_CODE),
  registeredAddress: clean(process.env.NEXT_PUBLIC_RECHARGE_REGISTERED_ADDRESS),
  accountNo: clean(process.env.NEXT_PUBLIC_RECHARGE_ACCOUNT_NO),
  bankName: clean(process.env.NEXT_PUBLIC_RECHARGE_BANK_NAME),
  bankCode: clean(process.env.NEXT_PUBLIC_RECHARGE_BANK_CODE),
  contact: clean(process.env.NEXT_PUBLIC_RECHARGE_CONTACT),
  qrCodes: [
    {
      label: clean(process.env.NEXT_PUBLIC_RECHARGE_WECHAT_QR_LABEL) || "微信支付",
      imageUrl: clean(process.env.NEXT_PUBLIC_RECHARGE_WECHAT_QR_IMAGE_URL) || "",
      description: clean(process.env.NEXT_PUBLIC_RECHARGE_WECHAT_QR_DESC),
    },
    {
      label: clean(process.env.NEXT_PUBLIC_RECHARGE_ALIPAY_QR_LABEL) || "支付宝",
      imageUrl: clean(process.env.NEXT_PUBLIC_RECHARGE_ALIPAY_QR_IMAGE_URL) || "",
      description: clean(process.env.NEXT_PUBLIC_RECHARGE_ALIPAY_QR_DESC),
    },
  ].filter(item => item.imageUrl),
  notice:
    clean(process.env.NEXT_PUBLIC_RECHARGE_NOTICE)
    || "请先按对接人员提供的收款码或对公账户完成付款，再提交充值申请。管理员核对到账后会审批加积分。",
}
