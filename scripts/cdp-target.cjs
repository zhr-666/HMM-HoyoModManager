'use strict';

function mainWindowTarget(rows){
  return rows.find(row=>row.type==='page'&&row.url==='hoyo://app/index.html'&&row.webSocketDebuggerUrl);
}

module.exports={mainWindowTarget};
