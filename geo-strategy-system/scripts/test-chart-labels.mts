import assert from "node:assert/strict"

const chartLabelModule = await import("../src/lib/chart-labels") as typeof import("../src/lib/chart-labels") & {
  default?: typeof import("../src/lib/chart-labels")
}
const { wrapChartLabel } = chartLabelModule.default || chartLabelModule

const chinese = "杭州势途数字科技有限公司品牌旗舰店"
const english = "International Medical Research Center"
const mixed = "威法VIFA高端全屋定制品牌"

for (const value of [chinese, english, mixed]) {
  const lines = wrapChartLabel(value, 12)
  assert.ok(lines.length > 1, `expected a wrapped label for ${value}`)
  assert.equal(
    lines.join("").replace(/\s+/g, ""),
    value.replace(/\s+/g, ""),
    `wrapped label must preserve the full value: ${value}`,
  )
  assert.ok(lines.every(line => line.length > 0), "wrapped labels must not contain empty lines")
}

assert.deepEqual(
  wrapChartLabel("International Medical Research Center", 18),
  ["International", "Medical Research", "Center"],
)

assert.deepEqual(wrapChartLabel("短品牌", 18), ["短品牌"])
assert.deepEqual(wrapChartLabel("", 18), [""])
console.log("Chart label wrapping tests passed.")
