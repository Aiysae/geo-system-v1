export type RechargePaymentInfo = {
  accountName?: string
  creditCode?: string
  registeredAddress?: string
  accountNo?: string
  bankName?: string
  bankCode?: string
  contact?: string
  qrCodes: Array<{
    method: "wechat" | "alipay"
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
  accountName: clean(process.env.NEXT_PUBLIC_RECHARGE_ACCOUNT_NAME) || "杭州势途数字科技有限公司",
  creditCode: clean(process.env.NEXT_PUBLIC_RECHARGE_CREDIT_CODE) || "91330114MAK8ML1T1N",
  registeredAddress:
    clean(process.env.NEXT_PUBLIC_RECHARGE_REGISTERED_ADDRESS)
    || "浙江省杭州市钱塘区河庄街道河景路598号12层1202室82号",
  accountNo: clean(process.env.NEXT_PUBLIC_RECHARGE_ACCOUNT_NO) || "3301041060008436135",
  bankName: clean(process.env.NEXT_PUBLIC_RECHARGE_BANK_NAME) || "杭州银行股份有限公司环北支行",
  bankCode: clean(process.env.NEXT_PUBLIC_RECHARGE_BANK_CODE) || "313331000284",
  contact: clean(process.env.NEXT_PUBLIC_RECHARGE_CONTACT),
  qrCodes: [
    {
      method: "wechat" as const,
      label: clean(process.env.NEXT_PUBLIC_RECHARGE_WECHAT_QR_LABEL) || "微信支付",
      imageUrl: clean(process.env.NEXT_PUBLIC_RECHARGE_WECHAT_QR_IMAGE_URL) || "/recharge/wechat-pay.jpg",
      description: clean(process.env.NEXT_PUBLIC_RECHARGE_WECHAT_QR_DESC) || "推荐使用微信支付",
    },
    {
      method: "alipay" as const,
      label: clean(process.env.NEXT_PUBLIC_RECHARGE_ALIPAY_QR_LABEL) || "支付宝",
      imageUrl: clean(process.env.NEXT_PUBLIC_RECHARGE_ALIPAY_QR_IMAGE_URL) || "/recharge/alipay-pay.jpg",
      description: clean(process.env.NEXT_PUBLIC_RECHARGE_ALIPAY_QR_DESC) || "支持信用卡 / 花呗付款",
    },
  ].filter(item => item.imageUrl),
  notice:
    clean(process.env.NEXT_PUBLIC_RECHARGE_NOTICE)
    || "支持微信、支付宝或对公转账。付款后请填写付款人、付款凭证或流水号，管理员核对到账后审批加积分。",
}
