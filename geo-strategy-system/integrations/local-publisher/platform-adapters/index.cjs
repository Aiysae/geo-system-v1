const adapters=[
  require('./ctrip.cjs'),
  require('./meipian.cjs'),
  require('./juejin.cjs'),
];

const byId=Object.fromEntries(adapters.map(adapter=>[adapter.id,adapter]));
module.exports={adapters,byId};
